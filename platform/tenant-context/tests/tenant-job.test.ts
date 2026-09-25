import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { PlatformProblem } from "../../problem-model/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import {
  currentTenantContext,
  resolveTenantContext,
  runTenantJob,
  runWithTenantContext,
  tenantId,
  type AuthenticatedPrincipal,
  type TenantId,
} from "../src/index.ts";

const tenantA = tenantId("tenant_job_A");
const tenantB = tenantId("tenant_job_B");

const code = (expected: string) => (error: unknown) => error instanceof PlatformProblem && error.problem.code === expected;

function worker(memberships: readonly TenantId[], options: { readonly expiresAt?: string } = {}) {
  return testPrincipal(memberships, { actor: "svc_scheduler", kind: "workload", ...options });
}

function run(tenant: TenantId, principal: Readonly<AuthenticatedPrincipal> = worker([tenant]), overrides: Record<string, unknown> = {}) {
  return { jobName: "idempotency.purge", runId: "run_42", principal, tenantId: tenant, tenantState: "ACTIVE" as const, ...overrides };
}

test("worker context: a tenant job runs as its workload principal with a run-derived correlation ID across async work", async () => {
  const seen = await runTenantJob(run(tenantA), async () => {
    await delay(1);
    const context = currentTenantContext();
    return { tenant: context.tenantId, kind: context.principalKind, actor: context.actorId, correlation: context.correlationId };
  });
  assert.deepEqual(seen, { tenant: tenantA, kind: "workload", actor: "svc_scheduler", correlation: "job:idempotency.purge:run_42" });
  assert.throws(() => currentTenantContext(), code("tenant_context_missing"), "the context ends with the job");
});

test("worker context: concurrent per-tenant runs never see each other's tenant", async () => {
  const observe = (tenant: TenantId) =>
    runTenantJob(run(tenant, worker([tenant]), { runId: `run_${tenant}` }), async () => {
      const seen: string[] = [];
      for (let step = 0; step < 5; step += 1) {
        await delay(Math.random() * 3);
        seen.push(currentTenantContext().tenantId);
      }
      return seen;
    });
  const [a, b] = await Promise.all([observe(tenantA), observe(tenantB)]);
  assert.deepEqual(new Set(a), new Set([tenantA]));
  assert.deepEqual(new Set(b), new Set([tenantB]));
});

test("worker context: jobs need a current workload credential bound to exactly the one active tenant", () => {
  const noop = () => undefined;
  assert.throws(() => runTenantJob(run(tenantA, testPrincipal([tenantA], { actor: "user_1" })), noop), code("workload_scope_denied"));
  assert.throws(() => runTenantJob(run(tenantA, worker([tenantA, tenantB])), noop), code("workload_scope_denied"));
  assert.throws(() => runTenantJob(run(tenantA, worker([tenantB])), noop), code("tenant_access_denied"));
  assert.throws(() => runTenantJob(run(tenantA, worker([tenantA]), { tenantState: "SUSPENDED" }), noop), code("tenant_not_active"));
  assert.throws(() => runTenantJob(run(tenantA, worker([tenantA], { expiresAt: "2020-01-01T00:00:00.000Z" })), noop), code("authentication_failed"));
  const forged = { ...worker([tenantA]) } as Readonly<AuthenticatedPrincipal>;
  assert.throws(() => runTenantJob(run(tenantA, forged), noop), code("authentication_failed"));
  assert.throws(() => runTenantJob(run(tenantA, worker([tenantA]), { jobName: "Purge Everything" }), noop), code("invalid_trusted_context"));
  assert.throws(() => runTenantJob(run(tenantA, worker([tenantA]), { runId: "run 1\r\nX-Injected: 1" }), noop), code("invalid_trusted_context"));
});

test("worker context: a job cannot start inside a request or another job, and cannot switch tenant once running", () => {
  const request = resolveTenantContext({ principal: testPrincipal([tenantA]), selectedTenantId: tenantA, tenantState: "ACTIVE", correlationId: "corr_req" });
  assert.throws(() => runWithTenantContext(request, () => runTenantJob(run(tenantA), () => undefined)), code("tenant_context_mismatch"));
  assert.throws(() => runTenantJob(run(tenantA), () => runTenantJob(run(tenantB), () => undefined)), code("tenant_context_mismatch"));
  const other = resolveTenantContext({ principal: worker([tenantB]), selectedTenantId: tenantB, tenantState: "ACTIVE", correlationId: "corr_other" });
  assert.throws(() => runTenantJob(run(tenantA), () => runWithTenantContext(other, () => undefined)), code("tenant_context_mismatch"));
});

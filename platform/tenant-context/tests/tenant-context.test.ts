import assert from "node:assert/strict";
import test from "node:test";
import { PlatformProblem, mapErrorToProblemResponse, runAtProblemBoundary } from "../../problem-model/src/index.ts";
import { actorId, currentTenantContext, resolveTenantContext, runWithTenantContext, tenantId } from "../src/index.ts";

const tenantA = tenantId("tenant_A");
const tenantB = tenantId("tenant_B");
const principal = Object.freeze({
  actorId: actorId("user_1"),
  kind: "interactive" as const,
  tenantMemberships: Object.freeze([tenantA]),
  assurance: "mfa" as const,
});

test("resolves and propagates immutable trusted context across async work", async () => {
  const context = resolveTenantContext({ principal, selectedTenantId: tenantA, tenantState: "ACTIVE", correlationId: "corr_1" });
  await runWithTenantContext(context, async () => {
    await Promise.resolve();
    assert.equal(currentTenantContext(), context);
    assert.equal(currentTenantContext().tenantId, tenantA);
    assert.equal(Object.isFrozen(currentTenantContext()), true);
  });
});

test("denies a selected tenant absent from verified memberships", () => {
  assert.throws(
    () => resolveTenantContext({ principal, selectedTenantId: tenantB, tenantState: "ACTIVE", correlationId: "corr_2" }),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "tenant_access_denied",
  );
});

test("rejects tenant identity supplied by an untrusted request body", () => {
  assert.throws(
    () => resolveTenantContext({ principal, selectedTenantId: tenantA, tenantState: "ACTIVE", correlationId: "corr_3", bodyTenantId: tenantA }),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "untrusted_tenant_context",
  );
});

test("denies suspended tenants and fails closed without a context", () => {
  assert.throws(
    () => resolveTenantContext({ principal, selectedTenantId: tenantA, tenantState: "SUSPENDED", correlationId: "corr_4" }),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "tenant_not_active",
  );
  assert.throws(
    () => currentTenantContext(),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "tenant_context_missing",
  );
});

test("tenant context failures map to canonical problem responses carrying the trusted correlation ID", async () => {
  const cases = [
    { input: { selectedTenantId: tenantB, tenantState: "ACTIVE" as const }, status: 403, code: "tenant_access_denied" },
    { input: { selectedTenantId: tenantA, tenantState: "SUSPENDED" as const }, status: 403, code: "tenant_not_active" },
    { input: { selectedTenantId: tenantA, tenantState: "ACTIVE" as const, bodyTenantId: tenantA }, status: 400, code: "untrusted_tenant_context" },
  ];
  for (const { input, status, code } of cases) {
    const result = await runAtProblemBoundary({ correlationId: "corr_ingress_1" }, () =>
      resolveTenantContext({ principal, correlationId: "corr_ingress_1", ...input }),
    );
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.response.status, status);
    assert.equal(result.response.body.code, code);
    assert.equal(result.response.body.correlation_id, "corr_ingress_1");
    assert.equal(result.response.headers["content-type"], "application/problem+json");
    assert.equal(JSON.stringify(result.response).includes(tenantB), false, "must not disclose tenant identifiers");
  }
  const missing = mapErrorToProblemResponse((() => { try { currentTenantContext(); } catch (error) { return error; } })(), { correlationId: "corr_ingress_2" });
  assert.equal(missing.status, 500);
  assert.equal(missing.body.code, "tenant_context_missing");
});

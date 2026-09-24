import assert from "node:assert/strict";
import test from "node:test";
import { PlatformProblem } from "../../../platform/problem-model/src/index.ts";
import { resolvePlatformCommandContext } from "../../../platform/tenant-context/src/index.ts";
import { createTenantCommands } from "../application/tenant-commands.ts";
import { AllowListAuthorizer, InMemoryTenantPersistence } from "./in-memory-persistence.ts";

const NOW = new Date("2026-09-23T10:00:00.000Z");

function setup(allowed: readonly ("tenant:provision" | "tenant:manage_lifecycle")[] = ["tenant:provision", "tenant:manage_lifecycle"]) {
  const persistence = new InMemoryTenantPersistence();
  const authorizer = new AllowListAuthorizer(allowed);
  let counter = 0;
  const commands = createTenantCommands({ persistence, authorizer, clock: () => NOW, newEventId: () => `evt_test_${++counter}` });
  const context = resolvePlatformCommandContext({
    principal: { kind: "user", actorId: "operator_1" },
    correlationId: "corr_1",
    causationId: "cause_1",
  });
  return { persistence, authorizer, commands, context };
}

const provisionInput = { tenantId: "tenant_A", displayName: " Acme ", initialAdministratorActorId: "admin_1" };

const rejectsWith = (code: string) => (error: unknown) => error instanceof PlatformProblem && error.problem.code === code;

test("provisioning writes tenant, default role, initial admin, audit and outbox event in one unit of work", async () => {
  const { persistence, commands, context } = setup();
  const tenant = await commands.provisionTenant(context, provisionInput);

  assert.equal(tenant.state, "PROVISIONING");
  assert.equal(tenant.displayName, "Acme");
  assert.equal(persistence.transactionsStarted, 1);
  assert.equal(persistence.committed.tenants.size, 1);
  assert.deepEqual(persistence.committed.roles, [{ tenantId: "tenant_A", roleCode: "tenant_administrator" }]);
  assert.deepEqual(persistence.committed.memberships, [{ tenantId: "tenant_A", actorId: "admin_1", roleCode: "tenant_administrator" }]);

  assert.equal(persistence.committed.audit.length, 1);
  const audit = persistence.committed.audit[0]!;
  assert.equal(audit.action, "tenant.provisioned");
  assert.equal(audit.actorId, "operator_1");
  assert.equal(audit.correlationId, "corr_1");
  assert.equal(audit.causationId, "cause_1");

  assert.equal(persistence.committed.outbox.length, 1);
  const envelope = persistence.committed.outbox[0]!;
  assert.equal(envelope.type, "com.subrevos.tenant.provisioned.v1");
  assert.equal(envelope.tenant_id, "tenant_A");
  assert.equal(envelope.aggregate_id, "tenant_A");
  assert.equal(envelope.aggregate_version, 1);
  assert.equal(envelope.actor.id, "operator_1");
  assert.equal(envelope.correlation_id, "corr_1");
  assert.equal(envelope.causation_id, "cause_1");
  assert.equal(envelope.id, "evt_test_1");
});

test("authorization is checked first: a denied caller starts no transaction", async () => {
  const { persistence, authorizer, commands, context } = setup([]);
  await assert.rejects(commands.provisionTenant(context, provisionInput), rejectsWith("platform_access_denied"));
  await assert.rejects(commands.activateTenant(context, { tenantId: "tenant_A", expectedVersion: 1 }), rejectsWith("platform_access_denied"));
  assert.deepEqual(authorizer.calls, ["tenant:provision", "tenant:manage_lifecycle"]);
  assert.equal(persistence.transactionsStarted, 0);
});

test("a forged platform context is rejected before authorization", async () => {
  const { persistence, authorizer, commands } = setup();
  const forged = { actorId: "operator_1", principalKind: "user", correlationId: "corr_1" } as never;
  await assert.rejects(commands.provisionTenant(forged, provisionInput), rejectsWith("tenant_context_mismatch"));
  assert.equal(authorizer.calls.length, 0);
  assert.equal(persistence.transactionsStarted, 0);
});

test("invalid input is rejected before any transaction starts", async () => {
  const { persistence, commands, context } = setup();
  await assert.rejects(
    commands.provisionTenant(context, { ...provisionInput, displayName: "   " }),
    rejectsWith("tenant_display_name_required"),
  );
  assert.equal(persistence.transactionsStarted, 0);
});

test("duplicate tenant is a 409 and commits nothing further", async () => {
  const { persistence, commands, context } = setup();
  await commands.provisionTenant(context, provisionInput);
  await assert.rejects(commands.provisionTenant(context, provisionInput), rejectsWith("tenant_already_exists"));
  assert.equal(persistence.committed.tenants.size, 1);
  assert.equal(persistence.committed.roles.length, 1);
  assert.equal(persistence.committed.memberships.length, 1);
  assert.equal(persistence.committed.audit.length, 1);
  assert.equal(persistence.committed.outbox.length, 1);
});

for (const point of ["role", "membership", "audit", "outbox"] as const) {
  test(`a failure at ${point} leaves nothing committed`, async () => {
    const { persistence, commands, context } = setup();
    persistence.failAt = point;
    await assert.rejects(commands.provisionTenant(context, provisionInput));
    assert.equal(persistence.committed.tenants.size, 0);
    assert.equal(persistence.committed.roles.length, 0);
    assert.equal(persistence.committed.memberships.length, 0);
    assert.equal(persistence.committed.audit.length, 0);
    assert.equal(persistence.committed.outbox.length, 0);
  });
}

test("lifecycle transitions record before/after audit and versioned outbox events", async () => {
  const { persistence, commands, context } = setup();
  await commands.provisionTenant(context, provisionInput);
  const active = await commands.activateTenant(context, { tenantId: "tenant_A", expectedVersion: 1 });
  assert.equal(active.state, "ACTIVE");
  const suspended = await commands.suspendTenant(context, { tenantId: "tenant_A", expectedVersion: 2, reason: " non-payment " });
  assert.equal(suspended.state, "SUSPENDED");
  const reactivated = await commands.reactivateTenant(context, { tenantId: "tenant_A", expectedVersion: 3 });
  assert.equal(reactivated.version, 4);
  const closed = await commands.closeTenant(context, { tenantId: "tenant_A", expectedVersion: 4, reason: "customer request" });
  assert.equal(closed.state, "CLOSED");

  assert.deepEqual(
    persistence.committed.outbox.map((event) => [event.type, event.aggregate_version]),
    [
      ["com.subrevos.tenant.provisioned.v1", 1],
      ["com.subrevos.tenant.activated.v1", 2],
      ["com.subrevos.tenant.suspended.v1", 3],
      ["com.subrevos.tenant.activated.v1", 4],
      ["com.subrevos.tenant.closed.v1", 5],
    ],
  );
  const suspension = persistence.committed.audit[2]!;
  assert.deepEqual(suspension.before, { state: "ACTIVE", version: 2 });
  assert.deepEqual(suspension.after, { state: "SUSPENDED", version: 3 });
  assert.equal(suspension.reason, "non-payment");
  for (const event of persistence.committed.outbox) {
    assert.equal(JSON.stringify(event.data).includes("tenant_A"), false, "event data must not restate tenant identity");
  }
});

test("lifecycle failures: unknown tenant, stale version, terminal state and missing reason", async () => {
  const { persistence, commands, context } = setup();
  await assert.rejects(commands.activateTenant(context, { tenantId: "missing", expectedVersion: 1 }), rejectsWith("tenant_not_found"));

  await commands.provisionTenant(context, provisionInput);
  await assert.rejects(commands.activateTenant(context, { tenantId: "tenant_A", expectedVersion: 7 }), rejectsWith("tenant_version_conflict"));

  await commands.activateTenant(context, { tenantId: "tenant_A", expectedVersion: 1 });
  const before = persistence.transactionsStarted;
  await assert.rejects(commands.suspendTenant(context, { tenantId: "tenant_A", expectedVersion: 2 }), rejectsWith("tenant_reason_required"));
  await assert.rejects(
    commands.closeTenant(context, { tenantId: "tenant_A", expectedVersion: 2, reason: "  " }),
    rejectsWith("tenant_reason_required"),
  );
  assert.equal(persistence.transactionsStarted, before, "reason validation happens before any transaction");

  await commands.closeTenant(context, { tenantId: "tenant_A", expectedVersion: 2, reason: "done" });
  await assert.rejects(commands.activateTenant(context, { tenantId: "tenant_A", expectedVersion: 3 }), rejectsWith("invalid_tenant_transition"));
  assert.equal(persistence.committed.tenants.get("tenant_A")?.state, "CLOSED");
  assert.equal(persistence.committed.outbox.length, 3);
});

test("a failed lifecycle write leaves the stored tenant unchanged", async () => {
  const { persistence, commands, context } = setup();
  await commands.provisionTenant(context, provisionInput);
  persistence.failAt = "outbox";
  await assert.rejects(commands.activateTenant(context, { tenantId: "tenant_A", expectedVersion: 1 }));
  assert.equal(persistence.committed.tenants.get("tenant_A")?.state, "PROVISIONING");
  assert.equal(persistence.committed.audit.length, 1);
  assert.equal(persistence.committed.outbox.length, 1);
});

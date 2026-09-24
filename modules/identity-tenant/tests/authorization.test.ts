import assert from "node:assert/strict";
import test from "node:test";
import { PlatformProblem } from "../../../platform/problem-model/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import {
  actorId,
  resolveTenantContext,
  runWithTenantContext,
  tenantId,
  type TenantId,
} from "../../../platform/tenant-context/src/index.ts";
import { createAuditPolicy, createAuditRecorder } from "../../../platform/audit/src/index.ts";
import { ROLE_AUDIT_FIELDS, createRoleAdministration, createTenantAuthorizer } from "../application/authorization.ts";
import {
  DEFAULT_TENANT_ADMINISTRATOR_PERMISSIONS,
  PERMISSION_CATALOG,
  constraintsSatisfied,
  effectivePermissions,
  type PermissionConstraint,
} from "../domain/authorization.ts";
import { InMemorySecurityStore } from "./in-memory-security.ts";

const A = tenantId("tenant_A");
const B = tenantId("tenant_B");
const NOW = new Date("2026-09-24T10:00:00.000Z");

const denied = (code: string) => (error: unknown) => error instanceof PlatformProblem && error.problem.code === code;

function contextFor(tenant: TenantId, actor: string, options: { kind?: "interactive" | "workload"; scopes?: string[] } = {}) {
  const kind = options.kind ?? "interactive";
  return resolveTenantContext({
    principal: testPrincipal([tenant], { actor, kind, scopes: options.scopes }),
    selectedTenantId: tenant,
    tenantState: "ACTIVE",
    correlationId: "corr_rbac_1",
  });
}

function fixture() {
  const store = new InMemorySecurityStore();
  store.seedRole(A, { roleCode: "tenant_administrator", permissions: [...DEFAULT_TENANT_ADMINISTRATOR_PERMISSIONS], status: "active" });
  store.seedRole(A, { roleCode: "pricing_manager", permissions: ["approval:request:propose", "pricing:rate_card:activate"], status: "active" });
  store.seedRole(A, { roleCode: "finance_controller", permissions: ["approval:request:decide", "audit:read"], status: "active" });
  store.seedRole(A, { roleCode: "retired_role", permissions: ["audit:read"], status: "retired" });
  store.seedRole(B, { roleCode: "tenant_administrator", permissions: [...DEFAULT_TENANT_ADMINISTRATOR_PERMISSIONS], status: "active" });
  store.seedAssignment(A, actorId("admin_1"), "tenant_administrator");
  store.seedAssignment(A, actorId("maker_1"), "pricing_manager");
  store.seedAssignment(A, actorId("checker_1"), "finance_controller");
  store.seedAssignment(A, actorId("checker_2"), "finance_controller");
  store.seedAssignment(A, actorId("retired_user"), "retired_role");
  store.seedAssignment(B, actorId("admin_B"), "tenant_administrator");
  const authorizer = createTenantAuthorizer({ grants: store, constraints: store });
  let counter = 0;
  const audit = createAuditRecorder({ policy: createAuditPolicy(ROLE_AUDIT_FIELDS), clock: () => NOW, newId: () => `aud_${++counter}` });
  const roleAdmin = createRoleAdministration({ persistence: store, authorizer, audit, clock: () => NOW, newEventId: () => `evt_${++counter}` });
  return { store, authorizer, roleAdmin };
}

test("TC-002-03-01 permissions are deny-by-default and derived only from active roles", async () => {
  const { authorizer } = fixture();
  const granted = new Map<string, readonly string[]>([
    ["admin_1", ["tenant:role:manage", "tenant:role:assign"]],
    ["maker_1", ["approval:request:propose", "pricing:rate_card:activate"]],
    ["checker_1", ["approval:request:decide", "audit:read"]],
    ["retired_user", []],
    ["nobody", []],
  ]);
  for (const [actor, permissions] of granted) {
    await runWithTenantContext(contextFor(A, actor), async () => {
      for (const permission of PERMISSION_CATALOG) {
        assert.equal(await authorizer.hasPermission(permission), permissions.includes(permission), `${actor} ${permission}`);
      }
    });
  }
  assert.equal(effectivePermissions([]).size, 0);
});

test("TC-002-03-01 an unknown permission is a configuration error, never a silent allow", async () => {
  const { authorizer } = fixture();
  await runWithTenantContext(contextFor(A, "admin_1"), async () => {
    await assert.rejects(authorizer.assertPermission("tenant:everything"), denied("unknown_permission"));
  });
});

test("TC-002-03-01 denial is generic and requires trusted context", async () => {
  const { authorizer } = fixture();
  await runWithTenantContext(contextFor(A, "maker_1"), async () => {
    await assert.rejects(authorizer.assertPermission("audit:read"), (error: unknown) => {
      assert.ok(error instanceof PlatformProblem);
      assert.equal(error.problem.code, "permission_denied");
      assert.equal(error.problem.correlation_id, "corr_rbac_1");
      assert.equal(error.problem.detail.includes("audit:read"), false);
      return true;
    });
  });
  await assert.rejects(authorizer.assertPermission("audit:read"), denied("tenant_context_missing"));
});

test("TC-002-03-01 roles never carry across tenants", async () => {
  const { authorizer } = fixture();
  // admin_1 administers tenant A only; the same actor in tenant B holds nothing.
  await runWithTenantContext(contextFor(B, "admin_1"), async () => {
    assert.equal(await authorizer.hasPermission("tenant:role:assign"), false);
  });
  await runWithTenantContext(contextFor(B, "admin_B"), async () => {
    assert.equal(await authorizer.hasPermission("tenant:role:assign"), true);
  });
  await runWithTenantContext(contextFor(A, "admin_B"), async () => {
    assert.equal(await authorizer.hasPermission("tenant:role:assign"), false);
  });
});

test("TC-002-03-01 workload principals need the permission as an explicit scope, not a role", async () => {
  const { authorizer } = fixture();
  await runWithTenantContext(contextFor(A, "svc_1", { kind: "workload", scopes: ["audit:read"] }), async () => {
    assert.equal(await authorizer.hasPermission("audit:read"), true);
    assert.equal(await authorizer.hasPermission("tenant:role:assign"), false);
  });
});

test("role administration assigns, revokes and audits atomically; revocation applies on the next check", async () => {
  const { store, authorizer, roleAdmin } = fixture();
  await runWithTenantContext(contextFor(A, "admin_1"), async () => {
    await roleAdmin.assignRole({ targetActorId: "new_hire", roleCode: "finance_controller" });
  });
  await runWithTenantContext(contextFor(A, "new_hire"), async () => {
    assert.equal(await authorizer.hasPermission("approval:request:decide"), true);
  });
  await runWithTenantContext(contextFor(A, "admin_1"), async () => {
    await roleAdmin.revokeRole({ targetActorId: "new_hire", roleCode: "finance_controller" });
  });
  await runWithTenantContext(contextFor(A, "new_hire"), async () => {
    assert.equal(await authorizer.hasPermission("approval:request:decide"), false);
  });
  assert.deepEqual(store.committed.audit.map((row) => row.action), ["role.assigned", "role.revoked"]);
  assert.deepEqual(store.committed.outbox.map((row) => row.type), ["com.subrevos.role.assigned.v1", "com.subrevos.role.revoked.v1"]);
  assert.equal(store.committed.outbox[0]!.tenant_id, "tenant_A");
  assert.deepEqual(store.committed.audit[0]!.actor, { id: "admin_1", kind: "interactive" });
  assert.deepEqual(store.committed.audit[0]!.after, { role_code: "finance_controller" });
});

test("role administration is restricted: non-admins denied, self-change blocked, cross-tenant roles invisible", async () => {
  const { store, roleAdmin } = fixture();
  await runWithTenantContext(contextFor(A, "maker_1"), async () => {
    await assert.rejects(roleAdmin.assignRole({ targetActorId: "x", roleCode: "finance_controller" }), denied("permission_denied"));
  });
  assert.equal(store.transactionsStarted, 0, "authorization precedes any transaction");
  await runWithTenantContext(contextFor(A, "admin_1"), async () => {
    await assert.rejects(roleAdmin.assignRole({ targetActorId: "admin_1", roleCode: "finance_controller" }), denied("separation_of_duties_violation"));
    await assert.rejects(roleAdmin.assignRole({ targetActorId: "x", roleCode: "retired_role" }), denied("role_not_found"));
    await assert.rejects(roleAdmin.assignRole({ targetActorId: "maker_1", roleCode: "pricing_manager" }), denied("role_assignment_exists"));
    await assert.rejects(roleAdmin.revokeRole({ targetActorId: "nobody", roleCode: "pricing_manager" }), denied("role_assignment_not_found"));
  });
  assert.equal(store.committed.audit.length, 0);
});

test("a failed audit write rolls the role assignment back", async () => {
  const { store, roleAdmin, authorizer } = fixture();
  store.failAuditOnce = true;
  await runWithTenantContext(contextFor(A, "admin_1"), async () => {
    await assert.rejects(roleAdmin.assignRole({ targetActorId: "new_hire", roleCode: "finance_controller" }));
  });
  await runWithTenantContext(contextFor(A, "new_hire"), async () => {
    assert.equal(await authorizer.hasPermission("approval:request:decide"), false);
  });
  assert.equal(store.committed.outbox.length, 0);
});


// ABAC: constraints may only narrow an RBAC grant and fail closed.

const refundLimit: PermissionConstraint = { permission: "payments:payment:refund", attribute: "amount_minor", operator: "lte", value: 50_000 };

test("ABAC constraint evaluation is deterministic and fails closed", () => {
  assert.equal(constraintsSatisfied([], {}), true);
  assert.equal(constraintsSatisfied([refundLimit], { amount_minor: 50_000 }), true);
  assert.equal(constraintsSatisfied([refundLimit], { amount_minor: 50_001 }), false);
  assert.equal(constraintsSatisfied([refundLimit], {}), false, "missing attribute");
  assert.equal(constraintsSatisfied([refundLimit], { amount_minor: "10" }), false, "type mismatch");
  assert.equal(constraintsSatisfied([refundLimit], { amount_minor: Number.NaN }), false, "non-finite");
  assert.equal(constraintsSatisfied([{ ...refundLimit, operator: "between" as never }], { amount_minor: 1 }), false, "unknown operator");
  assert.equal(constraintsSatisfied([{ ...refundLimit, attribute: "region", operator: "in", value: ["us"] }], { region: "us" }), true);
  assert.equal(constraintsSatisfied([{ ...refundLimit, attribute: "region", operator: "eq", value: ["us"] }], { region: "us" }), false);
  assert.equal(constraintsSatisfied([refundLimit, { ...refundLimit, attribute: "region", operator: "eq", value: "us" }], { amount_minor: 1, region: "eu" }), false, "all constraints must hold");
  assert.equal(constraintsSatisfied([{ ...refundLimit, attribute: "constructor" }], {}), false, "inherited properties are not attributes");
});

test("ABAC narrows a grant but never creates one, and an evaluator failure denies", async () => {
  const { store, authorizer } = fixture();
  store.seedRole(A, { roleCode: "refund_agent", permissions: ["payments:payment:refund"], status: "active" });
  store.seedAssignment(A, actorId("agent_1"), "refund_agent");
  store.constraints = [refundLimit, { permission: "audit:read", attribute: "region", operator: "eq", value: "us" }];

  await runWithTenantContext(contextFor(A, "agent_1"), async () => {
    assert.equal(await authorizer.hasPermission("payments:payment:refund", { amount_minor: 10_000 }), true);
    assert.equal(await authorizer.hasPermission("payments:payment:refund", { amount_minor: 90_000 }), false);
    assert.equal(await authorizer.hasPermission("payments:payment:refund"), false, "absent attribute denies");
    assert.equal(await authorizer.hasPermission("audit:read", { region: "us" }), false, "a satisfied constraint cannot grant an unassigned permission");
    store.constraintStoreFails = true;
    assert.equal(await authorizer.hasPermission("payments:payment:refund", { amount_minor: 1 }), false, "constraint store failure denies");
    await assert.rejects(authorizer.assertPermission("payments:payment:refund", { amount_minor: 1 }), denied("permission_denied"));
  });
});

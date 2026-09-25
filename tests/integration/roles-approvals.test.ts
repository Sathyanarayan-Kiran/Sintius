import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import pg from "pg";
import { APPROVAL_AUDIT_FIELDS, createApprovalCommands } from "../../modules/audit-governance/application/approval-commands.ts";
import { PostgresApprovalPersistence } from "../../modules/audit-governance/infrastructure/postgres/approval-persistence.ts";
import type { ApprovalTarget } from "../../modules/audit-governance/domain/approval.ts";
import { ROLE_AUDIT_FIELDS, createRoleAdministration, createTenantAuthorizer } from "../../modules/identity-tenant/application/authorization.ts";
import { createPostgresApprovalPolicyReader } from "../../modules/identity-tenant/infrastructure/postgres/approval-policy-reader.ts";
import { PostgresPermissionGrantStore } from "../../modules/identity-tenant/infrastructure/postgres/grant-store.ts";
import { PostgresSecurityPersistence } from "../../modules/identity-tenant/infrastructure/postgres/security-persistence.ts";
import { DEFAULT_APPROVAL_POLICIES } from "../../modules/identity-tenant/domain/approval-defaults.ts";
import { defaultPersonaRoleTemplates } from "../../modules/identity-tenant/domain/persona-matrix.ts";
import { createAuditPolicy, createAuditRecorder, type AuditRecorder } from "../../platform/audit/src/index.ts";
import { PlatformProblem } from "../../platform/problem-model/src/index.ts";
import { resolveTenantContext, runWithTenantContext, tenantId, type TenantId } from "../../platform/tenant-context/src/index.ts";
import { testPrincipal } from "../support/authenticated-principal.ts";

/**
 * Role administration and maker-checker on PostgreSQL, composed as the application root composes
 * them: the live tenant authorizer, the role and approval persistences, and the approval-policy
 * reader that Identity & Tenant supplies to Audit & Governance.
 */

const { Pool } = pg;
const adminUrl = process.env.SINTIUS_MIGRATION_DATABASE_URL ?? "postgresql://sintius_admin@127.0.0.1:54329/sintius";
const appUrl = process.env.SINTIUS_DATABASE_URL ?? "postgresql://sintius_app@127.0.0.1:54329/sintius";
const admin = new Pool({ connectionString: adminUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });
const NOW = new Date("2026-09-25T09:00:00.000Z");
const A = tenantId("tenant_rbac_A");
const B = tenantId("tenant_rbac_B");
const PRODUCT = "pricing:rate_card:activate";
const FINANCE = "billing:invoice:finalize";
const TARGET: ApprovalTarget = { actionType: "pricing:rate_card:activate", targetType: "RateCard", targetId: "rc_1", targetVersion: 3 };

let ids = 0;
const opened: { close(): Promise<void> }[] = [];
function open<T extends { close(): Promise<void> }>(resource: T): T {
  opened.push(resource);
  return resource;
}

const code = (expected: string) => (error: unknown) => error instanceof PlatformProblem && error.problem.code === expected;

function as<T>(tenant: TenantId, actor: string, work: () => Promise<T>): Promise<T> {
  const context = resolveTenantContext({
    principal: testPrincipal([tenant], { actor }),
    selectedTenantId: tenant,
    tenantState: "ACTIVE",
    correlationId: `corr_rbac_${++ids}`,
  });
  return runWithTenantContext(context, work);
}

function compose(options: { readonly failingAudit?: boolean } = {}) {
  const grants = open(new PostgresPermissionGrantStore({ connectionString: appUrl }));
  const authorizer = createTenantAuthorizer({ grants });
  const recorder = (fields: Readonly<Record<string, readonly string[]>>): AuditRecorder => {
    const real = createAuditRecorder({ policy: createAuditPolicy(fields), clock: () => NOW, newId: () => `aud_rbac_${++ids}` });
    if (options.failingAudit !== true) return real;
    return { ...real, recordForCurrentContext: async () => { throw new Error("audit store unavailable"); } };
  };
  const roleAdmin = createRoleAdministration({
    persistence: open(new PostgresSecurityPersistence({ connectionString: appUrl, maxConnections: 6 })),
    authorizer,
    audit: recorder(ROLE_AUDIT_FIELDS),
    clock: () => NOW,
  });
  const approvals = createApprovalCommands({
    persistence: open(new PostgresApprovalPersistence({ connectionString: appUrl, maxConnections: 6, policies: (transaction) => createPostgresApprovalPolicyReader(transaction) })),
    authorizer,
    audit: recorder(APPROVAL_AUDIT_FIELDS),
    clock: () => NOW,
    newApprovalId: () => `apr_rbac_${++ids}`,
  });
  return { authorizer, roleAdmin, approvals };
}

async function seedRole(tenant: TenantId, roleCode: string, permissions: readonly string[]) {
  await admin.query("INSERT INTO tenant_role (tenant_id, role_code, permissions) VALUES ($1, $2, $3::jsonb)", [tenant, roleCode, JSON.stringify(permissions)]);
}
async function seedAssignment(tenant: TenantId, actor: string, roleCode: string) {
  await admin.query("INSERT INTO tenant_role_assignment (tenant_id, actor_id, role_code) VALUES ($1, $2, $3)", [tenant, actor, roleCode]);
}
async function rows(sql: string, parameters: unknown[] = []) {
  return (await admin.query(sql, parameters)).rows;
}

beforeEach(async () => {
  await Promise.all(opened.splice(0).map((resource) => resource.close()));
  await admin.query("TRUNCATE outbox_event, audit_event, approval_policy, tenant_role_assignment, tenant_role, tenant RESTART IDENTITY CASCADE");
  await admin.query(
    `INSERT INTO tenant (tenant_id, display_name, state, row_version, created_at, updated_at)
     VALUES ($1, 'RBAC A', 'ACTIVE', 1, $3, $3), ($2, 'RBAC B', 'ACTIVE', 1, $3, $3)`,
    [A, B, NOW.toISOString()],
  );
  await seedRole(A, "tenant_administrator", ["tenant:role:manage", "tenant:role:assign"]);
  await seedRole(A, "security_officer", ["tenant:role:assign"]);
  await seedRole(A, "pricing_manager", ["approval:request:propose", PRODUCT]);
  await seedRole(A, "product_approver", ["approval:request:decide", PRODUCT]);
  await seedRole(A, "finance_controller", ["approval:request:decide", FINANCE]);
  await seedRole(B, "tenant_administrator", ["tenant:role:manage", "tenant:role:assign"]);
  await seedAssignment(A, "admin_1", "tenant_administrator");
  await seedAssignment(A, "officer_1", "security_officer");
  await seedAssignment(A, "maker_1", "pricing_manager");
  await seedAssignment(B, "admin_B", "tenant_administrator");
});

after(async () => {
  await Promise.all(opened.splice(0).map((resource) => resource.close()));
  await Promise.all([admin.end(), app.end()]);
});

test("TC-002-03-01 PostgreSQL role administration: a grant applies on the next check, revocation removes it, re-assignment restores it", async () => {
  const { authorizer, roleAdmin } = compose();
  const canDecide = () => as(A, "checker_1", () => authorizer.hasPermission("approval:request:decide"));
  assert.equal(await canDecide(), false, "deny by default");

  await as(A, "admin_1", () => roleAdmin.assignRole({ targetActorId: "checker_1", roleCode: "finance_controller" }));
  assert.equal(await canDecide(), true);
  await as(A, "admin_1", () => roleAdmin.revokeRole({ targetActorId: "checker_1", roleCode: "finance_controller" }));
  assert.equal(await canDecide(), false, "revocation applies on the next check");
  await as(A, "admin_1", () => roleAdmin.assignRole({ targetActorId: "checker_1", roleCode: "finance_controller" }));
  assert.equal(await canDecide(), true, "a revoked assignment can be restored");

  await as(A, "admin_1", async () => {
    await assert.rejects(roleAdmin.assignRole({ targetActorId: "checker_1", roleCode: "finance_controller" }), code("role_assignment_exists"));
    await assert.rejects(roleAdmin.revokeRole({ targetActorId: "nobody", roleCode: "finance_controller" }), code("role_assignment_not_found"));
    await assert.rejects(roleAdmin.assignRole({ targetActorId: "x", roleCode: "no_such_role" }), code("role_not_found"));
  });
  await as(A, "maker_1", async () => {
    await assert.rejects(roleAdmin.assignRole({ targetActorId: "x", roleCode: "finance_controller" }), code("permission_denied"));
  });
  await as(B, "admin_B", async () => {
    await assert.rejects(roleAdmin.assignRole({ targetActorId: "checker_1", roleCode: "finance_controller" }), code("role_not_found"), "tenant A's roles are invisible to tenant B");
  });

  assert.deepEqual(
    (await rows("SELECT action, target->>'id' AS actor, correlation_id IS NOT NULL AS traced FROM audit_event WHERE tenant_id = $1 ORDER BY recorded_at, audit_event_id", [A])).map((row) => [row.action, row.actor]),
    [["role.assigned", "checker_1"], ["role.revoked", "checker_1"], ["role.assigned", "checker_1"]],
  );
  assert.equal((await rows("SELECT count(*)::int AS n FROM outbox_event WHERE tenant_id = $1 AND event_type LIKE '%role.%'", [A]))[0].n, 3);
});

test("TC-017-01-01 a failed audit write rolls the PostgreSQL role change and approval decision back", async () => {
  const failing = compose({ failingAudit: true });
  await as(A, "admin_1", async () => {
    await assert.rejects(failing.roleAdmin.assignRole({ targetActorId: "checker_1", roleCode: "finance_controller" }), /audit store unavailable/);
  });
  assert.deepEqual(await rows("SELECT * FROM tenant_role_assignment WHERE tenant_id = $1 AND actor_id = 'checker_1'", [A]), [], "the assignment rolled back");

  await admin.query("INSERT INTO approval_policy (tenant_id, action_type, required_approvals, expires_after_seconds) VALUES ($1, $2, 1, 3600)", [A, TARGET.actionType]);
  await as(A, "maker_1", async () => {
    await assert.rejects(failing.approvals.proposeApproval(TARGET), /audit store unavailable/);
  });
  assert.deepEqual(await rows("SELECT * FROM approval_request"), [], "the proposal rolled back");
  assert.deepEqual(await rows("SELECT * FROM outbox_event"), [], "no event escaped either failed command");
});

test("D3 PostgreSQL: the last administrator is protected, even when two administrators revoke each other at once", async () => {
  const { roleAdmin } = compose();
  await as(A, "officer_1", async () => {
    await assert.rejects(roleAdmin.revokeRole({ targetActorId: "admin_1", roleCode: "tenant_administrator" }), code("last_administrator_protected"));
  });

  // Each round: the surviving administrator and a newly added one revoke each other at the same
  // moment. The role row lock must serialize them so that exactly one administrator always remains.
  let survivor = "admin_1";
  for (let round = 1; round <= 8; round += 1) {
    const challenger = `admin_round_${round}`;
    await seedAssignment(A, challenger, "tenant_administrator");
    const results = await Promise.allSettled([
      as(A, survivor, () => roleAdmin.revokeRole({ targetActorId: challenger, roleCode: "tenant_administrator" })),
      as(A, challenger, () => roleAdmin.revokeRole({ targetActorId: survivor, roleCode: "tenant_administrator" })),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"], `round ${round}: exactly one mutual revocation wins`);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    // The loser is refused either by the guard (it counted one remaining administrator) or, if the
    // winner committed before the loser's own authorization ran, because it is no longer an administrator.
    assert.ok(
      code("last_administrator_protected")(rejected.reason) || code("permission_denied")(rejected.reason),
      `round ${round}: the loser is refused by the guard or by its lost authority`,
    );
    const active = await rows("SELECT actor_id FROM tenant_role_assignment WHERE tenant_id = $1 AND role_code = 'tenant_administrator' AND status = 'active'", [A]);
    assert.equal(active.length, 1, `round ${round}: the tenant still has exactly one administrator`);
    survivor = String(active[0]!.actor_id);
  }
});

test("TC-002-03-02 PostgreSQL maker-checker: the maker cannot approve; a second party approves with audit and event committed together", async () => {
  const { approvals } = compose();
  await admin.query("INSERT INTO approval_policy (tenant_id, action_type, required_approvals, expires_after_seconds) VALUES ($1, $2, 1, 3600)", [A, TARGET.actionType]);
  await seedAssignment(A, "maker_1", "finance_controller");
  await seedAssignment(A, "checker_1", "finance_controller");

  const proposed = await as(A, "maker_1", () => approvals.proposeApproval(TARGET));
  const decide = (actor: string, version = 1, target = TARGET) =>
    as(A, actor, () => approvals.decideApproval({ approvalId: proposed.id, decision: "approve", expectedVersion: version, target }));
  await assert.rejects(decide("maker_1"), code("separation_of_duties_violation"), "the maker holds decide but still cannot approve their own request");
  await assert.rejects(decide("checker_1", 1, { ...TARGET, targetVersion: 4 }), code("approval_target_mismatch"));
  const approved = await decide("checker_1");
  assert.deepEqual([approved.status, approved.version], ["APPROVED", 2]);
  await assert.rejects(decide("checker_1", 2), code("approval_not_pending"), "a settled request is never reused");

  const stored = (await rows("SELECT status, row_version, decisions FROM approval_request WHERE approval_id = $1", [proposed.id]))[0];
  assert.deepEqual([stored.status, Number(stored.row_version), stored.decisions.map((item: { actorId: string }) => item.actorId)], ["APPROVED", 2, ["checker_1"]]);
  assert.deepEqual(
    (await rows("SELECT action, approval_id FROM audit_event WHERE tenant_id = $1 AND approval_id IS NOT NULL ORDER BY recorded_at, audit_event_id", [A])).map((row) => row.action),
    ["approval.requested", "approval.approved"],
  );
  assert.deepEqual(
    (await rows("SELECT event_type FROM outbox_event WHERE tenant_id = $1 AND aggregate_type = 'ApprovalRequest' ORDER BY entry_id", [A])).map((row) => row.event_type),
    ["com.subrevos.approval.requested.v1", "com.subrevos.approval.decided.v1"],
  );
  await as(B, "admin_B", async () => {
    await assert.rejects(approvals.decideApproval({ approvalId: proposed.id, decision: "approve", expectedVersion: 2, target: TARGET }), code("permission_denied"));
  });
});

test("PostgreSQL approval decisions use compare-and-set: two approvers on the same version, one wins", async () => {
  const { approvals } = compose();
  await admin.query("INSERT INTO approval_policy (tenant_id, action_type, required_approvals, expires_after_seconds) VALUES ($1, $2, 2, 3600)", [A, TARGET.actionType]);
  await seedAssignment(A, "checker_1", "finance_controller");
  await seedAssignment(A, "checker_2", "finance_controller");
  const proposed = await as(A, "maker_1", () => approvals.proposeApproval(TARGET));
  const results = await Promise.allSettled(
    ["checker_1", "checker_2"].map((actor) => as(A, actor, () => approvals.decideApproval({ approvalId: proposed.id, decision: "approve", expectedVersion: 1, target: TARGET }))),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.ok(code("approval_version_conflict")((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason));
  const stored = (await rows("SELECT status, row_version, jsonb_array_length(decisions) AS decisions FROM approval_request"))[0];
  assert.deepEqual([stored.status, Number(stored.row_version), stored.decisions], ["PENDING", 2, 1], "exactly one decision was recorded");

  // The database compare-and-set is enforced on its own, not only by the domain's version check.
  const persistence = open(new PostgresApprovalPersistence({ connectionString: appUrl, policies: (transaction) => createPostgresApprovalPolicyReader(transaction) }));
  await as(A, "checker_2", () =>
    persistence.runInTransaction({ correlationId: "corr_cas" }, async (unitOfWork) => {
      const current = await unitOfWork.approvals.findById(A, proposed.id);
      assert.equal(current?.version, 2);
      await assert.rejects(unitOfWork.approvals.update({ ...current!, version: 3 }, 1), code("approval_version_conflict"), "a stale expected version is refused by the database");
    }),
  );
});

test("D4 PostgreSQL: a pricing activation needs a Product and a Finance approver, checked against live role grants", async () => {
  const { approvals, roleAdmin } = compose();
  await admin.query(
    "INSERT INTO approval_policy (tenant_id, action_type, required_approvals, expires_after_seconds, approver_requirements) VALUES ($1, $2, 1, 3600, $3::jsonb)",
    [A, TARGET.actionType, JSON.stringify([{ permission: PRODUCT, count: 1 }, { permission: FINANCE, count: 1 }])],
  );
  await seedAssignment(A, "product_1", "product_approver");
  await seedAssignment(A, "finance_1", "finance_controller");
  await seedAssignment(A, "product_2", "product_approver");
  const proposed = await as(A, "maker_1", () => approvals.proposeApproval(TARGET));
  const decide = (actor: string, version: number) =>
    as(A, actor, () => approvals.decideApproval({ approvalId: proposed.id, decision: "approve", expectedVersion: version, target: TARGET }));

  const afterProduct = await decide("product_1", 1);
  assert.deepEqual([afterProduct.status, afterProduct.decisions[0]?.creditedPermission], ["PENDING", PRODUCT]);
  await assert.rejects(decide("product_2", 2), code("approval_approver_not_eligible"), "Product is already satisfied");

  await as(A, "admin_1", () => roleAdmin.revokeRole({ targetActorId: "finance_1", roleCode: "finance_controller" }));
  await assert.rejects(decide("finance_1", 2), code("permission_denied"), "a revoked approver cannot decide");
  await as(A, "admin_1", () => roleAdmin.assignRole({ targetActorId: "finance_1", roleCode: "finance_controller" }));
  const approved = await decide("finance_1", 2);
  assert.deepEqual([approved.status, approved.decisions.map((item) => item.creditedPermission)], ["APPROVED", [PRODUCT, FINANCE]]);
});

test("approval evidence is append-only and tenant-isolated in the database itself", async () => {
  const { approvals } = compose();
  await admin.query("INSERT INTO approval_policy (tenant_id, action_type, required_approvals, expires_after_seconds) VALUES ($1, $2, 1, 3600)", [A, TARGET.actionType]);
  await seedAssignment(A, "checker_1", "finance_controller");
  const settled = await as(A, "maker_1", () => approvals.proposeApproval(TARGET));
  await as(A, "checker_1", () => approvals.decideApproval({ approvalId: settled.id, decision: "approve", expectedVersion: 1, target: TARGET }));

  async function attempt(tenant: TenantId, sql: string, parameters: unknown[] = []) {
    const client = await app.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
      return await client.query(sql, parameters);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const sqlState = (state: string) => (error: unknown) => (error as { code?: string }).code === state;
  await assert.rejects(attempt(A, "UPDATE approval_request SET target_id = 'rc_other'"), sqlState("42501"), "the governed target cannot be rewritten");
  await assert.rejects(attempt(A, "DELETE FROM approval_request"), sqlState("42501"), "evidence cannot be deleted");
  await assert.rejects(
    attempt(A, "UPDATE approval_request SET status = 'PENDING', row_version = row_version + 1 WHERE approval_id = $1", [settled.id]),
    sqlState("23514"),
    "a settled request cannot be reopened",
  );
  const pending = await as(A, "maker_1", () => approvals.proposeApproval({ ...TARGET, targetId: "rc_2" }));
  await attempt(A, "UPDATE approval_request SET decisions = '[{\"actorId\":\"x\",\"decision\":\"approve\",\"decidedAt\":\"2026-09-25T09:00:00.000Z\"}]'::jsonb, row_version = 2 WHERE approval_id = $1", [pending.id]);
  await assert.rejects(
    attempt(A, "UPDATE approval_request SET row_version = row_version + 5 WHERE approval_id = $1", [pending.id]),
    sqlState("23514"),
    "versions advance one at a time",
  );
  assert.equal((await attempt(B, "SELECT * FROM approval_request")).rowCount, 0, "tenant B sees none of tenant A's requests");
});

test("D9 PostgreSQL persona roles: role limits bind only their own role, and the default pricing policy needs the Product Manager and the Finance Controller", async () => {
  const { approvals, authorizer } = compose();
  for (const template of defaultPersonaRoleTemplates()) {
    await admin.query(
      "INSERT INTO tenant_role (tenant_id, role_code, permissions, permission_limits) VALUES ($1, $2, $3::jsonb, $4::jsonb)",
      [A, `persona_${template.roleCode}`, JSON.stringify(template.permissions), JSON.stringify(template.limits)],
    );
  }
  for (const policy of DEFAULT_APPROVAL_POLICIES) {
    await admin.query(
      "INSERT INTO approval_policy (tenant_id, action_type, required_approvals, separation_of_duties, expires_after_seconds, approver_requirements) VALUES ($1, $2, $3, $4, $5, $6::jsonb)",
      [A, policy.actionType, policy.requiredApprovals, policy.separationOfDuties, policy.expiresAfterSeconds, JSON.stringify(policy.approverRequirements)],
    );
  }
  for (const [actor, persona] of [["billing_1", "billing_administrator"], ["controller_1", "finance_controller"], ["product_1", "product_manager"], ["pricing_1", "pricing_manager"]]) {
    await seedAssignment(A, actor!, `persona_${persona}`);
  }

  const refund = (actor: string, minorUnits: number) => as(A, actor, () => authorizer.hasPermission("payments:payment:refund", { amount_minor: minorUnits }));
  assert.deepEqual(
    [await refund("billing_1", 1_000_000), await refund("billing_1", 1_000_001), await refund("controller_1", 25_000_000)],
    [true, false, true],
    "the Billing Administrator's USD 10,000 limit is read from PostgreSQL and binds only that role",
  );

  const target: ApprovalTarget = { ...TARGET, targetId: "rc_persona" };
  const proposed = await as(A, "pricing_1", () => approvals.proposeApproval(target));
  assert.equal(proposed.requiredApprovals, 2);
  const decide = (actor: string, version: number) =>
    as(A, actor, () => approvals.decideApproval({ approvalId: proposed.id, decision: "approve", expectedVersion: version, target }));
  await assert.rejects(decide("pricing_1", 1), code("permission_denied"), "the Pricing Manager proposes but never decides");
  await assert.rejects(decide("billing_1", 1), code("permission_denied"), "the Billing Administrator is not an approver");
  const afterProduct = await decide("product_1", 1);
  assert.deepEqual([afterProduct.status, afterProduct.decisions[0]?.creditedPermission], ["PENDING", PRODUCT]);
  const approved = await decide("controller_1", 2);
  assert.deepEqual([approved.status, approved.decisions.map((item) => item.creditedPermission)], ["APPROVED", [PRODUCT, FINANCE]]);
});

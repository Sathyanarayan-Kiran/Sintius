import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";
import { createAuditPolicy, createAuditRecorder } from "../../../platform/audit/src/index.ts";
import { PlatformProblem } from "../../../platform/problem-model/src/index.ts";
import { resolvePlatformCommandContext } from "../../../platform/tenant-context/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import { TENANT_AUDIT_FIELDS, createTenantCommands } from "../application/tenant-commands.ts";
import { PostgresTenantPersistence } from "../infrastructure/postgres/tenant-persistence.ts";
import { AllowListAuthorizer } from "./in-memory-persistence.ts";

const { Pool } = pg;
const adminUrl = process.env.SINTIUS_MIGRATION_DATABASE_URL ?? "postgresql://sintius_admin@127.0.0.1:54329/sintius";
const appUrl = process.env.SINTIUS_DATABASE_URL ?? "postgresql://sintius_app@127.0.0.1:54329/sintius";
const admin = new Pool({ connectionString: adminUrl, max: 3 });
const app = new Pool({ connectionString: appUrl, max: 3 });
const NOW = new Date("2026-09-24T10:00:00.000Z");

let persistence: PostgresTenantPersistence;
let sequence = 0;

function context(actor = "operator_1") {
  return resolvePlatformCommandContext({
    principal: testPrincipal([], { actor }),
    correlationId: `corr_pg_${++sequence}`,
  });
}

function commands(audit = createAuditRecorder({
  policy: createAuditPolicy(TENANT_AUDIT_FIELDS),
  clock: () => NOW,
  newId: () => `aud_pg_${++sequence}`,
})) {
  return createTenantCommands({
    persistence,
    authorizer: new AllowListAuthorizer(["tenant:provision", "tenant:manage_lifecycle"]),
    audit,
    clock: () => NOW,
    newEventId: () => `evt_pg_${++sequence}`,
  });
}

async function count(table: string, tenant: string): Promise<number> {
  const result = await admin.query(`SELECT count(*)::int AS count FROM ${table} WHERE tenant_id = $1`, [tenant]);
  return result.rows[0].count;
}

before(async () => {
  await admin.query("SELECT 1 FROM schema_migration LIMIT 1");
});

beforeEach(async () => {
  await persistence?.close();
  persistence = new PostgresTenantPersistence({ connectionString: appUrl, maxConnections: 5 });
  await admin.query("TRUNCATE outbox_event, audit_event, approval_policy, tenant_role_assignment, tenant_role, tenant_identity_provider, tenant RESTART IDENTITY CASCADE");
});

after(async () => {
  await persistence?.close();
  await Promise.all([admin.end(), app.end()]);
});

test("TC-002-01-03 PostgreSQL commits tenant, default role, administrator, audit and outbox atomically", async () => {
  const service = commands();
  const tenant = await service.provisionTenant(context(), {
    tenantId: "tenant_pg_A",
    displayName: "Postgres tenant",
    initialAdministratorActorId: "admin_pg_A",
  });

  assert.equal(tenant.state, "PROVISIONING");
  assert.equal(await count("tenant", tenant.id), 1);
  assert.equal(await count("tenant_role", tenant.id), 1);
  assert.equal(await count("tenant_role_assignment", tenant.id), 1);
  assert.equal(await count("audit_event", tenant.id), 1);
  assert.equal(await count("outbox_event", tenant.id), 1);
  const row = await admin.query("SELECT state, row_version FROM tenant WHERE tenant_id = $1", [tenant.id]);
  assert.deepEqual(row.rows[0], { state: "PROVISIONING", row_version: "1" });
});

test("TC-002-01-03 a PostgreSQL failure rolls every earlier provisioning write back", async () => {
  const regularAudit = createAuditRecorder({ policy: createAuditPolicy(TENANT_AUDIT_FIELDS), clock: () => NOW });
  const failingAudit = Object.freeze({
    ...regularAudit,
    recordForPlatformCommand: async () => {
      throw new Error("injected PostgreSQL integration audit failure");
    },
  });

  await assert.rejects(
    commands(failingAudit).provisionTenant(context(), {
      tenantId: "tenant_pg_rollback",
      displayName: "Must roll back",
      initialAdministratorActorId: "admin_rollback",
    }),
    /injected PostgreSQL integration audit failure/,
  );

  for (const table of ["tenant", "tenant_role", "tenant_role_assignment", "audit_event", "outbox_event"]) {
    assert.equal(await count(table, "tenant_pg_rollback"), 0, `${table} must roll back`);
  }
});

test("TC-001-01-03 transaction-local tenant binding and forced RLS prevent cross-tenant access", async () => {
  const service = commands();
  await service.provisionTenant(context("operator_A"), { tenantId: "tenant_pg_A", displayName: "A", initialAdministratorActorId: "admin_A" });
  await service.provisionTenant(context("operator_B"), { tenantId: "tenant_pg_B", displayName: "B", initialAdministratorActorId: "admin_B" });

  const client = await app.connect();
  try {
    const withoutContext = await client.query("SELECT tenant_id FROM tenant ORDER BY tenant_id");
    assert.deepEqual(withoutContext.rows, []);

    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", ["tenant_pg_A"]);
    const visible = await client.query("SELECT tenant_id FROM tenant ORDER BY tenant_id");
    assert.deepEqual(visible.rows, [{ tenant_id: "tenant_pg_A" }]);
    await assert.rejects(
      client.query("INSERT INTO tenant_role (tenant_id, role_code) VALUES ($1, $2)", ["tenant_pg_B", "forged_role"]),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "42501",
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  assert.equal(await count("tenant_role", "tenant_pg_B"), 1, "the denied write must not create a second role");
});

test("TC-002-01-03 concurrent lifecycle updates use database compare-and-set", async () => {
  const service = commands();
  await service.provisionTenant(context(), { tenantId: "tenant_pg_race", displayName: "Race", initialAdministratorActorId: "admin_race" });
  await service.activateTenant(context(), { tenantId: "tenant_pg_race", expectedVersion: 1 });

  const outcomes = await Promise.allSettled([
    service.suspendTenant(context("operator_1"), { tenantId: "tenant_pg_race", expectedVersion: 2, reason: "first" }),
    service.suspendTenant(context("operator_2"), { tenantId: "tenant_pg_race", expectedVersion: 2, reason: "second" }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(failure?.status === "rejected");
  assert.ok(failure.reason instanceof PlatformProblem);
  assert.equal(failure.reason.problem.code, "tenant_version_conflict");

  const row = await admin.query("SELECT state, row_version FROM tenant WHERE tenant_id = 'tenant_pg_race'");
  assert.deepEqual(row.rows[0], { state: "SUSPENDED", row_version: "3" });
  assert.equal(await count("audit_event", "tenant_pg_race"), 3);
  assert.equal(await count("outbox_event", "tenant_pg_race"), 3);
});

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";
import { createAuditPolicy, createAuditRecorder } from "../../../platform/audit/src/index.ts";
import { createIdempotentExecutor, type StoredResponse } from "../../../platform/idempotency/src/index.ts";
import { PlatformProblem } from "../../../platform/problem-model/src/index.ts";
import {
  resolvePlatformCommandContext,
  resolveTenantContext,
  runWithTenantContext,
  tenantId,
  type TenantId,
} from "../../../platform/tenant-context/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import { FOUNDATION_PROOF_AUDIT_FIELDS, createFoundationProofCommand } from "../../foundation-proof/application/proof-command.ts";
import { FOUNDATION_PROOF_PERMISSION } from "../../foundation-proof/application/ports.ts";
import { PostgresFoundationProofPersistence } from "../../foundation-proof/infrastructure/postgres/proof-persistence.ts";
import { TENANT_AUDIT_FIELDS, createTenantCommands } from "../application/tenant-commands.ts";
import type { TenantUnitOfWork } from "../application/ports.ts";
import { PostgresTenantPersistence } from "../infrastructure/postgres/tenant-persistence.ts";
import { AllowListAuthorizer } from "./in-memory-persistence.ts";
import { testIdempotencyKey } from "../../../tests/support/idempotency-key.ts";

const { Pool } = pg;
const adminUrl = process.env.SINTIUS_MIGRATION_DATABASE_URL ?? "postgresql://sintius_admin@127.0.0.1:54329/sintius";
const appUrl = process.env.SINTIUS_DATABASE_URL ?? "postgresql://sintius_app@127.0.0.1:54329/sintius";
const admin = new Pool({ connectionString: adminUrl, max: 3 });
const app = new Pool({ connectionString: appUrl, max: 3 });
const NOW = new Date("2026-09-24T10:00:00.000Z");

let persistence: PostgresTenantPersistence;
let proofPersistence: PostgresFoundationProofPersistence;
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
  const raw = createTenantCommands({
    persistence,
    authorizer: new AllowListAuthorizer(["tenant:provision", "tenant:manage_lifecycle"]),
    audit,
    clock: () => NOW,
    newEventId: () => `evt_pg_${++sequence}`,
  });
  const metadata = () => ({ idempotencyKey: testIdempotencyKey(`postgres-command-key-${String(++sequence).padStart(8, "0")}`) });
  return Object.freeze({
    provisionTenant: (commandContext: Parameters<typeof raw.provisionTenant>[0], input: Parameters<typeof raw.provisionTenant>[1], commandMetadata = metadata()) =>
      raw.provisionTenant(commandContext, input, commandMetadata),
    activateTenant: (commandContext: Parameters<typeof raw.activateTenant>[0], input: Parameters<typeof raw.activateTenant>[1], commandMetadata = metadata()) =>
      raw.activateTenant(commandContext, input, commandMetadata),
    suspendTenant: (commandContext: Parameters<typeof raw.suspendTenant>[0], input: Parameters<typeof raw.suspendTenant>[1], commandMetadata = metadata()) =>
      raw.suspendTenant(commandContext, input, commandMetadata),
    reactivateTenant: (commandContext: Parameters<typeof raw.reactivateTenant>[0], input: Parameters<typeof raw.reactivateTenant>[1], commandMetadata = metadata()) =>
      raw.reactivateTenant(commandContext, input, commandMetadata),
    closeTenant: (commandContext: Parameters<typeof raw.closeTenant>[0], input: Parameters<typeof raw.closeTenant>[1], commandMetadata = metadata()) =>
      raw.closeTenant(commandContext, input, commandMetadata),
  });
}

async function count(table: string, tenant: string): Promise<number> {
  const result = await admin.query(`SELECT count(*)::int AS count FROM ${table} WHERE tenant_id = $1`, [tenant]);
  return result.rows[0].count;
}

async function countIdempotencyScope(tenant: string, scope: string): Promise<number> {
  const result = await admin.query(
    "SELECT count(*)::int AS count FROM idempotency_record WHERE tenant_id = $1 AND command_scope = $2",
    [tenant, scope],
  );
  return result.rows[0].count;
}

before(async () => {
  await admin.query("SELECT 1 FROM schema_migration LIMIT 1");
});

beforeEach(async () => {
  await persistence?.close();
  await proofPersistence?.close();
  persistence = new PostgresTenantPersistence({ connectionString: appUrl, maxConnections: 12 });
  proofPersistence = new PostgresFoundationProofPersistence({ connectionString: appUrl, maxConnections: 12 });
  await admin.query("TRUNCATE foundation_proof_record, idempotency_record, outbox_event, audit_event, approval_policy, tenant_role_assignment, tenant_role, tenant_identity_provider, tenant RESTART IDENTITY CASCADE");
});

after(async () => {
  await persistence?.close();
  await proofPersistence?.close();
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

test("P0-010 concurrent provisioning retry commits one tenant, audit, outbox and stored response", async () => {
  const service = commands();
  const commandContext = context("operator_proof");
  const input = {
    tenantId: "tenant_phase0_proof",
    displayName: "Phase 0 proof",
    initialAdministratorActorId: "admin_phase0_proof",
  };
  const metadata = { idempotencyKey: testIdempotencyKey("phase0-provision-proof-key-0001") };

  const results = await Promise.all([
    service.provisionTenant(commandContext, input, metadata),
    service.provisionTenant(commandContext, input, metadata),
  ]);

  assert.deepEqual(results[1], results[0]);
  for (const table of ["tenant", "tenant_role", "tenant_role_assignment", "audit_event", "outbox_event", "idempotency_record"]) {
    assert.equal(await count(table, "tenant_phase0_proof"), 1, `${table} must contain exactly one committed record`);
  }
  const stored = await admin.query(
    `SELECT status, response_status, response_body
       FROM idempotency_record
      WHERE tenant_id = $1 AND command_scope = 'tenant.provision'`,
    ["tenant_phase0_proof"],
  );
  assert.deepEqual(stored.rows[0], {
    status: "completed",
    response_status: 201,
    response_body: {
      id: "tenant_phase0_proof",
      state: "PROVISIONING",
      version: 1,
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      display_name: "Phase 0 proof",
    },
  });

  await assert.rejects(
    service.provisionTenant(commandContext, { ...input, displayName: "Changed payload" }, metadata),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "idempotency_key_reused_with_different_payload",
  );
  assert.equal(await count("audit_event", "tenant_phase0_proof"), 1);
  assert.equal(await count("outbox_event", "tenant_phase0_proof"), 1);
});

test("P0-010 active-tenant proof is idempotent, atomic, traced and isolated by PostgreSQL RLS", async () => {
  const [tenantA, tenantB] = await Promise.all([activeTenant("tenant_foundation_A"), activeTenant("tenant_foundation_B")]);
  let proofSequence = 0;
  const proofAudit = createAuditRecorder({
    policy: createAuditPolicy(FOUNDATION_PROOF_AUDIT_FIELDS),
    clock: () => NOW,
    newId: () => `aud_foundation_${++proofSequence}`,
  });
  const proofCommand = createFoundationProofCommand({
    persistence: proofPersistence,
    authorizer: {
      assertPermission: async (permission) => assert.equal(permission, FOUNDATION_PROOF_PERMISSION),
    },
    audit: proofAudit,
    clock: () => NOW,
    newProofRecordId: () => `proof_pg_${++proofSequence}`,
    newEventId: () => `evt_foundation_${++proofSequence}`,
  });
  const metadata = { idempotencyKey: testIdempotencyKey("phase0-active-proof-key-000001") };
  const trustedA = tenantContext(tenantA, "proof_user_A");

  const [first, replay] = await Promise.all([
    runWithTenantContext(trustedA, () => proofCommand({ label: "phase-0-release-gate" }, metadata)),
    runWithTenantContext(trustedA, () => proofCommand({ label: "phase-0-release-gate" }, metadata)),
  ]);
  assert.deepEqual(replay, first);

  const evidence = await admin.query(
    `SELECT
       (SELECT count(*)::int FROM foundation_proof_record WHERE tenant_id = $1) AS proof_count,
       (SELECT count(*)::int FROM audit_event WHERE tenant_id = $1 AND action = 'foundation.proof_recorded') AS audit_count,
       (SELECT count(*)::int FROM outbox_event WHERE tenant_id = $1 AND event_type = 'com.subrevos.foundation.proof_recorded.v1') AS outbox_count,
       (SELECT count(*)::int FROM idempotency_record WHERE tenant_id = $1 AND command_scope = 'foundation.proof.record') AS idempotency_count,
       (SELECT correlation_id FROM foundation_proof_record WHERE tenant_id = $1) AS record_correlation,
       (SELECT correlation_id FROM audit_event WHERE tenant_id = $1 AND action = 'foundation.proof_recorded') AS audit_correlation,
       (SELECT envelope->>'correlation_id' FROM outbox_event WHERE tenant_id = $1 AND event_type = 'com.subrevos.foundation.proof_recorded.v1') AS outbox_correlation`,
    [tenantA],
  );
  assert.deepEqual(evidence.rows[0], {
    proof_count: 1,
    audit_count: 1,
    outbox_count: 1,
    idempotency_count: 1,
    record_correlation: trustedA.correlationId,
    audit_correlation: trustedA.correlationId,
    outbox_correlation: trustedA.correlationId,
  });

  const client = await app.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
    const invisible = await client.query("SELECT proof_record_id FROM foundation_proof_record WHERE proof_record_id = $1", [first.proofRecordId]);
    assert.equal(invisible.rowCount, 0, "tenant B must not observe tenant A's proof record");
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }

  const resultB = await runWithTenantContext(tenantContext(tenantB, "proof_user_B"), () =>
    proofCommand({ label: "phase-0-release-gate" }, metadata),
  );
  assert.notEqual(resultB.proofRecordId, first.proofRecordId, "tenant B must execute independently, not replay tenant A's response");
  assert.equal(await count("foundation_proof_record", tenantA), 1);
  assert.equal(await count("foundation_proof_record", tenantB), 1);

  await runWithTenantContext(trustedA, async () => {
    await assert.rejects(
      proofCommand({ label: "changed" }, metadata),
      (error: unknown) => error instanceof PlatformProblem && error.problem.code === "idempotency_key_reused_with_different_payload",
    );
  });
  assert.equal(await count("foundation_proof_record", tenantA), 1);
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

function tenantContext(id: TenantId, actor = "member_1") {
  return resolveTenantContext({
    principal: testPrincipal([id], { actor }),
    selectedTenantId: id,
    tenantState: "ACTIVE",
    correlationId: `corr_idem_pg_${++sequence}`,
  });
}

async function activeTenant(id: string): Promise<TenantId> {
  const typed = tenantId(id);
  const service = commands();
  await service.provisionTenant(context(), { tenantId: id, displayName: id, initialAdministratorActorId: `admin_${id}` });
  await service.activateTenant(context(), { tenantId: id, expectedVersion: 1 });
  return typed;
}

const IDEMPOTENCY_KEY = "8f14e45f-ceea-467f-a0e6-1c2d3e4f5a6b";

function idempotentUpdate(id: TenantId, runs: { value: number }, delayMilliseconds = 0) {
  return async (unitOfWork: TenantUnitOfWork): Promise<StoredResponse> => {
    runs.value += 1;
    if (delayMilliseconds > 0) await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
    const current = await unitOfWork.tenants.findById(id);
    assert.ok(current);
    await unitOfWork.tenants.update(
      Object.freeze({ ...current, displayName: `updated-${runs.value}`, version: current.version + 1, updatedAt: new Date(NOW.valueOf() + 1_000).toISOString() }),
      current.version,
    );
    return { status: 200, body: { version: current.version + 1, display_name: `updated-${runs.value}` } };
  };
}

test("TC-001-02-01 PostgreSQL replays one stored response and commits the protected effect once", async () => {
  const id = await activeTenant("tenant_idem_replay");
  const execute = createIdempotentExecutor({ persistence, clock: () => NOW });
  const runs = { value: 0 };
  const request = { scope: "tenant.update_profile", key: IDEMPOTENCY_KEY, payload: { display_name: "updated" } } as const;
  const trusted = tenantContext(id);

  const first = await runWithTenantContext(trusted, () => execute(request, async () => {}, idempotentUpdate(id, runs)));
  const replay = await runWithTenantContext(trusted, () => execute(request, async () => {}, idempotentUpdate(id, runs)));

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.response, first.response);
  assert.equal(runs.value, 1);
  assert.equal(await countIdempotencyScope(id, "tenant.update_profile"), 1);
  const row = await admin.query("SELECT display_name, row_version FROM tenant WHERE tenant_id = $1", [id]);
  assert.deepEqual(row.rows[0], { display_name: "updated-1", row_version: "3" });

  await runWithTenantContext(trusted, async () => {
    await assert.rejects(
      execute({ ...request, payload: { display_name: "different" } }, async () => {}, idempotentUpdate(id, runs)),
      (error: unknown) => error instanceof PlatformProblem && error.problem.code === "idempotency_key_reused_with_different_payload",
    );
  });
  assert.equal(runs.value, 1);
});

test("TC-001-02-02 PostgreSQL unique-key serialization permits one effect under a concurrent retry race", async () => {
  const id = await activeTenant("tenant_idem_race");
  const execute = createIdempotentExecutor({ persistence, clock: () => NOW });
  const runs = { value: 0 };
  const request = { scope: "tenant.update_profile", key: IDEMPOTENCY_KEY, payload: { display_name: "race" } } as const;
  const trusted = tenantContext(id);

  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      runWithTenantContext(trusted, () => execute(request, async () => {}, idempotentUpdate(id, runs, 20))),
    ),
  );

  assert.equal(runs.value, 1);
  assert.equal(results.filter((result) => !result.replayed).length, 1);
  assert.equal(results.filter((result) => result.replayed).length, 11);
  for (const result of results) assert.deepEqual(result.response, results[0]!.response);
  assert.equal(await countIdempotencyScope(id, "tenant.update_profile"), 1);
  const row = await admin.query("SELECT row_version FROM tenant WHERE tenant_id = $1", [id]);
  assert.equal(row.rows[0].row_version, "3");
});

test("TC-001-02-03 PostgreSQL RLS isolates the same idempotency key between tenants", async () => {
  const [a, b] = await Promise.all([activeTenant("tenant_idem_A"), activeTenant("tenant_idem_B")]);
  const execute = createIdempotentExecutor({ persistence, clock: () => NOW });
  const runsA = { value: 0 };
  const runsB = { value: 0 };
  const request = { scope: "tenant.update_profile", key: IDEMPOTENCY_KEY, payload: { display_name: "same" } } as const;

  const [resultA, resultB] = await Promise.all([
    runWithTenantContext(tenantContext(a, "member_A"), () => execute(request, async () => {}, idempotentUpdate(a, runsA))),
    runWithTenantContext(tenantContext(b, "member_B"), () => execute(request, async () => {}, idempotentUpdate(b, runsB))),
  ]);

  assert.equal(resultA.replayed, false);
  assert.equal(resultB.replayed, false);
  assert.equal(runsA.value, 1);
  assert.equal(runsB.value, 1);
  assert.equal(await countIdempotencyScope(a, "tenant.update_profile"), 1);
  assert.equal(await countIdempotencyScope(b, "tenant.update_profile"), 1);
});

test("PostgreSQL rolls back the idempotency claim when the protected effect fails", async () => {
  const id = await activeTenant("tenant_idem_rollback");
  const execute = createIdempotentExecutor({ persistence, clock: () => NOW });
  const trusted = tenantContext(id);
  const request = { scope: "tenant.update_profile", key: IDEMPOTENCY_KEY, payload: { display_name: "rollback" } } as const;

  await runWithTenantContext(trusted, async () => {
    await assert.rejects(
      execute(request, async () => {}, async (unitOfWork) => {
        const current = await unitOfWork.tenants.findById(id);
        assert.ok(current);
        await unitOfWork.tenants.update({ ...current, displayName: "must-rollback", version: current.version + 1 }, current.version);
        throw new Error("injected protected-effect failure");
      }),
      /injected protected-effect failure/,
    );
  });

  assert.equal(await countIdempotencyScope(id, "tenant.update_profile"), 0);
  const row = await admin.query("SELECT display_name, row_version FROM tenant WHERE tenant_id = $1", [id]);
  assert.deepEqual(row.rows[0], { display_name: "tenant_idem_rollback", row_version: "2" });
});

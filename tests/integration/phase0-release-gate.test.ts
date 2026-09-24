import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import pg from "pg";
import { FOUNDATION_PROOF_AUDIT_FIELDS, createFoundationProofCommand } from "../../modules/foundation-proof/application/proof-command.ts";
import { PostgresFoundationProofPersistence } from "../../modules/foundation-proof/infrastructure/postgres/proof-persistence.ts";
import { createTenantAuthorizer } from "../../modules/identity-tenant/application/authorization.ts";
import { TENANT_AUDIT_FIELDS, createTenantCommands } from "../../modules/identity-tenant/application/tenant-commands.ts";
import { PostgresPermissionGrantStore } from "../../modules/identity-tenant/infrastructure/postgres/grant-store.ts";
import { PostgresTenantPersistence } from "../../modules/identity-tenant/infrastructure/postgres/tenant-persistence.ts";
import { AllowListAuthorizer } from "../../modules/identity-tenant/tests/in-memory-persistence.ts";
import { createAuditPolicy, createAuditRecorder } from "../../platform/audit/src/index.ts";
import type { EventEnvelope } from "../../platform/event-envelope/src/index.ts";
import { PostgresInboxPersistence, PostgresOutboxStore } from "../../platform/outbox/infrastructure/postgres/store.ts";
import { createIdempotentConsumer, createOutboxDispatcher, type EventPublisher, type InboxStore } from "../../platform/outbox/src/index.ts";
import { PlatformProblem } from "../../platform/problem-model/src/index.ts";
import {
  resolvePlatformCommandContext,
  resolveTenantContext,
  runWithTenantContext,
  tenantId,
  type TenantId,
} from "../../platform/tenant-context/src/index.ts";
import { testPrincipal } from "../support/authenticated-principal.ts";
import { testIdempotencyKey } from "../support/idempotency-key.ts";

/**
 * Phase 0 exit composition (P0-010) on real PostgreSQL: provisioned tenants, trusted context, RBAC
 * read live from the role tables, an idempotent proof command, the outbox dispatcher with a retry,
 * and an inbox consumer that deduplicates a redelivery. HTTP ingress is not part of this proof yet.
 */

const { Pool } = pg;
const adminUrl = process.env.SINTIUS_MIGRATION_DATABASE_URL ?? "postgresql://sintius_admin@127.0.0.1:54329/sintius";
const appUrl = process.env.SINTIUS_DATABASE_URL ?? "postgresql://sintius_app@127.0.0.1:54329/sintius";
const dispatcherUrl = process.env.SINTIUS_DISPATCHER_DATABASE_URL ?? "postgresql://sintius_dispatcher@127.0.0.1:54329/sintius";
const admin = new Pool({ connectionString: adminUrl, max: 2 });
const T0 = Date.parse("2026-09-24T12:00:00.000Z");

let now = T0;
let sequence = 0;
const clock = () => new Date(now);
const opened: { close(): Promise<void> }[] = [];
function open<T extends { close(): Promise<void> }>(resource: T): T {
  opened.push(resource);
  return resource;
}

const denied = (error: unknown) => error instanceof PlatformProblem && error.problem.code === "permission_denied";

async function count(sql: string, parameters: unknown[]): Promise<number> {
  return (await admin.query(sql, parameters)).rows[0].count;
}

function tenantContext(id: TenantId, actor: string, correlationId = `corr_gate_${++sequence}`) {
  return resolveTenantContext({
    principal: testPrincipal([id], { actor }),
    selectedTenantId: id,
    tenantState: "ACTIVE",
    correlationId,
  });
}

beforeEach(async () => {
  now = T0;
  await Promise.all(opened.splice(0).map((resource) => resource.close()));
  await admin.query(
    "TRUNCATE foundation_proof_record, idempotency_record, outbox_event, audit_event, tenant_role_assignment, tenant_role, tenant RESTART IDENTITY CASCADE",
  );
});

after(async () => {
  await Promise.all(opened.splice(0).map((resource) => resource.close()));
  await admin.end();
});

test("P0-010 PostgreSQL release gate: RBAC-guarded idempotent proof, retried dispatch and deduplicated consumption", async () => {
  // 1. Provision and activate two tenants through the real lifecycle commands.
  const tenantCommands = createTenantCommands({
    persistence: open(new PostgresTenantPersistence({ connectionString: appUrl })),
    authorizer: new AllowListAuthorizer(["tenant:provision", "tenant:manage_lifecycle"]),
    audit: createAuditRecorder({ policy: createAuditPolicy(TENANT_AUDIT_FIELDS), clock, newId: () => `aud_gate_${++sequence}` }),
    clock,
  });
  const operator = () => resolvePlatformCommandContext({ principal: testPrincipal([], { actor: "platform_operator" }), correlationId: `corr_gate_${++sequence}` });
  const key = () => ({ idempotencyKey: testIdempotencyKey(`phase0-gate-key-${String(++sequence).padStart(8, "0")}`) });
  for (const id of ["tenant_gate_A", "tenant_gate_B"]) {
    await tenantCommands.provisionTenant(operator(), { tenantId: id, displayName: id, initialAdministratorActorId: `admin_${id}` }, key());
    await tenantCommands.activateTenant(operator(), { tenantId: id, expectedVersion: 1 }, key());
  }
  const A = tenantId("tenant_gate_A");
  const B = tenantId("tenant_gate_B");

  // 2. Grant the proof permission to one member of tenant A through the tenant's own role tables.
  //    Role administration has no PostgreSQL adapter yet, so the grant is seeded directly.
  await admin.query(
    `INSERT INTO tenant_role (tenant_id, role_code, permissions, status) VALUES ($1, 'proof_operator', '["foundation:proof:execute"]', 'active')`,
    [A],
  );
  await admin.query(`INSERT INTO tenant_role_assignment (tenant_id, actor_id, role_code) VALUES ($1, 'proof_user', 'proof_operator')`, [A]);

  const authorizer = createTenantAuthorizer({ grants: open(new PostgresPermissionGrantStore({ connectionString: appUrl })) });
  const proofCommand = createFoundationProofCommand({
    persistence: open(new PostgresFoundationProofPersistence({ connectionString: appUrl, maxConnections: 6 })),
    authorizer,
    audit: createAuditRecorder({ policy: createAuditPolicy(FOUNDATION_PROOF_AUDIT_FIELDS), clock, newId: () => `aud_gate_${++sequence}` }),
    clock,
  });
  const proofRows = (tenant: string) =>
    count(
      `SELECT ((SELECT count(*) FROM foundation_proof_record WHERE tenant_id = $1)
            + (SELECT count(*) FROM idempotency_record WHERE tenant_id = $1 AND command_scope = 'foundation.proof.record')
            + (SELECT count(*) FROM outbox_event WHERE tenant_id = $1 AND event_type LIKE '%foundation.proof_recorded.v1'))::int AS count`,
      [tenant],
    );

  // 3. Deny by default: another member of A, the tenant administrator and the same actor in B hold no grant.
  for (const [tenant, actor] of [[A, "other_member"], [A, "admin_tenant_gate_A"], [B, "proof_user"]] as const) {
    await runWithTenantContext(tenantContext(tenant, actor), async () => {
      await assert.rejects(proofCommand({ label: "denied" }, { idempotencyKey: testIdempotencyKey("phase0-gate-denied-000001") }), denied);
    });
  }
  assert.equal(await proofRows(A) + (await proofRows(B)), 0, "denied commands wrote nothing, not even an idempotency claim");

  // 4. The authorized member's concurrent retries commit once.
  const trusted = tenantContext(A, "proof_user", "corr_gate_release_proof");
  const metadata = { idempotencyKey: testIdempotencyKey("phase0-gate-proof-key-000001") };
  const [first, retry] = await Promise.all([
    runWithTenantContext(trusted, () => proofCommand({ label: "phase-0-exit" }, metadata)),
    runWithTenantContext(trusted, () => proofCommand({ label: "phase-0-exit" }, metadata)),
  ]);
  assert.deepEqual(retry, first);
  assert.equal(await proofRows(A), 3, "one proof record, one idempotency result and one outbox event");

  // 5. Dispatch as the dispatcher role. The broker refuses the proof event once; it is retried after backoff.
  const delivered: EventEnvelope[] = [];
  let refusals = 0;
  const publisher: EventPublisher = {
    async publish(event) {
      if (event.type.endsWith("foundation.proof_recorded.v1") && refusals === 0) {
        refusals += 1;
        throw new Error("broker unavailable");
      }
      delivered.push(event as EventEnvelope);
    },
  };
  const dispatch = createOutboxDispatcher({ store: open(new PostgresOutboxStore({ connectionString: dispatcherUrl })), publisher, clock, workerId: "gate_worker" });
  let retried = 0;
  for (let pass = 0; pass < 10; pass += 1) {
    const report = await dispatch();
    retried += report.retried;
    if (report.leased === 0 && delivered.some((event) => event.type.endsWith("foundation.proof_recorded.v1"))) break;
    now += 6_000;
  }
  assert.equal(retried, 1, "the refused proof event was scheduled for retry, not dropped or dead-lettered");
  const proofEvent = delivered.find((event) => event.type.endsWith("foundation.proof_recorded.v1"));
  assert.ok(proofEvent, "the proof event was published after the retry");
  assert.deepEqual(
    [proofEvent.tenant_id, proofEvent.correlation_id, proofEvent.actor.id, proofEvent.data.proof_record_id],
    [A, "corr_gate_release_proof", "proof_user", first.proofRecordId],
    "tenant, correlation and actor flow from the trusted context to the published event",
  );
  const streamOf = (tenant: string) => delivered.filter((event) => event.tenant_id === tenant && event.aggregate_type === "Tenant").map((event) => event.aggregate_version);
  assert.deepEqual([streamOf(A), streamOf(B)], [[1, 2], [1, 2]], "each tenant stream is published in version order");
  const outboxState = await admin.query("SELECT status, count(*)::int AS count FROM outbox_event GROUP BY status");
  assert.deepEqual(outboxState.rows, [{ status: "published", count: 5 }]);
  assert.equal(
    await count("SELECT count(*)::int AS count FROM audit_event WHERE correlation_id = $1 AND action = 'foundation.proof_recorded'", ["corr_gate_release_proof"]),
    1,
  );

  // 6. The broker redelivers everything (at-least-once); the consumer applies each event once per tenant.
  const applied: string[] = [];
  const inbox = open(
    new PostgresInboxPersistence<{ readonly inbox: InboxStore }>({ connectionString: appUrl, unitOfWork: () => ({}) }),
  );
  const consume = createIdempotentConsumer({
    consumer: "phase0.release_gate",
    persistence: inbox,
    clock,
    handle: async (event) => void applied.push(event.id),
  });
  for (const event of [...delivered, ...delivered]) await consume(event);
  assert.deepEqual(applied, delivered.map((event) => event.id));
  assert.equal(await count("SELECT count(*)::int AS count FROM inbox_record WHERE consumer = 'phase0.release_gate'", []), delivered.length);

  // 7. Revocation applies on the next command; the stored response is not replayed to a revoked actor.
  await admin.query("UPDATE tenant_role_assignment SET status = 'revoked', revoked_at = now() WHERE tenant_id = $1 AND actor_id = 'proof_user'", [A]);
  await runWithTenantContext(tenantContext(A, "proof_user"), async () => {
    await assert.rejects(proofCommand({ label: "phase-0-exit" }, metadata), denied);
    await assert.rejects(proofCommand({ label: "after revocation" }, { idempotencyKey: testIdempotencyKey("phase0-gate-proof-key-000002") }), denied);
  });
  assert.equal(await proofRows(A), 3);
});

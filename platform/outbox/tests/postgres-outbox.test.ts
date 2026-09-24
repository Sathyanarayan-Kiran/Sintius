import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import pg from "pg";
import { createAuditPolicy, createAuditRecorder } from "../../audit/src/index.ts";
import { buildEventEnvelopeFor, type EventEnvelope } from "../../event-envelope/src/index.ts";
import { PlatformProblem } from "../../problem-model/src/index.ts";
import { resolvePlatformCommandContext, tenantId, type TenantId } from "../../tenant-context/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import {
  PostgresDeadLetterPersistence,
  PostgresInboxPersistence,
  PostgresOutboxStore,
  type PostgresConsumerTransaction,
} from "../infrastructure/postgres/store.ts";
import {
  OUTBOX_AUDIT_FIELDS,
  createDeadLetterOperations,
  createIdempotentConsumer,
  createOutboxDispatcher,
  type EventPublisher,
  type InboxStore,
} from "../src/index.ts";

const { Pool } = pg;
const adminUrl = process.env.SINTIUS_MIGRATION_DATABASE_URL ?? "postgresql://sintius_admin@127.0.0.1:54329/sintius";
const appUrl = process.env.SINTIUS_DATABASE_URL ?? "postgresql://sintius_app@127.0.0.1:54329/sintius";
const dispatcherUrl = process.env.SINTIUS_DISPATCHER_DATABASE_URL ?? "postgresql://sintius_dispatcher@127.0.0.1:54329/sintius";
const admin = new Pool({ connectionString: adminUrl, max: 3 });
const app = new Pool({ connectionString: appUrl, max: 3 });
const dispatcherRole = new Pool({ connectionString: dispatcherUrl, max: 2 });

const A = tenantId("tenant_outbox_A");
const B = tenantId("tenant_outbox_B");
const T0 = Date.parse("2026-09-24T10:00:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

let store: PostgresOutboxStore;
let ids = 0;

const code = (expected: string) => (error: unknown) => error instanceof PlatformProblem && error.problem.code === expected;
const privilegeDenied = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: string }).code === "42501";

function envelope(tenant: TenantId, aggregateId: string, version: number): EventEnvelope {
  const occurredAt = new Date(T0);
  return buildEventEnvelopeFor(
    { tenantId: tenant, actorId: "user_outbox", principalKind: "interactive", correlationId: `corr_${aggregateId}_${version}` },
    {
      eventType: "tenant.provisioned.v1",
      sourceContext: "identity-tenant",
      aggregateType: "Tenant",
      aggregateId,
      aggregateVersion: version,
      occurredAt,
      classification: "CONFIDENTIAL_BUSINESS",
      data: { version },
    },
    { clock: () => occurredAt, newEventId: () => `evt_pg_outbox_${++ids}` },
  ) as EventEnvelope;
}

/** Appends through the application role inside a tenant-bound transaction, as producers do. */
async function append(...events: EventEnvelope[]): Promise<void> {
  const client = await app.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [events[0]!.tenant_id]);
    for (const event of events) {
      await client.query(
        `INSERT INTO outbox_event (tenant_id, event_id, event_type, aggregate_type, aggregate_id, aggregate_version,
                                   envelope, next_attempt_at, appended_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
        [event.tenant_id, event.id, event.type, event.aggregate_type, event.aggregate_id, event.aggregate_version,
          JSON.stringify(event), event.recorded_at, event.recorded_at],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function statusOf(eventId: string) {
  const result = await admin.query("SELECT entry_id, status, attempts, last_error, resolution FROM outbox_event WHERE event_id = $1", [eventId]);
  return result.rows[0];
}

class RecordingPublisher implements EventPublisher {
  published: EventEnvelope[] = [];
  failing = new Set<string>();
  async publish(event: Readonly<EventEnvelope>) {
    if (this.failing.has(event.id)) throw new Error("broker refused: password=hunter2");
    this.published.push(event as EventEnvelope);
  }
}

beforeEach(async () => {
  await store?.close();
  store = new PostgresOutboxStore({ connectionString: dispatcherUrl, maxConnections: 12 });
  await admin.query("TRUNCATE outbox_event, audit_event, tenant RESTART IDENTITY CASCADE");
  await admin.query(
    `INSERT INTO tenant (tenant_id, display_name, state, row_version, created_at, updated_at)
     VALUES ($1, 'Outbox A', 'ACTIVE', 1, $3, $3), ($2, 'Outbox B', 'ACTIVE', 1, $3, $3)`,
    [A, B, at(0)],
  );
});

after(async () => {
  await store?.close();
  await Promise.all([admin.end(), app.end(), dispatcherRole.end()]);
});

test("TC-001-03-03 PostgreSQL leasing grants only stream heads in order, and backoff blocks only its own stream", async () => {
  const a1 = [envelope(A, "agg_1", 1), envelope(A, "agg_1", 2), envelope(A, "agg_1", 3)];
  const a2 = envelope(A, "agg_2", 1);
  const b1 = envelope(B, "agg_1", 1);
  await append(...a1, a2);
  await append(b1);

  const first = await store.leaseBatch({ workerId: "w1", now: at(0), leaseSeconds: 60, limit: 10 });
  assert.deepEqual(first.map((entry) => entry.envelope.id), [a1[0]!.id, a2.id, b1.id], "one head per stream; same aggregate id in another tenant is another stream");
  assert.ok(first.every((entry) => entry.status === "leased" && entry.attempts === 1 && entry.leasedBy === "w1"));
  assert.deepEqual(await store.leaseBatch({ workerId: "w2", now: at(0), leaseSeconds: 60, limit: 10 }), [], "leased heads block their streams");

  assert.equal(await store.markPublished({ entryId: first[0]!.entryId, workerId: "w1", now: at(1) }), true);
  assert.equal(await store.recordFailure({ entryId: first[1]!.entryId, workerId: "w1", now: at(1), error: "boom", retryAt: at(6) }), true);
  assert.equal(await store.markPublished({ entryId: first[2]!.entryId, workerId: "w1", now: at(1) }), true);

  const second = await store.leaseBatch({ workerId: "w2", now: at(2), leaseSeconds: 60, limit: 10 });
  assert.deepEqual(second.map((entry) => entry.envelope.id), [a1[1]!.id], "the next event of a published stream flows; the backing-off stream waits");
  const third = await store.leaseBatch({ workerId: "w2", now: at(6), leaseSeconds: 60, limit: 10 });
  assert.deepEqual(third.map((entry) => [entry.envelope.id, entry.attempts]), [[a2.id, 2]]);
  assert.equal((await statusOf(a2.id)).last_error, "boom");
});

test("TC-001-03-03 concurrent PostgreSQL dispatchers publish each event once, in per-stream order, never two per stream at once", async () => {
  const streams = 24;
  const perStream = 4;
  for (let stream = 0; stream < streams; stream += 1) {
    const tenant = stream % 2 === 0 ? A : B;
    await append(...Array.from({ length: perStream }, (_, index) => envelope(tenant, `agg_${stream}`, index + 1)));
  }

  const inFlight = new Map<string, number>();
  const published: EventEnvelope[] = [];
  let overlap = 0;
  const publisher: EventPublisher = {
    async publish(event) {
      const stream = `${event.tenant_id}|${event.aggregate_id}`;
      const running = (inFlight.get(stream) ?? 0) + 1;
      inFlight.set(stream, running);
      if (running > 1) overlap += 1;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 3));
      published.push(event as EventEnvelope);
      inFlight.set(stream, running - 1);
    },
  };
  const workers = Array.from({ length: 6 }, (_, index) =>
    createOutboxDispatcher({ store, publisher, clock: () => new Date(T0), workerId: `worker_${index}`, batchSize: 5 }),
  );

  for (let round = 0; round < 50; round += 1) {
    await Promise.all(workers.map((runOnce) => runOnce()));
    if ((await store.stats(at(0))).pending === 0) break;
  }

  assert.equal(overlap, 0, "a stream never has two events in flight");
  assert.equal(published.length, streams * perStream, "no event is lost or published twice");
  assert.equal(new Set(published.map((event) => event.id)).size, streams * perStream);
  for (let stream = 0; stream < streams; stream += 1) {
    const versions = published.filter((event) => event.aggregate_id === `agg_${stream}`).map((event) => event.aggregate_version);
    assert.deepEqual(versions, [1, 2, 3, 4], `agg_${stream} is published in order`);
  }
  const stats = await store.stats(at(0));
  assert.deepEqual([stats.pending, stats.leased, stats.deadLetter, stats.oldestUnpublishedAgeSeconds], [0, 0, 0, undefined]);
});

test("TC-001-03-02 an expired PostgreSQL lease is re-granted and the stale worker cannot record an outcome", async () => {
  const event = envelope(A, "agg_crash", 1);
  await append(event);
  const [lease] = await store.leaseBatch({ workerId: "worker_dead", now: at(0), leaseSeconds: 30, limit: 1 });
  assert.ok(lease);
  assert.deepEqual(await store.leaseBatch({ workerId: "worker_live", now: at(29), leaseSeconds: 30, limit: 1 }), [], "a live lease is respected");

  const [regranted] = await store.leaseBatch({ workerId: "worker_live", now: at(30), leaseSeconds: 30, limit: 1 });
  assert.equal(regranted?.entryId, lease.entryId);
  assert.equal(regranted?.attempts, 2);
  assert.equal(await store.markPublished({ entryId: lease.entryId, workerId: "worker_dead", now: at(31) }), false);
  assert.equal(await store.recordFailure({ entryId: lease.entryId, workerId: "worker_dead", now: at(31), error: "late" }), false);
  assert.equal(await store.markPublished({ entryId: lease.entryId, workerId: "worker_live", now: at(31) }), true);
  assert.equal((await statusOf(event.id)).status, "published");
  assert.equal(await store.markPublished({ entryId: "not-a-number", workerId: "worker_live", now: at(31) }), false);
});

test("TC-001-03-04 a PostgreSQL dead letter blocks only its stream until an audited operator skip or requeue", async () => {
  const poison = envelope(A, "agg_poison", 1);
  const behind = envelope(A, "agg_poison", 2);
  const retryable = envelope(A, "agg_retry", 1);
  const healthy = envelope(B, "agg_ok", 1);
  await append(poison, behind, retryable);
  await append(healthy);

  const publisher = new RecordingPublisher();
  publisher.failing.add(poison.id).add(retryable.id);
  const dispatcher = createOutboxDispatcher({ store, publisher, clock: () => new Date(T0), workerId: "worker_dl", maxAttempts: 1 });
  const report = await dispatcher();
  assert.deepEqual([report.published, report.deadLettered], [1, 2]);
  assert.deepEqual(publisher.published.map((event) => event.id), [healthy.id]);
  const dead = await statusOf(poison.id);
  assert.equal(dead.status, "dead");
  assert.doesNotMatch(dead.last_error, /hunter2/, "only the redacted error is stored");
  const stats = await store.stats(at(10));
  assert.deepEqual([stats.deadLetter, stats.blockedStreams, stats.pending, stats.oldestDeadLetterAgeSeconds], [2, 2, 1, 10]);
  assert.deepEqual(await store.leaseBatch({ workerId: "worker_dl", now: at(60), leaseSeconds: 60, limit: 10 }), [], "later events wait behind the dead letter");

  const persistence = new PostgresDeadLetterPersistence({ connectionString: dispatcherUrl });
  try {
    let audits = 0;
    const authorized: string[] = [];
    const operations = createDeadLetterOperations({
      persistence,
      audit: createAuditRecorder({ policy: createAuditPolicy(OUTBOX_AUDIT_FIELDS), clock: () => new Date(T0), newId: () => `aud_dl_${++audits}` }),
      clock: () => new Date(T0 + 120_000),
      authorize: async (action) => void authorized.push(action),
    });
    const context = resolvePlatformCommandContext({ principal: testPrincipal([], { actor: "operator_pg" }), correlationId: "corr_dead_letter_pg" });

    await assert.rejects(operations(context, { entryId: String(dead.entry_id + 100), action: "skip", reason: "no such entry" }), code("dead_letter_not_resolvable"));
    await assert.rejects(operations(context, { entryId: "abc", action: "skip", reason: "malformed" }), code("dead_letter_not_resolvable"));

    await operations(context, { entryId: String(dead.entry_id), action: "skip", reason: "Downstream already corrected manually." });
    const skipped = await statusOf(poison.id);
    assert.equal(skipped.status, "skipped");
    assert.deepEqual(skipped.resolution, { action: "skip", operatorId: "operator_pg", reason: "Downstream already corrected manually.", resolvedAt: at(120) });
    await assert.rejects(operations(context, { entryId: String(dead.entry_id), action: "requeue", reason: "again" }), code("dead_letter_not_resolvable"));

    const retry = await statusOf(retryable.id);
    await operations(context, { entryId: String(retry.entry_id), action: "requeue", reason: "Broker fixed." });

    const leased = await store.leaseBatch({ workerId: "worker_dl", now: at(120), leaseSeconds: 60, limit: 10 });
    assert.deepEqual(leased.map((entry) => [entry.envelope.id, entry.attempts]), [[behind.id, 1], [retryable.id, 1]], "skip unblocks the stream; requeue restores the attempt budget");

    const auditRows = await admin.query(
      "SELECT tenant_id, action, target, reason, correlation_id, actor FROM audit_event ORDER BY audit_event_id",
    );
    assert.deepEqual(
      auditRows.rows.map((row) => [row.tenant_id, row.action, row.target.id, row.reason, row.correlation_id, row.actor.id]),
      [
        [A, "outbox.dead_letter_skipped", String(dead.entry_id), "Downstream already corrected manually.", "corr_dead_letter_pg", "operator_pg"],
        [A, "outbox.dead_letter_requeued", String(retry.entry_id), "Broker fixed.", "corr_dead_letter_pg", "operator_pg"],
      ],
      "each resolution is audited against the entry's tenant; rejected attempts left no audit row",
    );
    assert.deepEqual(authorized, ["skip", "skip", "skip", "requeue", "requeue"]);
  } finally {
    await persistence.close();
  }
});

test("a failed dead-letter audit rolls the PostgreSQL resolution back", async () => {
  const poison = envelope(A, "agg_rollback", 1);
  await append(poison);
  const publisher = new RecordingPublisher();
  publisher.failing.add(poison.id);
  await createOutboxDispatcher({ store, publisher, clock: () => new Date(T0), workerId: "w", maxAttempts: 1 })();
  const dead = await statusOf(poison.id);

  const persistence = new PostgresDeadLetterPersistence({ connectionString: dispatcherUrl });
  try {
    const recorder = createAuditRecorder({ policy: createAuditPolicy(OUTBOX_AUDIT_FIELDS), clock: () => new Date(T0) });
    // Misattribute the audit row to the other tenant: the adapter must refuse it and roll back.
    const misattributing = Object.freeze({
      ...recorder,
      recordForPlatformCommand: ((writer, context, _tenant, input) =>
        recorder.recordForPlatformCommand(writer, context, B, input)) as typeof recorder.recordForPlatformCommand,
    });
    const operations = createDeadLetterOperations({ persistence, audit: misattributing, clock: () => new Date(T0), authorize: async () => {} });
    const context = resolvePlatformCommandContext({ principal: testPrincipal([], { actor: "operator_pg" }), correlationId: "corr_dl_rollback" });
    await assert.rejects(operations(context, { entryId: String(dead.entry_id), action: "skip", reason: "misattributed" }), code("tenant_context_mismatch"));
    assert.equal((await statusOf(poison.id)).status, "dead", "the resolution rolled back with the failed audit write");
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM audit_event")).rows[0].n, 0);
  } finally {
    await persistence.close();
  }
});

test("TC-017-01-02 database privileges keep audit and outbox rows append-only for the application and narrow for the dispatcher", async () => {
  const event = envelope(A, "agg_priv", 1);
  await append(event);
  await admin.query(
    `INSERT INTO audit_event (tenant_id, audit_event_id, occurred_at, recorded_at, actor, action, target, correlation_id, evidence_hash)
     VALUES ($1, 'aud_priv', $2, $2, '{"type":"user","id":"u"}', 'tenant.activated', '{"type":"Tenant","id":"t"}', 'corr_priv', repeat('0', 64))`,
    [A, at(0)],
  );

  async function attempt(pool: InstanceType<typeof Pool>, sql: string, parameters: unknown[] = []) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [A]);
      await client.query(sql, parameters);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const appDenied = [
    "UPDATE audit_event SET reason = 'rewritten'",
    "DELETE FROM audit_event",
    "TRUNCATE audit_event",
    "UPDATE outbox_event SET status = 'published', published_at = now()",
    "DELETE FROM outbox_event",
  ];
  for (const sql of appDenied) await assert.rejects(attempt(app, sql), privilegeDenied, `application role: ${sql}`);

  const dispatcherDenied = [
    "UPDATE outbox_event SET envelope = '{}'::jsonb",
    "UPDATE outbox_event SET tenant_id = 'tenant_outbox_B'",
    "DELETE FROM outbox_event",
    "UPDATE audit_event SET reason = 'rewritten'",
    "DELETE FROM audit_event",
    "SELECT * FROM tenant",
    "SELECT * FROM audit_event",
    "SELECT * FROM inbox_record",
  ];
  for (const sql of dispatcherDenied) await assert.rejects(attempt(dispatcherRole, sql), privilegeDenied, `dispatcher role: ${sql}`);
  await assert.rejects(
    attempt(dispatcherRole, `INSERT INTO outbox_event (tenant_id, event_id, event_type, aggregate_type, aggregate_id, aggregate_version, envelope, next_attempt_at, appended_at)
                             VALUES ($1, 'evt_forged', 't', 'a', 'b', 1, '{}'::jsonb, now(), now())`, [A]),
    privilegeDenied,
    "the dispatcher cannot append events",
  );
  await assert.rejects(
    attempt(dispatcherRole, `INSERT INTO audit_event (tenant_id, audit_event_id, occurred_at, recorded_at, actor, action, target, correlation_id, evidence_hash)
                             VALUES ($1, 'aud_forged', now(), now(), '{}'::jsonb, 'x.y', '{}'::jsonb, 'c', repeat('0', 64))`, [B]),
    privilegeDenied,
    "the dispatcher can only audit the tenant its transaction is bound to",
  );

  const rows = await admin.query("SELECT (SELECT reason FROM audit_event) AS reason, (SELECT status FROM outbox_event) AS status");
  assert.deepEqual(rows.rows[0], { reason: null, status: "pending" });
});

interface ConsumerUnitOfWork {
  readonly inbox: InboxStore;
  readonly transaction: PostgresConsumerTransaction;
}

test("PostgreSQL inbox deduplicates per consumer and tenant, rolls back with a failing handler and serializes concurrent duplicates", async () => {
  const inbox = new PostgresInboxPersistence<ConsumerUnitOfWork>({
    connectionString: appUrl,
    maxConnections: 10,
    unitOfWork: (transaction) => ({ transaction }),
  });
  try {
    const event = envelope(A, "agg_inbox", 1);
    let effects = 0;
    let failNext = false;
    const consumer = (name: string, delay = 0) =>
      createIdempotentConsumer<ConsumerUnitOfWork>({
        consumer: name,
        persistence: inbox,
        clock: () => new Date(T0),
        handle: async (received, unitOfWork) => {
          // The consumer's own write, on the same transaction as its inbox record.
          await unitOfWork.transaction.query(
            "INSERT INTO inbox_record (tenant_id, consumer, event_id, recorded_at) VALUES ($1, 'test.side_effect', $2, $3)",
            [unitOfWork.transaction.tenantId, `${name}:${received.id}`, at(0)],
          );
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
          if (failNext) {
            failNext = false;
            throw new Error("handler failed");
          }
          effects += 1;
        },
      });
    const rows = async (tenant: string) =>
      (await admin.query("SELECT consumer, event_id FROM inbox_record WHERE tenant_id = $1 ORDER BY consumer, event_id", [tenant])).rows
        .map((row) => `${row.consumer}/${row.event_id}`);

    failNext = true;
    await assert.rejects(consumer("billing.projector")(event), /handler failed/);
    assert.deepEqual(await rows(A), [], "the inbox record and the handler's write rolled back together");

    const results = await Promise.all(Array.from({ length: 8 }, () => consumer("billing.projector", 20)(event)));
    assert.equal(results.filter((result) => result.processed).length, 1, "concurrent redeliveries process once");
    assert.equal(effects, 1);
    assert.equal((await consumer("billing.projector")(event)).processed, false);
    assert.equal((await consumer("notifications")(event)).processed, true, "another consumer still receives it");

    const sameIdOtherTenant = { ...event, tenant_id: B } as EventEnvelope;
    assert.equal((await consumer("billing.projector")(sameIdOtherTenant)).processed, true, "deduplication never crosses tenants");
    assert.deepEqual(await rows(A), [`billing.projector/${event.id}`, `notifications/${event.id}`, `test.side_effect/billing.projector:${event.id}`, `test.side_effect/notifications:${event.id}`]);
    assert.deepEqual(await rows(B), [`billing.projector/${event.id}`, `test.side_effect/billing.projector:${event.id}`]);

    const client = await app.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [B]);
      const visible = await client.query("SELECT DISTINCT tenant_id FROM inbox_record");
      assert.deepEqual(visible.rows, [{ tenant_id: B }], "RLS hides tenant A's inbox from tenant B");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  } finally {
    await inbox.close();
  }
});

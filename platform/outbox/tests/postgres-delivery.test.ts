import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import pg from "pg";
import { createAuditPolicy, createAuditRecorder } from "../../audit/src/index.ts";
import { buildEventEnvelopeFor, type EventEnvelope } from "../../event-envelope/src/index.ts";
import { PlatformProblem } from "../../problem-model/src/index.ts";
import { resolvePlatformCommandContext, tenantId, type TenantId } from "../../tenant-context/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import { PostgresDeadLetterPersistence, PostgresInboxPersistence, PostgresOutboxStore, type QueueSelector } from "../infrastructure/postgres/store.ts";
import { PostgresDeliveryListener, PostgresEventPublisher } from "../infrastructure/postgres/transport.ts";
import {
  OUTBOX_AUDIT_FIELDS,
  createDeadLetterOperations,
  createDeliveryWorker,
  createIdempotentConsumer,
  createOutboxDispatcher,
  type InboxStore,
  type OutboxStore,
} from "../src/index.ts";

/** Decision D14: the PostgreSQL-backed consumer queue, end to end on PostgreSQL. */

const { Pool } = pg;
const adminUrl = process.env.SINTIUS_MIGRATION_DATABASE_URL ?? "postgresql://sintius_admin@127.0.0.1:54329/sintius";
const appUrl = process.env.SINTIUS_DATABASE_URL ?? "postgresql://sintius_app@127.0.0.1:54329/sintius";
const dispatcherUrl = process.env.SINTIUS_DISPATCHER_DATABASE_URL ?? "postgresql://sintius_dispatcher@127.0.0.1:54329/sintius";
const admin = new Pool({ connectionString: adminUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });
const relay = new Pool({ connectionString: dispatcherUrl, max: 2 });

const A = tenantId("tenant_delivery_A");
const B = tenantId("tenant_delivery_B");
const T0 = Date.parse("2026-09-25T10:00:00.000Z");
const PROVISIONED = "com.subrevos.tenant.provisioned.v1";
const ACTIVATED = "com.subrevos.tenant.activated.v1";
const ROUTES = [
  { consumer: "billing.projector", eventTypes: [PROVISIONED, ACTIVATED] },
  { consumer: "notifications", eventTypes: [PROVISIONED] },
] as const;

let now = T0;
let ids = 0;
const clock = () => new Date(now);
const opened: { close(): Promise<void> }[] = [];
function open<T extends { close(): Promise<void> }>(resource: T): T {
  opened.push(resource);
  return resource;
}

function envelope(tenant: TenantId, aggregateId: string, version: number, type = "tenant.provisioned.v1"): EventEnvelope {
  const occurredAt = new Date(T0);
  return buildEventEnvelopeFor(
    { tenantId: tenant, actorId: "user_delivery", principalKind: "interactive", correlationId: `corr_${aggregateId}_${version}` },
    { eventType: type, sourceContext: "identity-tenant", aggregateType: "Tenant", aggregateId, aggregateVersion: version, occurredAt, classification: "CONFIDENTIAL_BUSINESS", data: { version } },
    { clock: () => occurredAt, newEventId: () => `evt_delivery_${++ids}` },
  ) as EventEnvelope;
}

/** Producers append through the application role inside a tenant-bound transaction. */
async function append(...events: EventEnvelope[]): Promise<void> {
  const client = await app.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [events[0]!.tenant_id]);
    for (const event of events) {
      await client.query(
        `INSERT INTO outbox_event (tenant_id, event_id, event_type, aggregate_type, aggregate_id, aggregate_version, envelope, next_attempt_at, appended_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
        [event.tenant_id, event.id, event.type, event.aggregate_type, event.aggregate_id, event.aggregate_version, JSON.stringify(event), event.recorded_at, event.recorded_at],
      );
    }
    await client.query("COMMIT");
  } finally {
    client.release();
  }
}

const deliveryQueue = (consumer: string): QueueSelector => ({ kind: "delivery", consumer });

async function deliveries(consumer?: string) {
  const result = await admin.query(
    `SELECT consumer, tenant_id, event_id, status FROM event_delivery ${consumer === undefined ? "" : "WHERE consumer = $1"} ORDER BY entry_id`,
    consumer === undefined ? [] : [consumer],
  );
  return result.rows;
}

interface ConsumerUnitOfWork {
  readonly inbox: InboxStore;
}

/** A consumer whose effects are recorded in memory; the inbox deduplicates through PostgreSQL. */
function consumerFor(name: string, effects: string[], fail: (event: Readonly<EventEnvelope>) => boolean = () => false) {
  const inbox = open(new PostgresInboxPersistence<ConsumerUnitOfWork>({ connectionString: appUrl, unitOfWork: () => ({}) }));
  return createIdempotentConsumer<ConsumerUnitOfWork>({
    consumer: name,
    persistence: inbox,
    clock,
    handle: async (event) => {
      if (fail(event)) throw new Error(`${name} cannot process ${event.aggregate_id} v${event.aggregate_version}: api_key=secret-123`);
      effects.push(`${event.tenant_id}/${event.aggregate_id}/v${event.aggregate_version}`);
    },
  });
}

beforeEach(async () => {
  now = T0;
  await Promise.all(opened.splice(0).map((resource) => resource.close()));
  await admin.query("TRUNCATE outbox_event, audit_event, tenant RESTART IDENTITY CASCADE");
  await admin.query(
    `INSERT INTO tenant (tenant_id, display_name, state, row_version, created_at, updated_at)
     VALUES ($1, 'Delivery A', 'ACTIVE', 1, $3, $3), ($2, 'Delivery B', 'ACTIVE', 1, $3, $3)`,
    [A, B, new Date(T0).toISOString()],
  );
});

after(async () => {
  await Promise.all(opened.splice(0).map((resource) => resource.close()));
  await Promise.all([admin.end(), app.end(), relay.end()]);
});

test("D14 publishing fans out once per subscribed consumer, ignores republishes and wakes listeners", async () => {
  const publisher = open(new PostgresEventPublisher({ routes: ROUTES, clock, connectionString: dispatcherUrl }));
  const listener = open(new PostgresDeliveryListener({ connectionString: dispatcherUrl }));
  await listener.start();

  const provisioned = envelope(A, "agg_1", 1);
  const woken = listener.waitFor("notifications", 5000);
  await publisher.publish(provisioned);
  assert.equal(await woken, true, "a committed delivery wakes the consumer's worker");
  await publisher.publish(provisioned);
  await publisher.publish(envelope(A, "agg_1", 2, "tenant.activated.v1"));
  await publisher.publish(envelope(A, "agg_1", 3, "tenant.closed.v1"));

  assert.deepEqual(
    (await deliveries()).map((row) => [row.consumer, row.event_id]),
    [["billing.projector", provisioned.id], ["notifications", provisioned.id], ["billing.projector", "evt_delivery_2"]],
    "provisioned goes to both consumers once, activated only to billing, closed to nobody",
  );
  assert.equal(await listener.waitFor("audit.exporter", 50), false, "an unrelated consumer is not woken");

  assert.throws(() => new PostgresEventPublisher({ routes: [{ consumer: "Bad Name", eventTypes: [PROVISIONED] }] }), TypeError);
  assert.throws(() => new PostgresEventPublisher({ routes: [{ consumer: "a", eventTypes: ["com.subrevos.*"] }] }), TypeError, "no wildcards");
  assert.throws(() => new PostgresEventPublisher({ routes: [{ consumer: "a", eventTypes: [PROVISIONED] }, { consumer: "a", eventTypes: [ACTIVATED] }] }), TypeError);
});

test("D14 end to end: outbox to transport to two consumers, each applying every event once in per-aggregate order", async () => {
  await append(envelope(A, "agg_1", 1), envelope(A, "agg_1", 2, "tenant.activated.v1"), envelope(A, "agg_2", 1));
  await append(envelope(B, "agg_1", 1), envelope(B, "agg_1", 2, "tenant.activated.v1"));

  const dispatch = createOutboxDispatcher({
    store: open(new PostgresOutboxStore({ connectionString: dispatcherUrl })),
    publisher: open(new PostgresEventPublisher({ routes: ROUTES, clock, connectionString: dispatcherUrl })),
    clock,
    workerId: "relay_1",
  });
  const effects: Record<string, string[]> = { "billing.projector": [], notifications: [] };
  const workers = Object.keys(effects).flatMap((name) =>
    [1, 2].map((replica) =>
      createDeliveryWorker({
        store: open(new PostgresOutboxStore({ connectionString: dispatcherUrl, queue: deliveryQueue(name) })),
        consume: consumerFor(name, effects[name]!),
        clock,
        workerId: `${name}_${replica}`,
        batchSize: 2,
      }),
    ),
  );

  for (let round = 0; round < 20; round += 1) {
    await dispatch();
    const reports = await Promise.all(workers.map((work) => work()));
    if (reports.every((report) => report.leased === 0) && (await deliveries()).every((row) => row.status === "delivered")) break;
  }

  assert.deepEqual([...effects["billing.projector"]!].sort(), ["tenant_delivery_A/agg_1/v1", "tenant_delivery_A/agg_1/v2", "tenant_delivery_A/agg_2/v1", "tenant_delivery_B/agg_1/v1", "tenant_delivery_B/agg_1/v2"]);
  assert.deepEqual([...effects.notifications!].sort(), ["tenant_delivery_A/agg_1/v1", "tenant_delivery_A/agg_2/v1", "tenant_delivery_B/agg_1/v1"], "notifications only subscribes to provisioned");
  for (const stream of ["tenant_delivery_A/agg_1", "tenant_delivery_B/agg_1"]) {
    const versions = effects["billing.projector"]!.filter((effect) => effect.startsWith(`${stream}/`));
    assert.deepEqual(versions, [`${stream}/v1`, `${stream}/v2`], `${stream} is applied in order even with two billing replicas`);
  }
  const inbox = await admin.query("SELECT consumer, count(*)::int AS n FROM inbox_record GROUP BY consumer ORDER BY consumer");
  assert.deepEqual(inbox.rows, [{ consumer: "billing.projector", n: 5 }, { consumer: "notifications", n: 3 }]);
});

test("TC-001-03-02 crash after hand-over: the delivery is redelivered after its lease expires and the inbox applies it once", async () => {
  const event = envelope(A, "agg_crash", 1);
  const publisher = open(new PostgresEventPublisher({ routes: ROUTES, clock, connectionString: dispatcherUrl }));
  await publisher.publish(event);

  const effects: string[] = [];
  const consume = consumerFor("notifications", effects);
  const store = open(new PostgresOutboxStore({ connectionString: dispatcherUrl, queue: deliveryQueue("notifications") }));
  const crashing: OutboxStore = {
    leaseBatch: (request) => store.leaseBatch(request),
    markPublished: async () => {
      throw new Error("worker process died after the handler committed");
    },
    recordFailure: (input) => store.recordFailure(input),
    resolveDeadLetter: (input) => store.resolveDeadLetter(input),
    stats: (at) => store.stats(at),
  };
  await assert.rejects(createDeliveryWorker({ store: crashing, consume, clock, workerId: "doomed", leaseSeconds: 30 })(), /worker process died/);
  assert.deepEqual(effects, ["tenant_delivery_A/agg_crash/v1"], "the handler committed before the crash");
  assert.equal((await deliveries("notifications"))[0].status, "leased", "the crash left the delivery leased");

  now += 31_000;
  const report = await createDeliveryWorker({ store, consume, clock, workerId: "survivor", leaseSeconds: 30 })();
  assert.deepEqual([report.leased, report.published], [1, 1], "redelivered to another worker and completed");
  assert.equal(effects.length, 1, "the inbox made the redelivery a no-op");
  assert.equal((await deliveries("notifications"))[0].status, "delivered");
});

test("D1 a consumer's dead letter blocks only its own stream; other consumers keep receiving and an operator resolves it", async () => {
  const poison1 = envelope(A, "agg_poison", 1);
  const poison2 = envelope(A, "agg_poison", 2);
  const healthy = envelope(A, "agg_ok", 1);
  const publisher = open(new PostgresEventPublisher({ routes: ROUTES, clock, connectionString: dispatcherUrl }));
  for (const event of [poison1, poison2, healthy]) await publisher.publish(event);

  const billingEffects: string[] = [];
  const notificationEffects: string[] = [];
  const billingStore = open(new PostgresOutboxStore({ connectionString: dispatcherUrl, queue: deliveryQueue("billing.projector") }));
  const billing = createDeliveryWorker({
    store: billingStore,
    consume: consumerFor("billing.projector", billingEffects, (event) => event.id === poison1.id),
    clock,
    workerId: "billing_1",
    maxAttempts: 1,
  });
  const notifications = createDeliveryWorker({
    store: open(new PostgresOutboxStore({ connectionString: dispatcherUrl, queue: deliveryQueue("notifications") })),
    consume: consumerFor("notifications", notificationEffects),
    clock,
    workerId: "notifications_1",
  });

  for (let round = 0; round < 4; round += 1) await Promise.all([billing(), notifications()]);
  assert.deepEqual(notificationEffects, ["tenant_delivery_A/agg_poison/v1", "tenant_delivery_A/agg_ok/v1", "tenant_delivery_A/agg_poison/v2"], "billing's failure never blocks notifications");
  assert.deepEqual(billingEffects, ["tenant_delivery_A/agg_ok/v1"], "billing's other aggregates flow; agg_poison v2 waits behind the dead letter");
  const dead = await admin.query("SELECT entry_id, status, last_error FROM event_delivery WHERE consumer = 'billing.projector' AND event_id = $1", [poison1.id]);
  assert.equal(dead.rows[0].status, "dead");
  assert.doesNotMatch(dead.rows[0].last_error, /secret-123/, "only the redacted error is stored");
  const stats = await billingStore.stats(new Date(now).toISOString());
  assert.deepEqual([stats.deadLetter, stats.blockedStreams, stats.pending], [1, 1, 1]);

  const operations = (consumer: string) =>
    createDeadLetterOperations({
      persistence: open(new PostgresDeadLetterPersistence({ connectionString: dispatcherUrl, queue: deliveryQueue(consumer) })),
      audit: createAuditRecorder({ policy: createAuditPolicy(OUTBOX_AUDIT_FIELDS), clock, newId: () => `aud_delivery_${++ids}` }),
      clock,
      authorize: async () => {},
    });
  const context = resolvePlatformCommandContext({ principal: testPrincipal([], { actor: "operator_delivery" }), correlationId: "corr_delivery_dl" });
  const entryId = String(dead.rows[0].entry_id);
  await assert.rejects(
    operations("notifications")(context, { entryId, action: "skip", reason: "wrong queue" }),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "dead_letter_not_resolvable",
    "one consumer's operator path cannot touch another consumer's delivery",
  );
  await operations("billing.projector")(context, { entryId, action: "skip", reason: "Projection rebuilt from source." });

  await billing();
  assert.deepEqual(billingEffects, ["tenant_delivery_A/agg_ok/v1", "tenant_delivery_A/agg_poison/v2"], "the skip unblocks billing's stream");
  const audit = await admin.query("SELECT tenant_id, action, reason FROM audit_event");
  assert.deepEqual(audit.rows, [{ tenant_id: A, action: "outbox.dead_letter_skipped", reason: "Projection rebuilt from source." }]);
});

test("D14 only the relay role can touch deliveries", async () => {
  await open(new PostgresEventPublisher({ routes: ROUTES, clock, connectionString: dispatcherUrl })).publish(envelope(A, "agg_priv", 1));
  const denied = (error: unknown) => (error as { code?: string }).code === "42501";
  async function attempt(pool: InstanceType<typeof Pool>, sql: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [A]);
      await client.query(sql);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  for (const sql of ["SELECT * FROM event_delivery", "UPDATE event_delivery SET status = 'delivered', delivered_at = now()", "DELETE FROM event_delivery"]) {
    await assert.rejects(attempt(app, sql), denied, `application role: ${sql}`);
  }
  for (const sql of ["DELETE FROM event_delivery", "UPDATE event_delivery SET envelope = '{}'::jsonb", "UPDATE event_delivery SET consumer = 'other'"]) {
    await assert.rejects(attempt(relay, sql), denied, `relay role: ${sql}`);
  }
});

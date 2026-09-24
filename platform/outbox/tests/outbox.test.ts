import assert from "node:assert/strict";
import test from "node:test";
import { buildEventEnvelopeFor, type EventEnvelope } from "../../event-envelope/src/index.ts";
import { PlatformProblem, problem } from "../../problem-model/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import { tenantId } from "../../tenant-context/src/index.ts";
import { createAuditPolicy, createAuditRecorder, verifyAuditEvent, type AuditEvent } from "../../audit/src/index.ts";
import { resolvePlatformCommandContext } from "../../tenant-context/src/index.ts";
import { OUTBOX_AUDIT_FIELDS, createDeadLetterOperations, createIdempotentConsumer, createOutboxDispatcher, defaultRetryDelaySeconds, type DeadLetterPersistence, type EventPublisher } from "../src/index.ts";
import { InMemoryOutbox, type TestUnitOfWork } from "./in-memory-outbox.ts";

const code = (expected: string) => (error: unknown) => error instanceof PlatformProblem && error.problem.code === expected;

const A = tenantId("tenant_A");
const B = tenantId("tenant_B");
const T0 = Date.parse("2026-09-24T10:00:00.000Z");

let ids = 0;
function envelope(tenant = A, aggregateId = "agg_1", version = 1, type = "tenant.provisioned.v1"): EventEnvelope {
  const occurredAt = new Date(T0);
  return buildEventEnvelopeFor(
    { tenantId: tenant, actorId: "user_1", principalKind: "interactive", correlationId: "corr_out_1" },
    { eventType: type, sourceContext: "identity-tenant", aggregateType: "Tenant", aggregateId, aggregateVersion: version, occurredAt, classification: "CONFIDENTIAL_BUSINESS", data: { n: version } },
    { clock: () => occurredAt, newEventId: () => `evt_${++ids}` },
  ) as EventEnvelope;
}

async function commit(outbox: InMemoryOutbox, ...events: EventEnvelope[]) {
  await outbox.runInTransaction(async (uow) => {
    uow.domain.write(`mutation:${events.map((event) => event.id).join(",")}`);
    for (const event of events) await uow.outbox.append(event);
  });
}

class RecordingPublisher implements EventPublisher {
  published: EventEnvelope[] = [];
  failures = new Map<string, number>();
  failAll = false;
  async publish(event: Readonly<EventEnvelope>) {
    const remaining = this.failures.get(event.id) ?? 0;
    if (this.failAll || remaining > 0) {
      this.failures.set(event.id, Math.max(0, remaining - 1));
      throw new Error("broker refused: password=hunter2 Bearer abc.def.ghi");
    }
    this.published.push(event);
  }
}

function deadLetterKit(outbox: InMemoryOutbox, iso: () => string, authorize: (action: string) => Promise<void> = async () => {}) {
  const auditRows: AuditEvent[] = [];
  const control = { failAudit: false };
  const persistence: DeadLetterPersistence = {
    runInTransaction: async (_scope, work) => {
      const snapshot = structuredClone(outbox.entries);
      const staged: AuditEvent[] = [];
      try {
        const result = await work({
          outbox,
          audit: { append: async (event) => { if (control.failAudit) throw new Error("audit store down"); staged.push(event); } },
        });
        auditRows.push(...staged);
        return result;
      } catch (error) {
        outbox.entries.splice(0, outbox.entries.length, ...snapshot);
        throw error;
      }
    },
  };
  let audits = 0;
  const recorder = createAuditRecorder({ policy: createAuditPolicy(OUTBOX_AUDIT_FIELDS), clock: () => new Date(iso()), newId: () => `aud_${++audits}` });
  const operations = createDeadLetterOperations({ persistence, audit: recorder, clock: () => new Date(iso()), authorize: authorize as never });
  const context = resolvePlatformCommandContext({
    principal: testPrincipal([], { actor: "operator_1" }),
    correlationId: "corr_dl",
  });
  return { operations, context, auditRows, control };
}

function harness(options: { workerId?: string; maxAttempts?: number } = {}) {
  let now = T0;
  const outbox = new InMemoryOutbox();
  const publisher = new RecordingPublisher();
  const dispatcher = (workerId = options.workerId ?? "worker_1", publish: EventPublisher = publisher) =>
    createOutboxDispatcher({
      store: outbox,
      publisher: publish,
      clock: () => new Date(now),
      workerId,
      leaseSeconds: 60,
      ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
    });
  return { outbox, publisher, dispatcher, advance: (seconds: number) => void (now += seconds * 1000), iso: () => new Date(now).toISOString() };
}

test("TC-001-03-01 the mutation and its outbox record commit together and roll back together", async () => {
  const { outbox } = harness();
  await commit(outbox, envelope());
  assert.equal(outbox.domainRows.length, 1);
  assert.equal(outbox.entries.length, 1);

  await assert.rejects(
    outbox.runInTransaction(async (uow) => {
      uow.domain.write("doomed");
      await uow.outbox.append(envelope(A, "agg_2"));
      throw new Error("boom after append");
    }),
    /boom/,
  );
  assert.equal(outbox.domainRows.length, 1, "rolled-back mutation left nothing");
  assert.equal(outbox.entries.length, 1, "rolled-back event left nothing");
});

test("dispatch publishes committed events once and a second pass finds nothing", async () => {
  const { outbox, publisher, dispatcher } = harness();
  await commit(outbox, envelope(A, "agg_1"), envelope(A, "agg_2"));
  const report = await dispatcher()();
  assert.deepEqual(report, { leased: 2, published: 2, retried: 0, deadLettered: 0, leaseLost: 0 });
  assert.equal(publisher.published.length, 2);
  assert.deepEqual(await dispatcher()(), { leased: 0, published: 0, retried: 0, deadLettered: 0, leaseLost: 0 });
  assert.equal(outbox.entries.every((entry) => entry.status === "published"), true);
});

test("TC-001-03-03 per-aggregate order is preserved and failures block only their own stream", async () => {
  const { outbox, publisher, dispatcher, advance } = harness();
  const x1 = envelope(A, "agg_X", 1);
  const x2 = envelope(A, "agg_X", 2);
  const x3 = envelope(A, "agg_X", 3);
  const y1 = envelope(A, "agg_Y", 1);
  await commit(outbox, x1, y1, x2, x3);
  publisher.failures.set(x1.id, 1);

  const run = dispatcher();
  const first = await run();
  assert.equal(first.published, 1, "only y1 is delivered; x1 failed and blocks x2 and x3");
  assert.equal(first.retried, 1);
  assert.deepEqual(publisher.published.map((event) => event.id), [y1.id]);

  assert.equal((await run()).leased, 0, "x stream is in backoff, so x2 must not overtake x1");
  advance(defaultRetryDelaySeconds(1));
  for (let pass = 0; pass < 3; pass += 1) await run();
  assert.deepEqual(publisher.published.map((event) => event.id), [y1.id, x1.id, x2.id, x3.id]);
});

test("publisher failures retry with backoff and store only a redacted error", async () => {
  const { outbox, publisher, dispatcher, advance } = harness();
  const event = envelope();
  await commit(outbox, event);
  publisher.failures.set(event.id, 2);
  const run = dispatcher();

  assert.equal((await run()).retried, 1);
  const [entry] = outbox.entries;
  assert.equal(entry!.status, "pending");
  assert.equal(entry!.attempts, 1);
  assert.equal(entry!.lastError?.includes("hunter2"), false);
  assert.equal(entry!.lastError?.includes("abc.def.ghi"), false);
  assert.equal(Date.parse(entry!.nextAttemptAt) - T0, 5000);

  advance(4);
  assert.equal((await run()).leased, 0, "not due yet");
  advance(2);
  assert.equal((await run()).retried, 1);
  assert.equal(Date.parse(entry!.nextAttemptAt) - Date.parse(new Date(T0 + 6000).toISOString()), 10_000, "backoff doubles");
  advance(11);
  assert.equal((await run()).published, 1);
  assert.equal(publisher.published.length, 1);
});

test("TC-001-03-04 a poison event is dead-lettered, blocks only its stream, and can be requeued", async () => {
  const { outbox, publisher, dispatcher, advance, iso } = harness({ maxAttempts: 3 });
  const poison = envelope(A, "agg_P", 1);
  const behind = envelope(A, "agg_P", 2);
  const other = envelope(A, "agg_Q", 1);
  await commit(outbox, poison, behind, other);
  publisher.failures.set(poison.id, 99);
  const run = dispatcher();

  await run();
  advance(3600);
  await run();
  advance(3600);
  const last = await run();
  assert.equal(last.deadLettered, 1);
  assert.equal(outbox.entries.find((entry) => entry.envelope.id === poison.id)!.status, "dead");
  assert.deepEqual(publisher.published.map((event) => event.id), [other.id], "other streams keep flowing");

  advance(3600);
  assert.equal((await run()).leased, 0, "the dead entry blocks the events queued behind it");
  const stats = await outbox.stats(iso());
  assert.equal(stats.deadLetter, 1);
  assert.equal(stats.blockedStreams, 1, "the stalled stream is visible for alerting");
  assert.ok((stats.oldestDeadLetterAgeSeconds ?? 0) > 0);
  assert.equal(stats.pending, 1);
  assert.ok((stats.oldestUnpublishedAgeSeconds ?? 0) > 0);

  publisher.failures.set(poison.id, 0);
  const { operations, context, auditRows } = deadLetterKit(outbox, iso);
  await operations(context, { entryId: "out_1", action: "requeue", reason: "broker config fixed" });
  await assert.rejects(operations(context, { entryId: "out_1", action: "requeue", reason: "again" }), code("dead_letter_not_resolvable"));
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0]!.action, "outbox.dead_letter_requeued");
  assert.equal(outbox.entries[0]!.resolution?.action, "requeue");
  await run();
  await run();
  assert.deepEqual(publisher.published.map((event) => event.id), [other.id, poison.id, behind.id]);
});

test("a crash-looping event that never records an outcome still reaches the dead letter state", async () => {
  const { outbox, dispatcher, advance } = harness({ maxAttempts: 2 });
  await commit(outbox, envelope());
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await outbox.leaseBatch({ workerId: "crasher", now: new Date(T0 + attempt * 3_600_000).toISOString(), leaseSeconds: 60, limit: 10 });
  }
  advance(4 * 3600);
  const report = await dispatcher()();
  assert.equal(report.deadLettered, 1);
  assert.equal(outbox.entries[0]!.status, "dead");
});

test("TC-001-03-02 crash after publish: the event is redelivered and the consumer deduplicates it", async () => {
  const { outbox, publisher, dispatcher, advance } = harness();
  const event = envelope();
  await commit(outbox, event);

  const flaky: typeof outbox = Object.create(outbox);
  flaky.markPublished = async () => {
    throw new Error("worker died before recording the publish");
  };
  const crashing = createOutboxDispatcher({ store: flaky, publisher, clock: () => new Date(T0), workerId: "worker_1", leaseSeconds: 60 });
  await assert.rejects(crashing(), /worker died/);
  assert.equal(publisher.published.length, 1, "the broker already received it");
  assert.equal(outbox.entries[0]!.status, "leased");

  advance(61);
  const second = await dispatcher("worker_2")();
  assert.equal(second.published, 1);
  assert.equal(publisher.published.length, 2, "at-least-once: delivered twice");
  assert.equal(publisher.published[0]!.id, publisher.published[1]!.id);

  assert.equal(await outbox.markPublished({ entryId: "out_1", workerId: "worker_1", now: new Date(T0).toISOString() }), false, "the stale worker cannot mark");

  const effects: string[] = [];
  const consume = createIdempotentConsumer({
    consumer: "billing.projector",
    persistence: outbox.inbox,
    clock: () => new Date(T0),
    handle: async (received, uow: TestUnitOfWork) => {
      uow.domain.write(`applied:${received.id}`);
      effects.push(received.id);
    },
  });
  const results = [];
  for (const delivered of publisher.published) results.push(await consume(delivered));
  assert.deepEqual(results.map((result) => result.processed), [true, false]);
  assert.deepEqual(effects, [event.id], "one effect despite two deliveries");
});

test("two workers never lease the same entry", async () => {
  const { outbox } = harness();
  await commit(outbox, envelope(A, "a"), envelope(A, "b"), envelope(A, "c"));
  const first = await outbox.leaseBatch({ workerId: "w1", now: new Date(T0).toISOString(), leaseSeconds: 60, limit: 2 });
  const second = await outbox.leaseBatch({ workerId: "w2", now: new Date(T0).toISOString(), leaseSeconds: 60, limit: 5 });
  assert.equal(first.length, 2);
  assert.equal(second.length, 1);
  const all = [...first, ...second].map((entry) => entry.entryId);
  assert.equal(new Set(all).size, all.length);
});

test("inbox deduplication is per consumer and per tenant, and a failing handler records nothing", async () => {
  const { outbox } = harness();
  const event = envelope(A);
  const handled: string[] = [];
  const make = (consumer: string, fail = false) =>
    createIdempotentConsumer({
      consumer,
      persistence: outbox.inbox,
      clock: () => new Date(T0),
      handle: async (received) => {
        if (fail) throw new Error("handler failed");
        handled.push(`${consumer}:${received.tenant_id}`);
      },
    });

  await assert.rejects(make("invoicing.projector", true)(event), /handler failed/);
  assert.equal(outbox.inboxRecords.size, 0, "failure rolled the inbox record back");
  assert.equal((await make("invoicing.projector")(event)).processed, true, "redelivery is processed after a failure");
  assert.equal((await make("invoicing.projector")(event)).processed, false);
  assert.equal((await make("notifications")(event)).processed, true, "other consumers still receive it");
  const sameIdOtherTenant = { ...event, tenant_id: B } as EventEnvelope;
  assert.equal((await make("invoicing.projector")(sameIdOtherTenant)).processed, true, "dedup never crosses tenants");
  assert.deepEqual(handled, ["invoicing.projector:tenant_A", "notifications:tenant_A", "invoicing.projector:tenant_B"]);
  assert.deepEqual(
    outbox.inboxScopes.map((scope) => [scope.tenantId, scope.correlationId]),
    [[A, "corr_out_1"], [A, "corr_out_1"], [A, "corr_out_1"], [A, "corr_out_1"], [B, "corr_out_1"]],
    "each consumer transaction is bound to the delivered event's tenant and correlation",
  );
});

test("malformed envelopes and consumer names are rejected", async () => {
  const { outbox } = harness();
  assert.throws(() => createIdempotentConsumer({ consumer: "Bad Name", persistence: outbox.inbox, clock: () => new Date(T0), handle: async () => {} }), (error: unknown) => error instanceof PlatformProblem);
  const consume = createIdempotentConsumer({ consumer: "ok.consumer", persistence: outbox.inbox, clock: () => new Date(T0), handle: async () => {} });
  await assert.rejects(consume({ ...envelope(), id: " " } as EventEnvelope), (error: unknown) => error instanceof PlatformProblem);
  await assert.rejects(consume({ ...envelope(), tenant_id: "" } as unknown as EventEnvelope), (error: unknown) => error instanceof PlatformProblem);
  assert.equal(outbox.inboxRecords.size, 0);
});

test("retry delay grows exponentially and is capped", () => {
  assert.deepEqual([1, 2, 3, 4].map(defaultRetryDelaySeconds), [5, 10, 20, 40]);
  assert.equal(defaultRetryDelaySeconds(30), 900);
  assert.equal(defaultRetryDelaySeconds(0), 5);
});

function poisonedStream() {
  const context = harness({ maxAttempts: 1 });
  return context;
}

test("skipping a dead-lettered event unblocks its stream, keeps the evidence, and never republishes it", async () => {
  const { outbox, publisher, dispatcher, advance, iso } = poisonedStream();
  const poison = envelope(A, "agg_P", 1);
  const behind1 = envelope(A, "agg_P", 2);
  const behind2 = envelope(A, "agg_P", 3);
  await commit(outbox, poison, behind1, behind2);
  publisher.failures.set(poison.id, 99);
  const run = dispatcher();
  assert.equal((await run()).deadLettered, 1);
  advance(3600);
  assert.equal((await run()).leased, 0, "blocked by default: order is never violated silently");

  const { operations, context, auditRows } = deadLetterKit(outbox, iso);
  await operations(context, { entryId: "out_1", action: "skip", reason: "malformed legacy event, downstream reconciled manually" });
  assert.equal(auditRows.length, 1);
  const audited = auditRows[0]!;
  assert.equal(audited.action, "outbox.dead_letter_skipped");
  assert.equal(audited.tenantId, "tenant_A", "audited against the affected event tenant");
  assert.deepEqual(audited.actor, { id: "operator_1", kind: "interactive" });
  assert.equal(audited.reason, "malformed legacy event, downstream reconciled manually");
  assert.equal(audited.after?.event_id, poison.id);
  assert.equal(audited.after?.resolution, "skip");
  assert.equal(verifyAuditEvent(audited), true);

  const skipped = outbox.entries[0]!;
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.envelope.id, poison.id, "the envelope is retained");
  assert.deepEqual(
    { action: skipped.resolution?.action, operator: skipped.resolution?.operatorId, reason: skipped.resolution?.reason },
    { action: "skip", operator: "operator_1", reason: "malformed legacy event, downstream reconciled manually" },
  );
  assert.equal((await outbox.stats(iso())).blockedStreams, 0);

  await run();
  await run();
  assert.deepEqual(publisher.published.map((event) => event.id), [behind1.id, behind2.id], "later events flow in order; the skipped one is never sent");
  assert.equal(publisher.published.some((event) => event.id === poison.id), false);
});

test("dead-letter resolution is authorized first, needs a reason, and only applies to dead entries", async () => {
  const { outbox, publisher, dispatcher, iso } = poisonedStream();
  const poison = envelope(A, "agg_P", 1);
  const healthy = envelope(A, "agg_H", 1);
  await commit(outbox, poison, healthy);
  publisher.failures.set(poison.id, 99);
  await dispatcher()();

  let authorized = 0;
  const { operations, context, auditRows, control } = deadLetterKit(outbox, iso, async (action) => {
    authorized += 1;
    if (action === "skip") throw problem({ code: "permission_denied", detail: "denied" });
  });

  await assert.rejects(operations(context, { entryId: "out_1", action: "skip", reason: "x" }), code("permission_denied"));
  assert.equal(outbox.entries[0]!.status, "dead", "an unauthorized skip changes nothing");
  await assert.rejects(operations(context, { entryId: "out_1", action: "requeue", reason: "   " }), code("dead_letter_reason_required"));
  await assert.rejects(operations(context, { entryId: "out_2", action: "requeue", reason: "healthy entry" }), code("dead_letter_not_resolvable"));
  await assert.rejects(operations(context, { entryId: "missing", action: "requeue", reason: "x" }), code("dead_letter_not_resolvable"));
  await assert.rejects(operations(context, { entryId: "out_1", action: "delete" as never, reason: "x" }), code("invalid_trusted_context"));
  assert.equal(authorized, 5, "authorization ran before every other check");
  assert.equal(outbox.entries[0]!.resolution, undefined);
  assert.equal(auditRows.length, 0, "rejected attempts leave no audit event");

  control.failAudit = true;
  await assert.rejects(operations(context, { entryId: "out_1", action: "requeue", reason: "retry" }), /audit store down/);
  assert.equal(outbox.entries[0]!.status, "dead", "an unaudited resolution is rolled back");
  assert.equal(outbox.entries[0]!.resolution, undefined);
});

import { metrics, type BatchObservableCallback, type Counter, type MeterProvider } from "@opentelemetry/api";
import { INSTRUMENTATION_SCOPE, safeAttributes } from "./telemetry.ts";

/**
 * The metrics named by the Phase 0 backlog (decision D15). Instruments are resolved against the
 * currently registered meter provider, so code can record before or after telemetry starts; before
 * it starts, recording is a no-op. Attribute values are low-cardinality (codes, scopes, outcomes),
 * never tenant, actor or record identifiers.
 */
interface Instruments {
  readonly problems: Counter;
  readonly idempotency: Counter;
  readonly auditWriteFailures: Counter;
  readonly queueOutcomes: Counter;
}

const byProvider = new WeakMap<MeterProvider, Instruments>();

function instruments(): Instruments {
  const provider = metrics.getMeterProvider();
  let found = byProvider.get(provider);
  if (found === undefined) {
    const meter = provider.getMeter(INSTRUMENTATION_SCOPE);
    found = {
      problems: meter.createCounter("sintius.http.problems", { description: "Problem responses returned at ingress, by stable code." }),
      idempotency: meter.createCounter("sintius.idempotency.requests", { description: "Idempotent command executions by outcome." }),
      auditWriteFailures: meter.createCounter("sintius.audit.write_failures", { description: "Audit appends that failed and rolled their command back." }),
      queueOutcomes: meter.createCounter("sintius.queue.outcomes", { description: "Outbox and delivery hand-over outcomes by queue." }),
    };
    byProvider.set(provider, found);
  }
  return found;
}

export type IdempotencyOutcome = "executed" | "replayed" | "conflict" | "in_progress" | "rejected" | "failed";
export type QueueOutcome = "published" | "retried" | "dead_lettered" | "lease_lost";

export const telemetryMetrics = Object.freeze({
  problem(code: string, status: number): void {
    instruments().problems.add(1, safeAttributes({ "sintius.problem.code": code, "http.response.status_code": status }));
  },
  idempotency(scope: string, outcome: IdempotencyOutcome): void {
    instruments().idempotency.add(1, safeAttributes({ "sintius.command.scope": scope, "sintius.idempotency.outcome": outcome }));
  },
  auditWriteFailure(action: string): void {
    instruments().auditWriteFailures.add(1, safeAttributes({ "sintius.audit.action": action }));
  },
  queueOutcome(queue: string, outcome: QueueOutcome, count: number): void {
    if (count > 0) instruments().queueOutcomes.add(count, safeAttributes({ "sintius.queue.name": queue, "sintius.queue.outcome": outcome }));
  },
});

/** The subset of queue statistics the gauges read (structurally `OutboxStats`). */
export interface QueueStatsSnapshot {
  readonly pending: number;
  readonly leased: number;
  readonly deadLetter: number;
  readonly blockedStreams: number;
  readonly oldestDeadLetterAgeSeconds: number | undefined;
  readonly oldestUnpublishedAgeSeconds: number | undefined;
}

/**
 * Registers observable gauges for one queue (the outbox or a consumer's deliveries): depth,
 * dead letters, blocked streams (alert on any value above zero) and the age of the oldest
 * unpublished entry (the lag signal). Returns an unregister function.
 */
export function registerQueueGauges(queue: string, stats: (now: string) => Promise<QueueStatsSnapshot>, clock: () => Date = () => new Date()): () => void {
  const meter = metrics.getMeter(INSTRUMENTATION_SCOPE);
  const pending = meter.createObservableGauge("sintius.queue.pending", { description: "Entries waiting to be handed over." });
  const dead = meter.createObservableGauge("sintius.queue.dead_letters", { description: "Dead-lettered entries awaiting an operator." });
  const blocked = meter.createObservableGauge("sintius.queue.blocked_streams", { description: "Aggregate streams stalled behind a dead letter." });
  const lag = meter.createObservableGauge("sintius.queue.oldest_unpublished_age_seconds", { unit: "s", description: "Age of the oldest entry not yet handed over." });
  const attributes = safeAttributes({ "sintius.queue.name": queue });
  const callback: BatchObservableCallback = async (result) => {
    const snapshot = await stats(clock().toISOString());
    result.observe(pending, snapshot.pending, attributes);
    result.observe(dead, snapshot.deadLetter, attributes);
    result.observe(blocked, snapshot.blockedStreams, attributes);
    result.observe(lag, snapshot.oldestUnpublishedAgeSeconds ?? 0, attributes);
  };
  meter.addBatchObservableCallback(callback, [pending, dead, blocked, lag]);
  return () => meter.removeBatchObservableCallback(callback, [pending, dead, blocked, lag]);
}

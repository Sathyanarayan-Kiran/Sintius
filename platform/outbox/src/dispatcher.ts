import { SpanKind, contextFromCarrier, telemetryMetrics, withSpan } from "../../observability/src/index.ts";
import { redactSensitiveText } from "../../problem-model/src/index.ts";
import type { EventPublisher, OutboxEntry, OutboxStore } from "./ports.ts";

export interface DispatchReport {
  readonly leased: number;
  readonly published: number;
  readonly retried: number;
  readonly deadLettered: number;
  readonly leaseLost: number;
}

export interface DispatcherDependencies {
  readonly store: OutboxStore;
  readonly publisher: EventPublisher;
  readonly clock: () => Date;
  readonly workerId: string;
  /** Telemetry label: "outbox" or the consumer name of a delivery queue. */
  readonly queueName?: string;
  readonly leaseSeconds?: number;
  readonly batchSize?: number;
  readonly maxAttempts?: number;
  /** Delay before the next attempt, given the attempt that just failed (1-based). */
  readonly retryDelaySeconds?: (failedAttempt: number) => number;
}

/** 5s, 10s, 20s ... capped at 15 minutes. */
export function defaultRetryDelaySeconds(failedAttempt: number): number {
  return Math.min(5 * 2 ** Math.max(0, failedAttempt - 1), 900);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : "non-error failure";
  return redactSensitiveText(message);
}

/**
 * One dispatch pass: lease, publish, then mark. A crash between publish and mark leaves the lease to
 * expire, after which the event is published again; consumers deduplicate by event id.
 */
export function createOutboxDispatcher(dependencies: DispatcherDependencies) {
  const { store, publisher, clock, workerId } = dependencies;
  const leaseSeconds = dependencies.leaseSeconds ?? 60;
  const batchSize = dependencies.batchSize ?? 50;
  const maxAttempts = dependencies.maxAttempts ?? 8;
  const retryDelaySeconds = dependencies.retryDelaySeconds ?? defaultRetryDelaySeconds;
  const queueName = dependencies.queueName ?? "outbox";
  // Each hand-over is a PRODUCER span that continues the trace stored with the entry.
  const handOver = (entry: Readonly<OutboxEntry>) =>
    withSpan(
      `${queueName} hand-over ${entry.envelope.type}`,
      {
        kind: SpanKind.PRODUCER,
        parent: contextFromCarrier(entry.traceContext),
        attributes: {
          "messaging.system": "sintius",
          "messaging.destination.name": queueName,
          "sintius.event.type": entry.envelope.type,
          "sintius.correlation_id": entry.envelope.correlation_id,
          "sintius.delivery.attempt": entry.attempts,
        },
      },
      () => publisher.publish(entry.envelope),
    );

  return async function runOnce(): Promise<DispatchReport> {
    const leaseNow = clock();
    const entries = await store.leaseBatch({ workerId, now: leaseNow.toISOString(), leaseSeconds, limit: batchSize });
    let published = 0;
    let retried = 0;
    let deadLettered = 0;
    let leaseLost = 0;

    for (const entry of entries) {
      if (entry.attempts > maxAttempts) {
        // Leased repeatedly without ever recording an outcome (for example a crash-looping worker).
        const ok = await store.recordFailure({
          entryId: entry.entryId,
          workerId,
          now: clock().toISOString(),
          error: "Exceeded maximum delivery attempts.",
        });
        if (ok) deadLettered += 1;
        else leaseLost += 1;
        continue;
      }
      try {
        await handOver(entry);
      } catch (error) {
        const now = clock();
        const exhausted = entry.attempts >= maxAttempts;
        const ok = await store.recordFailure({
          entryId: entry.entryId,
          workerId,
          now: now.toISOString(),
          error: safeError(error),
          ...(exhausted ? {} : { retryAt: new Date(now.valueOf() + retryDelaySeconds(entry.attempts) * 1000).toISOString() }),
        });
        if (!ok) leaseLost += 1;
        else if (exhausted) deadLettered += 1;
        else retried += 1;
        continue;
      }
      const ok = await store.markPublished({ entryId: entry.entryId, workerId, now: clock().toISOString() });
      if (ok) published += 1;
      else leaseLost += 1;
    }
    telemetryMetrics.queueOutcome(queueName, "published", published);
    telemetryMetrics.queueOutcome(queueName, "retried", retried);
    telemetryMetrics.queueOutcome(queueName, "dead_lettered", deadLettered);
    telemetryMetrics.queueOutcome(queueName, "lease_lost", leaseLost);
    return { leased: entries.length, published, retried, deadLettered, leaseLost };
  };
}

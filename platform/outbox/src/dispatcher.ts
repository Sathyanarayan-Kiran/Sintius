import { redactSensitiveText } from "../../problem-model/src/index.ts";
import type { EventPublisher, OutboxStore } from "./ports.ts";

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
        await publisher.publish(entry.envelope);
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
    return { leased: entries.length, published, retried, deadLettered, leaseLost };
  };
}

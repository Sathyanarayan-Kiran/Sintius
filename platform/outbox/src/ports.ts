import type { EventEnvelope } from "../../event-envelope/src/index.ts";
import type { TenantId } from "../../tenant-context/src/index.ts";

export type OutboxStatus = "pending" | "leased" | "published" | "dead" | "skipped";

export type DeadLetterAction = "requeue" | "skip";

/** Evidence of an operator decision on a dead-lettered entry; kept on the entry permanently. */
export interface DeadLetterResolution {
  readonly action: DeadLetterAction;
  readonly operatorId: string;
  readonly reason: string;
  readonly resolvedAt: string;
}

/** What the resolution store reports back, so the caller can audit against the right tenant. */
export interface DeadLetterInfo {
  readonly entryId: string;
  readonly tenantId: TenantId;
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
}

/** A stream is the ordering scope: (tenant, aggregate type, aggregate id). */
export interface OutboxEntry {
  readonly entryId: string;
  /** Assigned by the store on append; strictly increasing, defines order within a stream. */
  readonly sequence: number;
  readonly envelope: Readonly<EventEnvelope>;
  readonly status: OutboxStatus;
  /** Incremented when a lease is granted, so a crash-looping event still reaches `dead`. */
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly appendedAt: string;
  readonly leasedBy?: string;
  readonly leaseExpiresAt?: string;
  readonly lastError?: string;
  readonly publishedAt?: string;
  readonly resolution?: DeadLetterResolution;
}

/**
 * Called inside the domain transaction, so the mutation and its event commit or roll back together.
 * Append-only: no update or delete. The row's tenant is `envelope.tenant_id`, which must equal the
 * tenant the transaction is bound to; adapters reject a mismatch.
 */
export interface OutboxWriter {
  append(envelope: Readonly<EventEnvelope>): Promise<void>;
}

export interface LeaseRequest {
  readonly workerId: string;
  readonly now: string;
  readonly leaseSeconds: number;
  readonly limit: number;
}

export interface OutboxStats {
  readonly pending: number;
  readonly leased: number;
  readonly deadLetter: number;
  /** Aggregate streams currently stalled behind a dead entry; alert on any value above zero. */
  readonly blockedStreams: number;
  readonly oldestDeadLetterAgeSeconds: number | undefined;
  readonly oldestUnpublishedAgeSeconds: number | undefined;
}

/**
 * Dispatcher-side storage. It runs as a dedicated workload identity across tenants; row-level
 * security policy for that role belongs to P0-009.
 *
 * Contract for adapters:
 * - `leaseBatch` atomically grants at most ONE entry per stream, and only when no earlier entry of
 *   that stream is unpublished (pending in backoff, leased by a live lease, or dead). This keeps
 *   per-aggregate order. A skipped entry no longer blocks. Eligible: pending with `nextAttemptAt <= now`, or leased with an expired
 *   lease. Granting a lease increments `attempts`.
 * - `mark*` calls succeed only for the current lease holder and return false when the lease was lost.
 */
export interface OutboxStore {
  leaseBatch(request: Readonly<LeaseRequest>): Promise<readonly Readonly<OutboxEntry>[]>;
  markPublished(input: { readonly entryId: string; readonly workerId: string; readonly now: string }): Promise<boolean>;
  /** `retryAt` undefined dead-letters the entry. */
  recordFailure(input: {
    readonly entryId: string;
    readonly workerId: string;
    readonly now: string;
    readonly error: string;
    readonly retryAt?: string;
  }): Promise<boolean>;
  /**
   * Operator control, valid only for a dead entry (returns undefined otherwise). "requeue" returns it to
   * pending with a fresh attempt budget. "skip" marks it terminal so later events of its stream can
   * flow; the envelope and the resolution stay on record. Both persist the resolution evidence.
   */
  resolveDeadLetter(input: {
    readonly entryId: string;
    readonly action: DeadLetterAction;
    readonly operatorId: string;
    readonly reason: string;
    readonly now: string;
  }): Promise<DeadLetterInfo | undefined>;
  stats(now: string): Promise<OutboxStats>;
}

/** Broker port. Delivery is at-least-once; the same envelope may be published more than once. */
export interface EventPublisher {
  publish(envelope: Readonly<EventEnvelope>): Promise<void>;
}

/** Consumer-side deduplication record, scoped by consumer and tenant. */
export interface InboxStore {
  /** Atomic insert on (consumer, tenantId, eventId): "recorded" the first time, "duplicate" after. */
  tryRecord(input: {
    readonly consumer: string;
    readonly tenantId: string;
    readonly eventId: string;
    readonly now: string;
  }): Promise<"recorded" | "duplicate">;
}

export interface InboxPersistence<U extends { readonly inbox: InboxStore }> {
  /** The inbox record and the handler's writes commit together or not at all. */
  runInTransaction<T>(work: (unitOfWork: U) => Promise<T>): Promise<T>;
}

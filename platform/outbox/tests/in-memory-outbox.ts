import type { EventEnvelope } from "../../event-envelope/src/index.ts";
import type {
  DeadLetterInfo,
  InboxPersistence,
  InboxStore,
  InboxTransactionScope,
  LeaseRequest,
  OutboxEntry,
  OutboxStats,
  OutboxStore,
  OutboxWriter,
} from "../src/index.ts";

/**
 * TEST DOUBLE ONLY. Models the documented store contracts (one lease per stream, head-of-line
 * blocking, lease ownership, staged commit or rollback) so dispatcher and consumer logic can be unit
 * tested. It is NOT evidence of PostgreSQL behaviour such as SKIP LOCKED leasing or transactional
 * atomicity between a real domain table and the outbox table.
 */
export interface TestUnitOfWork {
  readonly domain: { write(row: string): void };
  readonly outbox: OutboxWriter;
  readonly inbox: InboxStore;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const streamOf = (envelope: Readonly<EventEnvelope>) => [envelope.tenant_id, envelope.aggregate_type, envelope.aggregate_id].join("|");

export class InMemoryOutbox implements OutboxStore {
  domainRows: string[] = [];
  entries: Mutable<OutboxEntry>[] = [];
  inboxRecords = new Set<string>();
  /** Consumer-side view: records the scope each consumer transaction was bound to. */
  readonly inboxScopes: InboxTransactionScope[] = [];
  readonly inbox: InboxPersistence<TestUnitOfWork> = {
    runInTransaction: (scope, work) => {
      this.inboxScopes.push(scope);
      return this.runInTransaction(work);
    },
  };
  #sequence = 0;

  async runInTransaction<T>(work: (unitOfWork: TestUnitOfWork) => Promise<T>): Promise<T> {
    const rows: string[] = [];
    const appended: Readonly<EventEnvelope>[] = [];
    const inboxStaged = new Set<string>();
    const result = await work({
      domain: { write: (row) => void rows.push(row) },
      outbox: { append: async (envelope) => void appended.push(envelope) },
      inbox: {
        tryRecord: async ({ consumer, tenantId, eventId }) => {
          const key = [consumer, tenantId, eventId].map(encodeURIComponent).join("|");
          if (this.inboxRecords.has(key) || inboxStaged.has(key)) return "duplicate";
          inboxStaged.add(key);
          return "recorded";
        },
      },
    });
    this.domainRows.push(...rows);
    for (const envelope of appended) {
      this.#sequence += 1;
      this.entries.push({
        entryId: `out_${this.#sequence}`,
        sequence: this.#sequence,
        envelope,
        status: "pending",
        attempts: 0,
        nextAttemptAt: envelope.recorded_at,
        appendedAt: envelope.recorded_at,
      });
    }
    for (const key of inboxStaged) this.inboxRecords.add(key);
    return result;
  }

  async leaseBatch(request: Readonly<LeaseRequest>): Promise<readonly OutboxEntry[]> {
    const now = Date.parse(request.now);
    const granted: OutboxEntry[] = [];
    const seen = new Set<string>();
    for (const entry of [...this.entries].sort((left, right) => left.sequence - right.sequence)) {
      if (entry.status === "published" || entry.status === "skipped") continue;
      const stream = streamOf(entry.envelope);
      if (seen.has(stream)) continue;
      seen.add(stream);
      const eligible =
        (entry.status === "pending" && Date.parse(entry.nextAttemptAt) <= now) ||
        (entry.status === "leased" && Date.parse(entry.leaseExpiresAt!) <= now);
      if (!eligible || granted.length >= request.limit) continue;
      entry.status = "leased";
      entry.attempts += 1;
      entry.leasedBy = request.workerId;
      entry.leaseExpiresAt = new Date(now + request.leaseSeconds * 1000).toISOString();
      granted.push({ ...entry });
    }
    return granted;
  }

  #held(entryId: string, workerId: string): Mutable<OutboxEntry> | undefined {
    const entry = this.entries.find((candidate) => candidate.entryId === entryId);
    return entry !== undefined && entry.status === "leased" && entry.leasedBy === workerId ? entry : undefined;
  }

  async markPublished(input: { entryId: string; workerId: string; now: string }): Promise<boolean> {
    const entry = this.#held(input.entryId, input.workerId);
    if (entry === undefined) return false;
    entry.status = "published";
    entry.publishedAt = input.now;
    return true;
  }

  async recordFailure(input: { entryId: string; workerId: string; now: string; error: string; retryAt?: string }): Promise<boolean> {
    const entry = this.#held(input.entryId, input.workerId);
    if (entry === undefined) return false;
    entry.lastError = input.error;
    if (input.retryAt === undefined) {
      entry.status = "dead";
    } else {
      entry.status = "pending";
      entry.nextAttemptAt = input.retryAt;
    }
    delete entry.leasedBy;
    delete entry.leaseExpiresAt;
    return true;
  }

  async resolveDeadLetter(input: { entryId: string; action: "requeue" | "skip"; operatorId: string; reason: string; now: string }): Promise<DeadLetterInfo | undefined> {
    const entry = this.entries.find((candidate) => candidate.entryId === input.entryId);
    if (entry === undefined || entry.status !== "dead") return undefined;
    entry.resolution = { action: input.action, operatorId: input.operatorId, reason: input.reason, resolvedAt: input.now };
    if (input.action === "skip") {
      entry.status = "skipped";
    } else {
      entry.status = "pending";
      entry.attempts = 0;
      entry.nextAttemptAt = input.now;
    }
    return {
      entryId: entry.entryId,
      tenantId: entry.envelope.tenant_id as never,
      eventId: entry.envelope.id,
      eventType: entry.envelope.type,
      aggregateType: entry.envelope.aggregate_type,
      aggregateId: entry.envelope.aggregate_id,
    };
  }

  async stats(now: string): Promise<OutboxStats> {
    const unpublished = this.entries.filter((entry) => entry.status !== "published" && entry.status !== "skipped");
    const dead = unpublished.filter((entry) => entry.status === "dead");
    const age = (rows: Mutable<OutboxEntry>[], pick: (entry: Mutable<OutboxEntry>) => string) => {
      const oldest = rows.map((entry) => Date.parse(pick(entry))).sort((a, b) => a - b)[0];
      return oldest === undefined ? undefined : (Date.parse(now) - oldest) / 1000;
    };
    return {
      pending: unpublished.filter((entry) => entry.status === "pending").length,
      leased: unpublished.filter((entry) => entry.status === "leased").length,
      deadLetter: dead.length,
      blockedStreams: new Set(dead.map((entry) => streamOf(entry.envelope))).size,
      oldestDeadLetterAgeSeconds: age(dead, (entry) => entry.appendedAt),
      oldestUnpublishedAgeSeconds: age(unpublished, (entry) => entry.appendedAt),
    };
  }
}

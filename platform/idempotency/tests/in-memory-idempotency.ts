import type {
  ClaimInput,
  ClaimResult,
  IdempotencyMaintenance,
  IdempotencyPersistence,
  IdempotencyRecord,
  IdempotencyStore,
  StoredResponse,
} from "../src/index.ts";

/**
 * TEST DOUBLE ONLY. It models the documented store contract (atomic claim, a concurrent claim of
 * the same key waits for the first transaction to end, staged writes commit or vanish together) so
 * executor logic can be unit tested. It is NOT evidence of PostgreSQL unique-index behaviour.
 */
export interface TestUnitOfWork {
  readonly idempotency: IdempotencyStore;
  readonly effects: { record(effect: string): void };
  readonly outbox: { append(event: string): void };
}

const keyOf = (tenantId: string, scope: string, key: string) => [tenantId, scope, key].map(encodeURIComponent).join("|");

export class InMemoryIdempotentPersistence implements IdempotencyPersistence<TestUnitOfWork>, IdempotencyMaintenance {
  records = new Map<string, IdempotencyRecord>();
  effects: string[] = [];
  outbox: string[] = [];
  transactionsStarted = 0;
  #locks = new Map<string, Promise<void>>();

  async runInTransaction<T>(_scope: unknown, work: (unitOfWork: TestUnitOfWork) => Promise<T>): Promise<T> {
    this.transactionsStarted += 1;
    const stagedRecords = new Map<string, IdempotencyRecord>();
    const stagedEffects: string[] = [];
    const stagedOutbox: string[] = [];
    const releases: Array<() => void> = [];

    const idempotency: IdempotencyStore = {
      claim: async (input: Readonly<ClaimInput>): Promise<ClaimResult> => {
        const key = keyOf(input.tenantId, input.scope, input.key);
        while (this.#locks.has(key)) await this.#locks.get(key);
        let release!: () => void;
        this.#locks.set(key, new Promise<void>((resolve) => (release = resolve)));
        releases.push(() => {
          this.#locks.delete(key);
          release();
        });
        const existing = stagedRecords.get(key) ?? this.records.get(key);
        if (existing !== undefined && Date.parse(existing.expiresAt) > Date.parse(input.now)) {
          return { kind: "existing", record: existing };
        }
        stagedRecords.set(key, {
          tenantId: input.tenantId,
          scope: input.scope,
          key: input.key,
          requestHash: input.requestHash,
          status: "processing",
          createdAt: input.now,
          expiresAt: input.expiresAt,
        });
        return { kind: "claimed" };
      },
      complete: async (input: { tenantId: string; scope: string; key: string; response: StoredResponse }) => {
        const key = keyOf(input.tenantId, input.scope, input.key);
        const claimed = stagedRecords.get(key);
        if (claimed === undefined) throw new Error("complete without claim");
        stagedRecords.set(key, { ...claimed, status: "completed", response: input.response });
      },
    };

    try {
      const result = await work({
        idempotency,
        effects: { record: (effect) => void stagedEffects.push(effect) },
        outbox: { append: (event) => void stagedOutbox.push(event) },
      });
      for (const [key, record] of stagedRecords) this.records.set(key, record);
      this.effects.push(...stagedEffects);
      this.outbox.push(...stagedOutbox);
      return result;
    } finally {
      for (const release of releases) release();
    }
  }

  async purgeExpired(now: string): Promise<number> {
    let removed = 0;
    for (const [key, record] of this.records) {
      if (Date.parse(record.expiresAt) <= Date.parse(now)) {
        this.records.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

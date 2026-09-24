import type { KeyValueStore } from "./cache.ts";

interface Entry<V> {
  readonly value: V;
  readonly expiresAt: number | undefined;
}

/**
 * In-process key/value store behind `TenantScopedCache` (decision D16). Size-bounded with
 * least-recently-used eviction and optional TTL. Values are structured-cloned on the way in and
 * out, so no caller can mutate another caller's cached object. It is per process: when several
 * instances need a shared, coherent cache, a Redis adapter implements the same port.
 */
export class InMemoryKeyValueStore<V> implements KeyValueStore<V> {
  readonly #entries = new Map<string, Entry<V>>();
  readonly #maxEntries: number;
  readonly #defaultTtlSeconds: number | undefined;
  readonly #clock: () => number;

  constructor(options: { readonly maxEntries: number; readonly defaultTtlSeconds?: number; readonly clock?: () => number }) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) throw new RangeError("maxEntries must be a positive integer.");
    this.#maxEntries = options.maxEntries;
    this.#defaultTtlSeconds = options.defaultTtlSeconds;
    this.#clock = options.clock ?? Date.now;
  }

  get size(): number {
    return this.#entries.size;
  }

  async get(key: string): Promise<V | undefined> {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.#clock()) {
      this.#entries.delete(key);
      return undefined;
    }
    // Re-insert to mark as most recently used.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return structuredClone(entry.value);
  }

  async set(key: string, value: V, options: { readonly ttlSeconds?: number } = {}): Promise<void> {
    const ttl = options.ttlSeconds ?? this.#defaultTtlSeconds;
    if (ttl !== undefined && !(Number.isFinite(ttl) && ttl > 0)) throw new RangeError("ttlSeconds must be a positive number.");
    this.#entries.delete(key);
    this.#entries.set(key, { value: structuredClone(value), expiresAt: ttl === undefined ? undefined : this.#clock() + ttl * 1000 });
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }
}

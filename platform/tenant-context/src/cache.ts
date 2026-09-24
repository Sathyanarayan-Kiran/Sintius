import { problem } from "../../problem-model/src/index.ts";
import { currentTenantContext } from "./context.ts";

/** Raw key/value port implemented by an infrastructure adapter (for example Redis). */
export interface KeyValueStore<V> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V, options?: { readonly ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

const NAMESPACE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;

function encodeSegment(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw problem({
      code: "invalid_trusted_context",
      detail: `${field} must be a non-empty string of at most 256 characters.`,
    });
  }
  // encodeURIComponent escapes ":" so distinct part lists can never collide after joining.
  return encodeURIComponent(value);
}

/**
 * Builds `tenant:{tenantId}:{namespace}:{part}...` from the active trusted context. There is
 * deliberately no tenant parameter: callers cannot address another tenant's keys.
 */
export function tenantScopedKey(namespace: string, ...parts: readonly string[]): string {
  const context = currentTenantContext();
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw problem({ code: "invalid_trusted_context", detail: "Cache namespace must be a lowercase module-owned identifier." });
  }
  if (parts.length === 0) {
    throw problem({ code: "invalid_trusted_context", detail: "A cache key requires at least one key part." });
  }
  return ["tenant", encodeSegment(context.tenantId, "tenantId"), namespace, ...parts.map((part) => encodeSegment(part, "key part"))].join(":");
}

/** Cache facade that only ever touches keys under the active tenant. Modules receive this, never the raw store. */
export class TenantScopedCache<V> {
  readonly #store: KeyValueStore<V>;
  readonly #namespace: string;

  constructor(store: KeyValueStore<V>, namespace: string) {
    this.#store = store;
    this.#namespace = namespace;
  }

  get(...parts: readonly string[]): Promise<V | undefined> {
    return this.#store.get(tenantScopedKey(this.#namespace, ...parts));
  }

  set(parts: readonly string[], value: V, options?: { readonly ttlSeconds?: number }): Promise<void> {
    return this.#store.set(tenantScopedKey(this.#namespace, ...parts), value, options);
  }

  delete(...parts: readonly string[]): Promise<void> {
    return this.#store.delete(tenantScopedKey(this.#namespace, ...parts));
  }
}

import type { TenantId } from "../../tenant-context/src/index.ts";
import type { JsonValue } from "./canonical.ts";

export type IdempotencyStatus = "processing" | "completed";

export interface StoredResponse {
  readonly status: number;
  readonly body: JsonValue;
}

export interface IdempotencyRecord {
  readonly tenantId: TenantId;
  readonly scope: string;
  readonly key: string;
  readonly requestHash: string;
  readonly status: IdempotencyStatus;
  readonly response?: StoredResponse;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ClaimInput {
  readonly tenantId: TenantId;
  readonly scope: string;
  readonly key: string;
  readonly requestHash: string;
  readonly now: string;
  readonly expiresAt: string;
}

export type ClaimResult =
  | { readonly kind: "claimed" }
  | { readonly kind: "existing"; readonly record: Readonly<IdempotencyRecord> }
  | { readonly kind: "in_progress"; readonly retryAfterSeconds: number };

/**
 * Bound to ONE open database transaction, the same one the protected command writes in.
 *
 * Contract for adapters:
 * - `claim` is an atomic insert on the unique key (tenant, scope, key). A concurrent claim of the
 *   same key must not proceed until the first transaction ends: after commit it observes the
 *   record, after rollback it can claim. An adapter that cannot wait may return `in_progress`.
 * - A record whose `expiresAt` is not after `now` is treated as absent and replaced atomically.
 * - Rows are tenant-scoped; the tenant always comes from the executor, never from a caller.
 */
export interface IdempotencyStore {
  claim(input: Readonly<ClaimInput>): Promise<ClaimResult>;
  complete(input: {
    readonly tenantId: TenantId;
    readonly scope: string;
    readonly key: string;
    readonly response: StoredResponse;
  }): Promise<void>;
}

/** Platform-scoped cleanup job; expired rows only, never rows for effects that are not yet durable. */
export interface IdempotencyMaintenance {
  purgeExpired(now: string): Promise<number>;
}

export interface IdempotencyPersistence<U extends { readonly idempotency: IdempotencyStore }> {
  /** Every write in `work`, including the idempotency claim and completion, commits together or none does. */
  runInTransaction<T>(
    scope: { readonly correlationId: string; readonly causationId?: string },
    work: (unitOfWork: U) => Promise<T>,
  ): Promise<T>;
}

import { problem } from "../../problem-model/src/index.ts";
import { currentTenantContext, type TenantId } from "./context.ts";

export interface TenantTransactionScope {
  readonly tenantId: TenantId;
  readonly correlationId: string;
  readonly causationId?: string;
}

export interface TenantTransaction {
  /** The tenant the underlying session was actually bound to (for PostgreSQL, the RLS session variable). */
  readonly tenantId: TenantId;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** Implemented by the persistence adapter. It must bind the session to `scope.tenantId` before returning. */
export interface TenantTransactionAdapter {
  begin(scope: TenantTransactionScope): Promise<TenantTransaction>;
}

/**
 * Opens a transaction scoped to the active trusted tenant. The adapter's echoed tenant is
 * verified so an adapter bug cannot silently bind the wrong tenant; any failure rolls back.
 */
export async function inTenantTransaction<T>(
  adapter: TenantTransactionAdapter,
  work: (transaction: TenantTransaction) => Promise<T>,
): Promise<T> {
  const context = currentTenantContext();
  const transaction = await adapter.begin({
    tenantId: context.tenantId,
    correlationId: context.correlationId,
    ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
  });

  if (transaction.tenantId !== context.tenantId) {
    await transaction.rollback();
    throw problem({
      code: "tenant_context_mismatch",
      detail: "The transaction was bound to a different tenant than the trusted context.",
    });
  }

  try {
    const result = await work(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

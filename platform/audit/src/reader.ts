import { problem } from "../../problem-model/src/index.ts";
import { currentTenantContext, type TenantId } from "../../tenant-context/src/index.ts";
import type { AuditEvent } from "./model.ts";
import type { AuditRecorder, AuditWriter } from "./recorder.ts";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export interface AuditQuery {
  readonly action?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly actorId?: string;
  readonly correlationId?: string;
  /** Inclusive lower and exclusive upper bound on `occurredAt`, ISO-8601. */
  readonly from?: string;
  readonly to?: string;
  /** Opaque cursor from a previous page. */
  readonly cursor?: number;
  readonly limit?: number;
}

export interface NormalizedAuditQuery extends AuditQuery {
  readonly limit: number;
}

export interface AuditPage {
  readonly events: readonly Readonly<AuditEvent>[];
  readonly nextCursor?: number;
}

/** Tenant-scoped, read-only. Adapters must filter on the supplied tenant. */
export interface AuditReadStore {
  query(tenantId: TenantId, query: Readonly<NormalizedAuditQuery>): Promise<AuditPage>;
}

export interface AuditReadUnitOfWork {
  readonly reads: AuditReadStore;
  readonly audit: AuditWriter;
}

export interface AuditReadPersistence {
  runInTransaction<T>(
    scope: { readonly correlationId: string; readonly causationId?: string },
    work: (unitOfWork: AuditReadUnitOfWork) => Promise<T>,
  ): Promise<T>;
}

function invalidQuery(detail: string, correlation_id: string): never {
  throw problem({ code: "invalid_trusted_context", detail, correlation_id });
}

function instant(value: string | undefined, name: string, correlation_id: string): void {
  if (value !== undefined && (typeof value !== "string" || Number.isNaN(Date.parse(value)))) {
    invalidQuery(`${name} must be a valid ISO-8601 instant.`, correlation_id);
  }
}

/**
 * Audit reads are permissioned and are themselves audited (an `audit.read` event in the same
 * transaction), so bulk reading of audit history cannot happen silently. The tenant is always the
 * trusted one; `authorize` (the caller's `audit:read` check) runs before anything is read.
 */
export function createAuditReader(dependencies: {
  readonly persistence: AuditReadPersistence;
  readonly recorder: AuditRecorder;
  readonly authorize: () => Promise<void>;
}) {
  return async function queryAudit(query: AuditQuery = {}): Promise<AuditPage> {
    const context = currentTenantContext();
    await dependencies.authorize();

    const correlation_id = context.correlationId;
    const limit = query.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) invalidQuery(`limit must be between 1 and ${MAX_LIMIT}.`, correlation_id);
    if (query.cursor !== undefined && (!Number.isInteger(query.cursor) || query.cursor < 0)) invalidQuery("cursor is invalid.", correlation_id);
    instant(query.from, "from", correlation_id);
    instant(query.to, "to", correlation_id);
    const normalized: NormalizedAuditQuery = { ...query, limit };

    return dependencies.persistence.runInTransaction(
      { correlationId: correlation_id, ...(context.causationId === undefined ? {} : { causationId: context.causationId }) },
      async (unitOfWork) => {
        const page = await unitOfWork.reads.query(context.tenantId, normalized);
        for (const event of page.events) {
          if (event.tenantId !== context.tenantId) {
            throw problem({ code: "tenant_context_mismatch", detail: "The audit store returned another tenant's event.", correlation_id });
          }
        }
        await dependencies.recorder.recordForCurrentContext(unitOfWork.audit, {
          action: "audit.read",
          target: { type: "AuditQuery", id: correlation_id },
          after: {
            ...(query.action === undefined ? {} : { action: query.action }),
            ...(query.targetType === undefined ? {} : { target_type: query.targetType }),
            ...(query.targetId === undefined ? {} : { target_id: query.targetId }),
            ...(query.actorId === undefined ? {} : { actor_id: query.actorId }),
            ...(query.correlationId === undefined ? {} : { correlation_id: query.correlationId }),
            result_count: page.events.length,
          },
        });
        return page;
      },
    );
  };
}

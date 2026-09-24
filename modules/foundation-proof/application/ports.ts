import type { AuditWriter } from "../../../platform/audit/src/index.ts";
import type { IdempotencyStore } from "../../../platform/idempotency/src/index.ts";
import type { OutboxWriter } from "../../../platform/outbox/src/index.ts";
import type { ActorId, TenantId } from "../../../platform/tenant-context/src/index.ts";

export const FOUNDATION_PROOF_PERMISSION = "foundation:proof:execute" as const;

export interface FoundationProofAuthorizer {
  assertPermission(permission: typeof FOUNDATION_PROOF_PERMISSION): Promise<void>;
}

export interface FoundationProofRecord {
  readonly tenantId: TenantId;
  readonly proofRecordId: string;
  readonly label: string;
  readonly actorId: ActorId;
  readonly correlationId: string;
  readonly recordedAt: string;
}

export interface FoundationProofRepository {
  insert(record: Readonly<FoundationProofRecord>): Promise<void>;
}

export interface FoundationProofUnitOfWork {
  readonly idempotency: IdempotencyStore;
  readonly records: FoundationProofRepository;
  readonly audit: AuditWriter;
  readonly outbox: OutboxWriter;
}

export interface FoundationProofPersistence {
  runInTransaction<T>(
    scope: { readonly tenantId: TenantId; readonly correlationId: string; readonly causationId?: string },
    work: (unitOfWork: FoundationProofUnitOfWork) => Promise<T>,
  ): Promise<T>;
}

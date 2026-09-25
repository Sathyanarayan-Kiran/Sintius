import type { AuditWriter } from "../../../platform/audit/src/index.ts";
import type { EventEnvelope } from "../../../platform/event-envelope/src/index.ts";
import type { TenantId } from "../../../platform/tenant-context/src/index.ts";
import type { ApprovalPolicy, ApprovalRequest } from "../domain/approval.ts";

/**
 * Structural port satisfied by the tenant authorizer composed at the application root, so this
 * module never imports Identity & Tenant internals. Rejects with `permission_denied`.
 */
export interface ApprovalAuthorizer {
  assertPermission(permission: string): Promise<void>;
  /** Live check used to credit a decision toward a policy's approver requirements (decision D4). */
  hasPermission(permission: string): Promise<boolean>;
}

/** Policies are tenant configuration owned by Identity & Tenant; this module only reads them. */
export interface ApprovalPolicyReader {
  findByActionType(tenantId: TenantId, actionType: string): Promise<Readonly<ApprovalPolicy> | undefined>;
}

export interface ApprovalRepository {
  insert(request: Readonly<ApprovalRequest>): Promise<void>;
  /** Must be tenant-scoped: another tenant's request is indistinguishable from a missing one. */
  findById(tenantId: TenantId, id: string): Promise<Readonly<ApprovalRequest> | undefined>;
  /** Compare-and-set: must reject with `approval_version_conflict` unless the stored version matches. */
  update(request: Readonly<ApprovalRequest>, expectedVersion: number): Promise<void>;
}

export interface ApprovalUnitOfWork {
  readonly policies: ApprovalPolicyReader;
  readonly approvals: ApprovalRepository;
  readonly audit: AuditWriter;
  readonly outbox: { append(envelope: Readonly<EventEnvelope>): Promise<void> };
}

export interface ApprovalPersistence {
  /** Every write in `work` commits together or none does. */
  runInTransaction<T>(
    scope: { readonly correlationId: string; readonly causationId?: string },
    work: (unitOfWork: ApprovalUnitOfWork) => Promise<T>,
  ): Promise<T>;
}

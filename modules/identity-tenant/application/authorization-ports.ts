import type { EventEnvelope } from "../../../platform/event-envelope/src/index.ts";
import type { ActorId, TenantId } from "../../../platform/tenant-context/src/index.ts";
import type { Permission, PermissionConstraint, RoleSnapshot } from "../domain/authorization.ts";

/**
 * Adapters must scope every lookup by the supplied tenant ID (which handlers take only from the
 * trusted context) so one tenant can never read another tenant's roles, assignments or constraints.
 */
export interface PermissionGrantStore {
  /** Roles currently assigned to the actor in this tenant; revoked assignments must not appear. */
  loadAssignedRoles(tenantId: TenantId, actorId: ActorId): Promise<readonly Readonly<RoleSnapshot>[]>;
}

/** Deterministic narrowing rules per tenant and permission; absence of rules means RBAC alone decides. */
export interface PermissionConstraintStore {
  constraintsFor(tenantId: TenantId, permission: Permission): Promise<readonly Readonly<PermissionConstraint>[]>;
}

export interface RoleCatalogRepository {
  findByCode(tenantId: TenantId, roleCode: string): Promise<Readonly<RoleSnapshot> | undefined>;
}

export interface RoleAssignmentRepository {
  /** Must reject with `role_assignment_exists` atomically when the pair already exists. */
  insert(tenantId: TenantId, actorId: ActorId, roleCode: string): Promise<void>;
  /** Must reject with `role_assignment_not_found` when the pair does not exist. */
  remove(tenantId: TenantId, actorId: ActorId, roleCode: string): Promise<void>;
}

export type SecurityAuditAction = "role.assigned" | "role.revoked";

/** Allow-listed, secret-free evidence; `details` holds identifiers and codes only. */
export interface SecurityAuditRecord {
  readonly action: SecurityAuditAction;
  readonly tenantId: TenantId;
  readonly actorId: ActorId;
  readonly targetType: string;
  readonly targetId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: string;
  readonly details: Readonly<Record<string, string | number>>;
}

export interface SecurityAuditWriter {
  append(record: Readonly<SecurityAuditRecord>): Promise<void>;
}

export interface SecurityOutboxWriter {
  append(envelope: Readonly<EventEnvelope>): Promise<void>;
}

export interface RoleAdministrationUnitOfWork {
  readonly roles: RoleCatalogRepository;
  readonly assignments: RoleAssignmentRepository;
  readonly audit: SecurityAuditWriter;
  readonly outbox: SecurityOutboxWriter;
}

export interface SecurityTransactionScope {
  readonly correlationId: string;
  readonly causationId?: string;
}

/** Every write in `work` commits together or none does. */
export interface SecurityPersistence {
  runInTransaction<T>(scope: SecurityTransactionScope, work: (unitOfWork: RoleAdministrationUnitOfWork) => Promise<T>): Promise<T>;
}


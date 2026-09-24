import type { AuditWriter } from "../../../platform/audit/src/index.ts";
import type { EventEnvelope } from "../../../platform/event-envelope/src/index.ts";
import type { ActorId, PlatformCommandContext, TenantId } from "../../../platform/tenant-context/src/index.ts";
import type { TenantSnapshot } from "../domain/tenant.ts";

/**
 * Ports owned by the identity-tenant module. Adapters live in infrastructure and are composed at
 * the application root; this module never imports another module's tables or internals.
 */

export type TenantPlatformPermission = "tenant:provision" | "tenant:manage_lifecycle";

/** Deny-by-default authorization for platform-scoped commands; the real RBAC adapter arrives with P0-005. */
export interface PlatformAuthorizer {
  /** Resolves when allowed; otherwise rejects with a `platform_access_denied` problem. */
  assertAllowed(context: Readonly<PlatformCommandContext>, permission: TenantPlatformPermission): Promise<void>;
}

export interface TenantRepository {
  /** Must reject with `tenant_already_exists` when the ID is taken; uniqueness is enforced by the store so races are safe. */
  insert(tenant: Readonly<TenantSnapshot>): Promise<void>;
  findById(id: TenantId): Promise<Readonly<TenantSnapshot> | undefined>;
  /** Compare-and-set: must reject with `tenant_version_conflict` unless the stored version equals `expectedVersion`. */
  update(tenant: Readonly<TenantSnapshot>, expectedVersion: number): Promise<void>;
}

export type DefaultRoleCode = "tenant_administrator";

/** Permission bindings for the default role are defined by the RBAC catalog (P0-005), not here. */
export interface DefaultRoleRecord {
  readonly tenantId: TenantId;
  readonly roleCode: DefaultRoleCode;
}

export interface InitialAdministratorRecord {
  readonly tenantId: TenantId;
  readonly actorId: ActorId;
  readonly roleCode: DefaultRoleCode;
}

export interface TenantRoleRepository {
  insertDefaultAdministratorRole(record: Readonly<DefaultRoleRecord>): Promise<void>;
}

export interface TenantMembershipRepository {
  insertInitialAdministrator(record: Readonly<InitialAdministratorRecord>): Promise<void>;
}

export interface TenantOutboxWriter {
  append(envelope: Readonly<EventEnvelope>): Promise<void>;
}

/** Repositories bound to one database transaction. */
export interface TenantUnitOfWork {
  readonly tenants: TenantRepository;
  readonly roles: TenantRoleRepository;
  readonly memberships: TenantMembershipRepository;
  readonly audit: AuditWriter;
  readonly outbox: TenantOutboxWriter;
}

export interface TenantTransactionScope {
  readonly correlationId: string;
  readonly causationId?: string;
}

/**
 * Runs `work` in one transaction: every write commits together or none does. Transaction
 * management stays in this port so the domain aggregate remains pure.
 */
export interface TenantPersistence {
  runInTransaction<T>(scope: TenantTransactionScope, work: (unitOfWork: TenantUnitOfWork) => Promise<T>): Promise<T>;
}

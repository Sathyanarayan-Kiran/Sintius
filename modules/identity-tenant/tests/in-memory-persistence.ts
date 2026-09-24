import type { AuditEvent } from "../../../platform/audit/src/index.ts";
import type { EventEnvelope } from "../../../platform/event-envelope/src/index.ts";
import { problem } from "../../../platform/problem-model/src/index.ts";
import type {
  DefaultRoleRecord,
  InitialAdministratorRecord,
  PlatformAuthorizer,
  TenantPersistence,
  TenantPlatformPermission,
  TenantUnitOfWork,
} from "../application/ports.ts";
import type { TenantSnapshot } from "../domain/tenant.ts";

/**
 * TEST DOUBLE ONLY. It applies staged writes on success and discards them on failure, which lets
 * unit tests check the handler's write set and ordering. It is NOT evidence of PostgreSQL
 * atomicity; that needs a real adapter and an integration test (TC-002-01-03).
 */
interface Store {
  tenants: Map<string, TenantSnapshot>;
  roles: DefaultRoleRecord[];
  memberships: InitialAdministratorRecord[];
  audit: AuditEvent[];
  outbox: EventEnvelope[];
}

export type FailurePoint = "role" | "membership" | "audit" | "outbox";

export class InMemoryTenantPersistence implements TenantPersistence {
  committed: Store = { tenants: new Map(), roles: [], memberships: [], audit: [], outbox: [] };
  transactionsStarted = 0;
  failAt: FailurePoint | undefined;

  async runInTransaction<T>(_scope: unknown, work: (unitOfWork: TenantUnitOfWork) => Promise<T>): Promise<T> {
    this.transactionsStarted += 1;
    const staged: Store = {
      tenants: new Map(this.committed.tenants),
      roles: [...this.committed.roles],
      memberships: [...this.committed.memberships],
      audit: [...this.committed.audit],
      outbox: [...this.committed.outbox],
    };
    let open = true;
    const guard = () => {
      if (!open) throw new Error("Unit of work used outside its transaction.");
    };
    const failIf = (point: FailurePoint) => {
      if (this.failAt === point) throw new Error(`injected ${point} failure`);
    };
    const unitOfWork: TenantUnitOfWork = {
      idempotency: {
        claim: async () => {
          throw new Error("The tenant command unit tests do not exercise idempotency directly.");
        },
        complete: async () => {
          throw new Error("The tenant command unit tests do not exercise idempotency directly.");
        },
      },
      tenants: {
        insert: async (tenant) => {
          guard();
          if (staged.tenants.has(tenant.id)) throw problem({ code: "tenant_already_exists", detail: "The tenant already exists." });
          staged.tenants.set(tenant.id, tenant);
        },
        findById: async (id) => {
          guard();
          return staged.tenants.get(id);
        },
        update: async (tenant, expectedVersion) => {
          guard();
          const stored = staged.tenants.get(tenant.id);
          if (stored === undefined || stored.version !== expectedVersion) {
            throw problem({ code: "tenant_version_conflict", detail: "The tenant changed concurrently." });
          }
          staged.tenants.set(tenant.id, tenant);
        },
      },
      roles: {
        insertDefaultAdministratorRole: async (record) => {
          guard();
          failIf("role");
          staged.roles.push(record);
        },
      },
      memberships: {
        insertInitialAdministrator: async (record) => {
          guard();
          failIf("membership");
          staged.memberships.push(record);
        },
      },
      audit: {
        append: async (record) => {
          guard();
          failIf("audit");
          staged.audit.push(record);
        },
      },
      outbox: {
        append: async (envelope) => {
          guard();
          failIf("outbox");
          staged.outbox.push(envelope);
        },
      },
    };
    try {
      const result = await work(unitOfWork);
      this.committed = staged;
      return result;
    } finally {
      open = false;
    }
  }
}

export class AllowListAuthorizer implements PlatformAuthorizer {
  calls: TenantPlatformPermission[] = [];
  readonly #allowed: ReadonlySet<TenantPlatformPermission>;

  constructor(allowed: readonly TenantPlatformPermission[]) {
    this.#allowed = new Set(allowed);
  }

  async assertAllowed(_context: unknown, permission: TenantPlatformPermission): Promise<void> {
    this.calls.push(permission);
    if (!this.#allowed.has(permission)) {
      throw problem({ code: "platform_access_denied", detail: "The platform action is not permitted." });
    }
  }
}

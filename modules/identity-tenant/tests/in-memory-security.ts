import type { AuditEvent } from "../../../platform/audit/src/index.ts";
import type { EventEnvelope } from "../../../platform/event-envelope/src/index.ts";
import { problem } from "../../../platform/problem-model/src/index.ts";
import type { ActorId, TenantId } from "../../../platform/tenant-context/src/index.ts";
import type {
  PermissionConstraintStore,
  PermissionGrantStore,
  RoleAdministrationUnitOfWork,
  SecurityPersistence,
} from "../application/authorization-ports.ts";
import type { PermissionConstraint, RoleSnapshot } from "../domain/authorization.ts";

/**
 * TEST DOUBLE ONLY: tenant-keyed maps with stage-then-commit semantics. It exercises handler
 * logic and tenant scoping in unit tests; it is not evidence of PostgreSQL atomicity or RLS.
 */
interface Store {
  roles: Map<string, RoleSnapshot>;
  assignments: Set<string>;
  audit: AuditEvent[];
  outbox: EventEnvelope[];
}

const key = (...parts: string[]) => parts.map(encodeURIComponent).join("|");

export class InMemorySecurityStore implements PermissionGrantStore, PermissionConstraintStore, SecurityPersistence {
  constraints: PermissionConstraint[] = [];
  constraintStoreFails = false;
  committed: Store = { roles: new Map(), assignments: new Set(), audit: [], outbox: [] };
  transactionsStarted = 0;
  failAuditOnce = false;

  seedRole(tenant: TenantId, role: RoleSnapshot): void {
    this.committed.roles.set(key(tenant, role.roleCode), role);
  }

  seedAssignment(tenant: TenantId, actor: ActorId, roleCode: string): void {
    this.committed.assignments.add(key(tenant, actor, roleCode));
  }

  async constraintsFor(_tenant: TenantId, permission: string): Promise<readonly PermissionConstraint[]> {
    if (this.constraintStoreFails) throw new Error("constraint store unavailable");
    return this.constraints.filter((constraint) => constraint.permission === permission);
  }

  async loadAssignedRoles(tenant: TenantId, actor: ActorId): Promise<readonly RoleSnapshot[]> {
    const roles: RoleSnapshot[] = [];
    for (const [roleKey, role] of this.committed.roles) {
      if (this.committed.assignments.has(key(tenant, actor, role.roleCode)) && roleKey === key(tenant, role.roleCode)) roles.push(role);
    }
    return roles;
  }

  async runInTransaction<T>(_scope: unknown, work: (unitOfWork: RoleAdministrationUnitOfWork) => Promise<T>): Promise<T> {
    this.transactionsStarted += 1;
    const staged: Store = {
      roles: new Map(this.committed.roles),
      assignments: new Set(this.committed.assignments),
      audit: [...this.committed.audit],
      outbox: [...this.committed.outbox],
    };
    const unitOfWork: RoleAdministrationUnitOfWork = {
      roles: { findByCode: async (tenant, code) => staged.roles.get(key(tenant, code)) },
      assignments: {
        insert: async (tenant, actor, code) => {
          const k = key(tenant, actor, code);
          if (staged.assignments.has(k)) throw problem({ code: "role_assignment_exists", detail: "Already assigned." });
          staged.assignments.add(k);
        },
        remove: async (tenant, actor, code) => {
          if (!staged.assignments.delete(key(tenant, actor, code))) throw problem({ code: "role_assignment_not_found", detail: "Not assigned." });
        },
        countActiveHolders: async (tenant, code) =>
          [...staged.assignments].filter((entry) => {
            const [entryTenant, , entryRole] = entry.split("|").map(decodeURIComponent);
            return entryTenant === tenant && entryRole === code;
          }).length,
      },
      audit: {
        append: async (record) => {
          if (this.failAuditOnce) {
            this.failAuditOnce = false;
            throw new Error("injected audit failure");
          }
          staged.audit.push(record);
        },
      },
      outbox: {
        append: async (envelope) => {
          staged.outbox.push(envelope);
        },
      },
    };
    const result = await work(unitOfWork);
    this.committed = staged;
    return result;
  }
}

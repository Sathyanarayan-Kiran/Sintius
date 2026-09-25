import type { AuditRecorder } from "../../../platform/audit/src/index.ts";
import { buildEventEnvelope } from "../../../platform/event-envelope/src/index.ts";
import { problem } from "../../../platform/problem-model/src/index.ts";
import { actorId, currentTenantContext } from "../../../platform/tenant-context/src/index.ts";
import { assertKnownPermission, constraintsSatisfied, effectivePermissions, type ConstraintValue } from "../domain/authorization.ts";
import type { PermissionConstraintStore, PermissionGrantStore, SecurityPersistence } from "./authorization-ports.ts";
import type { DefaultRoleCode } from "./ports.ts";

/**
 * Tenant-scoped, deny-by-default permission checks. Tenant and actor come only from the trusted
 * context. Interactive principals need a permission through an active role assignment, evaluated
 * on every call so a revoked role stops working on the next command. Workload principals hold no
 * roles: they need the permission as an explicit operation scope on their credential.
 */
export function createTenantAuthorizer(dependencies: { readonly grants: PermissionGrantStore; readonly constraints?: PermissionConstraintStore }) {
  async function hasPermission(permission: string, resourceAttributes: Readonly<Record<string, ConstraintValue>> = {}): Promise<boolean> {
    assertKnownPermission(permission);
    const context = currentTenantContext();
    let granted: boolean;
    if (context.principalKind === "workload") {
      granted = context.scopes.includes(permission);
    } else {
      const roles = await dependencies.grants.loadAssignedRoles(context.tenantId, context.actorId);
      granted = effectivePermissions(roles).has(permission);
    }
    if (!granted || dependencies.constraints === undefined) return granted;
    try {
      // ABAC only narrows an existing grant; any evaluation failure denies.
      const constraints = await dependencies.constraints.constraintsFor(context.tenantId, permission);
      return constraintsSatisfied(constraints, resourceAttributes);
    } catch {
      return false;
    }
  }

  async function assertPermission(permission: string, resourceAttributes?: Readonly<Record<string, ConstraintValue>>): Promise<void> {
    if (!(await hasPermission(permission, resourceAttributes))) {
      // Generic on purpose: never reveal which permission, role or resource exists.
      throw problem({
        code: "permission_denied",
        detail: "You do not have permission to perform this action.",
        correlation_id: currentTenantContext().correlationId,
      });
    }
  }

  return Object.freeze({ hasPermission, assertPermission });
}

/** The default administrator role created with every tenant. */
const ADMINISTRATOR_ROLE: DefaultRoleCode = "tenant_administrator";

/** Evidence fields allowed in role-assignment audit snapshots. */
export const ROLE_AUDIT_FIELDS = Object.freeze({ RoleAssignment: Object.freeze(["role_code"]) });

export type TenantAuthorizer = ReturnType<typeof createTenantAuthorizer>;

export interface RoleAssignmentInput {
  readonly targetActorId: string;
  readonly roleCode: string;
}

/**
 * Role assignment and revocation. Requires `tenant:role:assign`, and an actor may not change their
 * own roles (no self-escalation and no self-lockout of the last administrator).
 */
export function createRoleAdministration(dependencies: {
  readonly persistence: SecurityPersistence;
  readonly authorizer: TenantAuthorizer;
  readonly audit: AuditRecorder;
  readonly clock: () => Date;
  readonly newEventId?: () => string;
}) {
  async function change(input: RoleAssignmentInput, kind: "assigned" | "revoked"): Promise<void> {
    await dependencies.authorizer.assertPermission("tenant:role:assign");
    const context = currentTenantContext();
    const target = actorId(input.targetActorId);
    if (target === context.actorId) {
      throw problem({
        code: "separation_of_duties_violation",
        detail: "You cannot change your own role assignments.",
        correlation_id: context.correlationId,
      });
    }
    const now = dependencies.clock();

    await dependencies.persistence.runInTransaction(
      { correlationId: context.correlationId, ...(context.causationId === undefined ? {} : { causationId: context.causationId }) },
      async (unitOfWork) => {
        const role = await unitOfWork.roles.findByCode(context.tenantId, input.roleCode);
        if (role === undefined || role.status !== "active") {
          throw problem({ code: "role_not_found", detail: "The role does not exist.", correlation_id: context.correlationId });
        }
        if (kind === "assigned") {
          await unitOfWork.assignments.insert(context.tenantId, target, input.roleCode);
        } else {
          // Decision D3: nobody may remove the tenant's last administrator, or the tenant is locked out.
          if (input.roleCode === ADMINISTRATOR_ROLE && (await unitOfWork.assignments.countActiveHolders(context.tenantId, input.roleCode)) <= 1) {
            throw problem({
              code: "last_administrator_protected",
              detail: "The tenant's last administrator cannot be removed. Assign another administrator first.",
              correlation_id: context.correlationId,
            });
          }
          await unitOfWork.assignments.remove(context.tenantId, target, input.roleCode);
        }

        await dependencies.audit.recordForCurrentContext(unitOfWork.audit, {
          action: kind === "assigned" ? "role.assigned" : "role.revoked",
          target: { type: "RoleAssignment", id: target },
          occurredAt: now,
          after: { role_code: input.roleCode },
        });
        await unitOfWork.outbox.append(
          buildEventEnvelope(
            {
              eventType: `role.${kind}.v1`,
              sourceContext: "identity-tenant",
              aggregateType: "RoleAssignment",
              aggregateId: `${target}:${input.roleCode}`,
              aggregateVersion: 1,
              occurredAt: now,
              classification: "CONFIDENTIAL_BUSINESS",
              data: { subject_actor_id: target, role_code: input.roleCode },
            },
            { clock: () => now, ...(dependencies.newEventId === undefined ? {} : { newEventId: dependencies.newEventId }) },
          ),
        );
      },
    );
  }

  return Object.freeze({
    assignRole: (input: RoleAssignmentInput) => change(input, "assigned"),
    revokeRole: (input: RoleAssignmentInput) => change(input, "revoked"),
  });
}

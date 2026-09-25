import { problem } from "../../../platform/problem-model/src/index.ts";

/**
 * Platform-defined permission catalog. Tenants compose roles from these permissions; they cannot
 * invent new ones. Entries mirror docs/pre-implementation/13-api-specification.md section 4.
 */
export const PERMISSION_CATALOG = Object.freeze([
  "tenant:role:manage",
  "tenant:role:assign",
  "approval:request:propose",
  "approval:request:decide",
  "billing:invoice:preview",
  "billing:invoice:finalize",
  "pricing:rate_card:activate",
  "payments:payment:refund",
  "subscription:change:backdate",
  "collections:case:approve_exception",
  "portal:subscription:change",
  "audit:read",
  "outbox:dead_letter:resolve",
  "foundation:proof:execute",
] as const);

export type Permission = (typeof PERMISSION_CATALOG)[number];

const KNOWN: ReadonlySet<string> = new Set(PERMISSION_CATALOG);

export function isKnownPermission(value: string): value is Permission {
  return KNOWN.has(value);
}

/** Least-privilege default for a new tenant: manage roles and assignments only. */
export const DEFAULT_TENANT_ADMINISTRATOR_PERMISSIONS: readonly Permission[] = Object.freeze([
  "tenant:role:manage",
  "tenant:role:assign",
]);

export type RoleStatus = "active" | "retired";

export interface RoleSnapshot {
  readonly roleCode: string;
  readonly permissions: readonly Permission[];
  readonly status: RoleStatus;
  /**
   * Limits on this role's own grants (D9), for example a Billing Administrator who may refund only
   * up to a threshold. A limit narrows only the role it belongs to; another role holding the same
   * permission without a limit is unaffected.
   */
  readonly limits?: readonly Readonly<PermissionConstraint>[];
}

/** Deny by default: only permissions granted by an active role count; unknown names never match. */
export function effectivePermissions(roles: readonly Readonly<RoleSnapshot>[]): ReadonlySet<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    if (role.status !== "active") continue;
    for (const permission of role.permissions) {
      if (isKnownPermission(permission)) granted.add(permission);
    }
  }
  return granted;
}

export function assertKnownPermission(permission: string): asserts permission is Permission {
  if (!isKnownPermission(permission)) {
    throw problem({ code: "unknown_permission", detail: "The requested permission is not in the platform catalog." });
  }
}

export type ConstraintOperator = "eq" | "lt" | "lte" | "gt" | "gte" | "in";
export type ConstraintValue = string | number;

/** Narrows an RBAC grant, for example "refund only when amount_minor <= 50000". It can never widen access. */
export interface PermissionConstraint {
  readonly permission: Permission;
  readonly attribute: string;
  readonly operator: ConstraintOperator;
  readonly value: ConstraintValue | readonly ConstraintValue[];
}

/**
 * Deterministic and fail closed: every constraint must hold; a missing attribute, a type mismatch
 * or an unknown operator counts as not satisfied.
 */
export function constraintsSatisfied(
  constraints: readonly Readonly<PermissionConstraint>[],
  attributes: Readonly<Record<string, ConstraintValue>>,
): boolean {
  return constraints.every((constraint) => {
    if (!Object.hasOwn(attributes, constraint.attribute)) return false;
    const actual = attributes[constraint.attribute];
    const expected = constraint.value;
    switch (constraint.operator) {
      case "eq":
        return !Array.isArray(expected) && actual === expected;
      case "in":
        return Array.isArray(expected) && expected.includes(actual as ConstraintValue);
      case "lt":
      case "lte":
      case "gt":
      case "gte": {
        if (typeof actual !== "number" || typeof expected !== "number" || !Number.isFinite(actual) || !Number.isFinite(expected)) return false;
        if (constraint.operator === "lt") return actual < expected;
        if (constraint.operator === "lte") return actual <= expected;
        if (constraint.operator === "gt") return actual > expected;
        return actual >= expected;
      }
      default:
        return false;
    }
  });
}

/**
 * True when some active role grants the permission for these resource attributes: the role holds
 * the permission and every limit it attaches to that permission is satisfied (fail closed).
 */
export function grantedByRoles(
  roles: readonly Readonly<RoleSnapshot>[],
  permission: Permission,
  attributes: Readonly<Record<string, ConstraintValue>>,
): boolean {
  return roles.some(
    (role) =>
      role.status === "active" &&
      role.permissions.includes(permission) &&
      constraintsSatisfied((role.limits ?? []).filter((limit) => limit.permission === permission), attributes),
  );
}

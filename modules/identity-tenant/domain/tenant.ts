import { problem } from "../../../platform/problem-model/src/index.ts";
import type { TenantId } from "../../../platform/tenant-context/src/index.ts";

export type TenantState = "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "CLOSED";
export type TenantEventType =
  | "tenant.provisioned.v1"
  | "tenant.activated.v1"
  | "tenant.suspended.v1"
  | "tenant.closed.v1";

export interface TenantSnapshot {
  readonly id: TenantId;
  readonly displayName: string;
  readonly state: TenantState;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TenantDomainEvent {
  readonly type: TenantEventType;
  readonly tenantId: TenantId;
  readonly aggregateVersion: number;
  readonly occurredAt: string;
}

export interface TenantChange {
  readonly tenant: Readonly<TenantSnapshot>;
  readonly event: Readonly<TenantDomainEvent>;
}

const transitions: Readonly<Record<TenantState, readonly TenantState[]>> = Object.freeze({
  PROVISIONING: Object.freeze(["ACTIVE"]),
  ACTIVE: Object.freeze(["SUSPENDED", "CLOSED"]),
  SUSPENDED: Object.freeze(["ACTIVE", "CLOSED"]),
  CLOSED: Object.freeze([]),
});

const transitionEvents: Readonly<Record<Exclude<TenantState, "PROVISIONING">, TenantEventType>> = Object.freeze({
  ACTIVE: "tenant.activated.v1",
  SUSPENDED: "tenant.suspended.v1",
  CLOSED: "tenant.closed.v1",
});

function isoInstant(value: Date): string {
  if (Number.isNaN(value.valueOf())) {
    throw problem({ title: "Invalid timestamp", status: 422, code: "invalid_timestamp", detail: "Tenant lifecycle commands require a valid instant." });
  }
  return value.toISOString();
}

export function provisionTenant(id: TenantId, displayName: string, now: Date): TenantChange {
  const normalizedName = displayName.trim();
  if (normalizedName.length === 0) {
    throw problem({ title: "Invalid tenant", status: 422, code: "tenant_display_name_required", detail: "Tenant display name must not be blank." });
  }
  const occurredAt = isoInstant(now);
  const tenant = Object.freeze({
    id,
    displayName: normalizedName,
    state: "PROVISIONING" as const,
    version: 1,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
  return Object.freeze({
    tenant,
    event: Object.freeze({ type: "tenant.provisioned.v1", tenantId: id, aggregateVersion: 1, occurredAt }),
  });
}

export function transitionTenant(
  current: Readonly<TenantSnapshot>,
  target: Exclude<TenantState, "PROVISIONING">,
  expectedVersion: number,
  now: Date,
): TenantChange {
  if (current.version !== expectedVersion) {
    throw problem({ title: "Tenant version conflict", status: 409, code: "tenant_version_conflict", detail: "The tenant changed after this command was prepared." });
  }
  if (!transitions[current.state].includes(target)) {
    throw problem({ title: "Invalid tenant transition", status: 409, code: "invalid_tenant_transition", detail: `Tenant cannot transition from ${current.state} to ${target}.` });
  }
  const occurredAt = isoInstant(now);
  const nextVersion = current.version + 1;
  const tenant = Object.freeze({ ...current, state: target, version: nextVersion, updatedAt: occurredAt });
  return Object.freeze({
    tenant,
    event: Object.freeze({ type: transitionEvents[target], tenantId: current.id, aggregateVersion: nextVersion, occurredAt }),
  });
}

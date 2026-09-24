import { randomUUID } from "node:crypto";
import { problem } from "../../problem-model/src/index.ts";
import {
  assertIssuedPlatformContext,
  containsTenantIdentity,
  currentTenantContext,
  type PlatformCommandContext,
  type TenantContext,
  type TenantId,
} from "../../tenant-context/src/index.ts";

export type EventDataClassification = "RESTRICTED_FINANCIAL" | "CONFIDENTIAL_BUSINESS" | "INTERNAL_OPERATIONAL" | "PUBLIC";
export type EventActorType = "USER" | "SERVICE" | "SYSTEM";

export const EVENT_DATA_CLASSIFICATIONS: readonly EventDataClassification[] = Object.freeze([
  "RESTRICTED_FINANCIAL",
  "CONFIDENTIAL_BUSINESS",
  "INTERNAL_OPERATIONAL",
  "PUBLIC",
]);

/** CloudEvents-style envelope; mirrors docs/pre-implementation/contracts/events/envelope.schema.json. */
export interface EventEnvelope {
  readonly id: string;
  readonly source: string;
  readonly specversion: "1.0";
  readonly type: string;
  readonly time: string;
  readonly datacontenttype: "application/json";
  readonly dataschema?: string;
  readonly subject?: string;
  readonly tenant_id: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly aggregate_version: number;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly actor: { readonly type: EventActorType; readonly id: string; readonly delegated_by: string | null };
  readonly occurred_at: string;
  readonly recorded_at: string;
  readonly data_classification: EventDataClassification;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Deliberately contains no tenant, actor, correlation or causation field: those come only from the
 * active trusted context, so producer code cannot stamp an event with another tenant's identity.
 */
export interface BuildEventInput {
  /** Module fact name such as `tenant.provisioned.v1`; published as `com.subrevos.<name>`. */
  readonly eventType: string;
  /** Owning bounded context, used to form the `source` URN. */
  readonly sourceContext: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly occurredAt: Date;
  readonly classification: EventDataClassification;
  readonly data: Readonly<Record<string, unknown>>;
  readonly dataschema?: string;
  readonly subject?: string;
}

export interface EventBuildDependencies {
  readonly newEventId?: () => string;
  readonly clock?: () => Date;
}

/** The trusted identity an event is stamped with; producer input can never supply these fields. */
export interface EventScope {
  readonly tenantId: TenantId;
  readonly actorId: string;
  readonly principalKind: TenantContext["principalKind"];
  readonly correlationId: string;
  readonly causationId?: string;
}

export function eventScopeFromCurrentContext(): EventScope {
  const context = currentTenantContext();
  return {
    tenantId: context.tenantId,
    actorId: context.actorId,
    principalKind: context.principalKind,
    correlationId: context.correlationId,
    ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
  };
}

/** For platform commands acting on a named tenant (for example provisioning); requires an issued platform context. */
export function eventScopeForPlatformCommand(context: Readonly<PlatformCommandContext>, targetTenantId: TenantId): EventScope {
  assertIssuedPlatformContext(context);
  return {
    tenantId: targetTenantId,
    actorId: context.actorId,
    principalKind: context.principalKind,
    correlationId: context.correlationId,
    ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
  };
}

const EVENT_TYPE_PATTERN = /^[a-z_]+\.[a-z_]+\.v[0-9]+$/;
const SOURCE_CONTEXT_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/** Working default pending SPIKE-03 (ULID versus UUIDv7); the schema documents ULID as the target. */
function defaultEventId(): string {
  return `evt_${randomUUID()}`;
}

function invalid(detail: string): never {
  throw problem({ code: "invalid_trusted_context", detail });
}

function requireNonBlank(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) invalid(`${field} must not be blank.`);
  return value;
}

function assertJsonCompatible(value: unknown, path: string, depth = 0): void {
  if (depth > 16) invalid(`Event data at ${path} is nested too deeply.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(`Event data at ${path} must be a finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonCompatible(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid(`Event data at ${path} must be a plain object.`);
    for (const [key, child] of Object.entries(value)) assertJsonCompatible(child, `${path}.${key}`, depth + 1);
    return;
  }
  invalid(`Event data at ${path} is not JSON compatible.`);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Builds an immutable event envelope for the active tenant. Fails closed without a trusted
 * context, and rejects payloads that restate tenant identity (a second, spoofable source of truth).
 */
export function buildEventEnvelope(input: BuildEventInput, dependencies: EventBuildDependencies = {}): Readonly<EventEnvelope> {
  return buildEventEnvelopeFor(eventScopeFromCurrentContext(), input, dependencies);
}

/** Same guarantees as `buildEventEnvelope`, for an explicitly derived trusted scope. */
export function buildEventEnvelopeFor(
  context: EventScope,
  input: BuildEventInput,
  dependencies: EventBuildDependencies = {},
): Readonly<EventEnvelope> {
  const clock = dependencies.clock ?? (() => new Date());
  const newEventId = dependencies.newEventId ?? defaultEventId;

  if (!EVENT_TYPE_PATTERN.test(input.eventType)) invalid("Event type must match <context>.<fact>.v<N>.");
  if (!SOURCE_CONTEXT_PATTERN.test(input.sourceContext)) invalid("Source context must be a lowercase bounded-context name.");
  if (!EVENT_DATA_CLASSIFICATIONS.includes(input.classification)) invalid("Event data classification is not recognized.");
  if (!Number.isInteger(input.aggregateVersion) || input.aggregateVersion < 1) invalid("Aggregate version must be an integer of at least 1.");
  requireNonBlank(input.aggregateType, "aggregateType");
  requireNonBlank(input.aggregateId, "aggregateId");

  if (typeof input.data !== "object" || input.data === null || Array.isArray(input.data)) invalid("Event data must be an object.");
  assertJsonCompatible(input.data, "data");
  if (containsTenantIdentity(input.data)) {
    throw problem({
      code: "tenant_context_mismatch",
      detail: "Event data must not restate tenant identity; the envelope carries the trusted tenant.",
      correlation_id: context.correlationId,
    });
  }

  const recorded = clock();
  if (Number.isNaN(input.occurredAt.valueOf()) || Number.isNaN(recorded.valueOf())) {
    throw problem({ code: "invalid_timestamp", detail: "Event timestamps must be valid instants." });
  }
  if (input.occurredAt.valueOf() > recorded.valueOf()) {
    throw problem({ code: "invalid_timestamp", detail: "An event cannot occur after it is recorded." });
  }
  const recordedAt = recorded.toISOString();

  const envelope: EventEnvelope = {
    id: requireNonBlank(newEventId(), "event id"),
    source: `urn:sub-rev-os:tenant:${encodeURIComponent(context.tenantId)}:context:${input.sourceContext}`,
    specversion: "1.0",
    type: `com.subrevos.${input.eventType}`,
    time: recordedAt,
    datacontenttype: "application/json",
    ...(input.dataschema === undefined ? {} : { dataschema: input.dataschema }),
    ...(input.subject === undefined ? {} : { subject: input.subject }),
    tenant_id: context.tenantId,
    aggregate_type: input.aggregateType,
    aggregate_id: input.aggregateId,
    aggregate_version: input.aggregateVersion,
    correlation_id: context.correlationId,
    causation_id: context.causationId ?? null,
    actor: { type: context.principalKind === "workload" ? "SERVICE" : "USER", id: context.actorId, delegated_by: null },
    occurred_at: input.occurredAt.toISOString(),
    recorded_at: recordedAt,
    data_classification: input.classification,
    data: structuredClone(input.data),
  };
  return deepFreeze(envelope);
}

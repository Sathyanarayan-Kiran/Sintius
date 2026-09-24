import type { AuditRecorder } from "../../../platform/audit/src/index.ts";
import { buildEventEnvelopeFor, eventScopeForPlatformCommand, type BuildEventInput } from "../../../platform/event-envelope/src/index.ts";
import { createPlatformIdempotentExecutor, type StoredResponse } from "../../../platform/idempotency/src/index.ts";
import { problem } from "../../../platform/problem-model/src/index.ts";
import {
  actorId,
  assertIssuedPlatformContext,
  tenantId,
  type PlatformCommandContext,
} from "../../../platform/tenant-context/src/index.ts";
import { provisionTenant, transitionTenant, type TenantChange, type TenantSnapshot } from "../domain/tenant.ts";
import type {
  PlatformAuthorizer,
  TenantPersistence,
  TenantPlatformPermission,
} from "./ports.ts";

export interface TenantCommandDependencies {
  readonly persistence: TenantPersistence;
  readonly authorizer: PlatformAuthorizer;
  readonly audit: AuditRecorder;
  readonly clock: () => Date;
  readonly newEventId?: () => string;
}

export interface ProvisionTenantInput {
  readonly tenantId: string;
  readonly displayName: string;
  readonly initialAdministratorActorId: string;
}

export interface TenantLifecycleInput {
  readonly tenantId: string;
  readonly expectedVersion: number;
  /** Required for suspension and closure; recorded in the audit trail only. */
  readonly reason?: string;
}

export interface TenantCommandMetadata {
  /** Supplied by the transport's Idempotency-Key header; kept outside domain command bodies. */
  readonly idempotencyKey?: string;
}

type LifecycleTarget = "ACTIVE" | "SUSPENDED" | "CLOSED";

const REASON_REQUIRED: ReadonlySet<LifecycleTarget> = new Set(["SUSPENDED", "CLOSED"]);

function auditActionFor(change: TenantChange): string {
  return change.event.type.replace(/\.v[0-9]+$/, "");
}

/** Evidence fields allowed in tenant audit snapshots; composed into the platform audit policy at the app root. */
export const TENANT_AUDIT_FIELDS = Object.freeze({ Tenant: Object.freeze(["state", "version", "display_name"]) });

function eventInputFor(change: TenantChange, data: Record<string, unknown>): BuildEventInput {
  return {
    eventType: change.event.type,
    sourceContext: "identity-tenant",
    aggregateType: "Tenant",
    aggregateId: change.tenant.id,
    aggregateVersion: change.event.aggregateVersion,
    occurredAt: new Date(change.event.occurredAt),
    classification: "CONFIDENTIAL_BUSINESS",
    // Never restate tenant identity here: the envelope carries it from the trusted scope.
    data,
  };
}

function storedTenant(tenant: Readonly<TenantSnapshot>, status: number): StoredResponse {
  return {
    status,
    body: {
      id: tenant.id,
      display_name: tenant.displayName,
      state: tenant.state,
      version: tenant.version,
      created_at: tenant.createdAt,
      updated_at: tenant.updatedAt,
    },
  };
}

function tenantFromStored(response: StoredResponse, expectedTenantId: string, correlationId: string): Readonly<TenantSnapshot> {
  const body = response.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw problem({ code: "invalid_trusted_context", detail: "Stored tenant response is invalid.", correlation_id: correlationId });
  }
  const value = body as Record<string, unknown>;
  const state = value.state;
  if (
    typeof value.id !== "string" ||
    value.id !== expectedTenantId ||
    typeof value.display_name !== "string" ||
    (state !== "PROVISIONING" && state !== "ACTIVE" && state !== "SUSPENDED" && state !== "CLOSED") ||
    typeof value.version !== "number" ||
    !Number.isInteger(value.version) ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    throw problem({ code: "invalid_trusted_context", detail: "Stored tenant response is invalid.", correlation_id: correlationId });
  }
  return Object.freeze({
    id: tenantId(value.id),
    displayName: value.display_name,
    state,
    version: value.version,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  });
}

/**
 * Application handlers for platform-scoped tenant commands. Each command validates trusted input,
 * authorizes before any replay lookup and performs the idempotency claim, tenant change, audit fact,
 * outbox event and stored response through one unit of work so they succeed or fail together.
 */
export function createTenantCommands(dependencies: TenantCommandDependencies) {
  const { persistence, authorizer, clock, audit } = dependencies;
  const executeIdempotently = createPlatformIdempotentExecutor({ persistence, clock });
  const eventDependencies = (now: Date) => ({
    clock: () => now,
    ...(dependencies.newEventId === undefined ? {} : { newEventId: dependencies.newEventId }),
  });

  async function authorize(context: Readonly<PlatformCommandContext>, permission: TenantPlatformPermission): Promise<void> {
    assertIssuedPlatformContext(context);
    await authorizer.assertAllowed(context, permission);
  }

  async function provision(
    context: Readonly<PlatformCommandContext>,
    input: ProvisionTenantInput,
    metadata: TenantCommandMetadata = {},
  ): Promise<Readonly<TenantSnapshot>> {
    const id = tenantId(input.tenantId);
    const administrator = actorId(input.initialAdministratorActorId);
    const now = clock();
    const change = provisionTenant(id, input.displayName, now);
    const envelope = buildEventEnvelopeFor(
      eventScopeForPlatformCommand(context, id),
      eventInputFor(change, { display_name: change.tenant.displayName, new_state: change.tenant.state }),
      eventDependencies(now),
    );
    const result = await executeIdempotently(
      context,
      id,
      {
        scope: "tenant.provision",
        key: metadata.idempotencyKey,
        payload: { display_name: change.tenant.displayName, initial_administrator_actor_id: administrator },
      },
      () => authorize(context, "tenant:provision"),
      async (unitOfWork) => {
        await unitOfWork.tenants.insert(change.tenant);
        await unitOfWork.roles.insertDefaultAdministratorRole({ tenantId: id, roleCode: "tenant_administrator" });
        await unitOfWork.memberships.insertInitialAdministrator({ tenantId: id, actorId: administrator, roleCode: "tenant_administrator" });
        await audit.recordForPlatformCommand(unitOfWork.audit, context, id, {
          action: auditActionFor(change),
          target: { type: "Tenant", id },
          occurredAt: new Date(change.event.occurredAt),
          after: { state: change.tenant.state, version: change.tenant.version, display_name: change.tenant.displayName },
        });
        await unitOfWork.outbox.append(envelope);
        return storedTenant(change.tenant, 201);
      },
    );
    return tenantFromStored(result.response, id, context.correlationId);
  }

  async function transition(
    context: Readonly<PlatformCommandContext>,
    input: TenantLifecycleInput,
    target: LifecycleTarget,
    scope: "tenant.activate" | "tenant.suspend" | "tenant.reactivate" | "tenant.close",
    metadata: TenantCommandMetadata = {},
  ): Promise<Readonly<TenantSnapshot>> {
    const reason = input.reason?.trim();
    if (REASON_REQUIRED.has(target) && (reason === undefined || reason.length === 0)) {
      throw problem({
        code: "tenant_reason_required",
        detail: "A reason is required to suspend or close a tenant.",
        correlation_id: context.correlationId,
      });
    }

    const id = tenantId(input.tenantId);
    const now = clock();

    const result = await executeIdempotently(
      context,
      id,
      {
        scope,
        key: metadata.idempotencyKey,
        payload: {
          expected_version: input.expectedVersion,
          ...(reason === undefined || reason.length === 0 ? {} : { reason }),
        },
      },
      () => authorize(context, "tenant:manage_lifecycle"),
      async (unitOfWork) => {
        const current = await unitOfWork.tenants.findById(id);
        if (current === undefined) {
          throw problem({ code: "tenant_not_found", detail: "The tenant does not exist.", correlation_id: context.correlationId });
        }
        const change = transitionTenant(current, target, input.expectedVersion, now);
        await unitOfWork.tenants.update(change.tenant, current.version);
        await audit.recordForPlatformCommand(unitOfWork.audit, context, id, {
          action: auditActionFor(change),
          target: { type: "Tenant", id },
          occurredAt: new Date(change.event.occurredAt),
          before: { state: current.state, version: current.version },
          after: { state: change.tenant.state, version: change.tenant.version },
          ...(reason === undefined || reason.length === 0 ? {} : { reason }),
        });
        await unitOfWork.outbox.append(
          buildEventEnvelopeFor(
            eventScopeForPlatformCommand(context, id),
            eventInputFor(change, { previous_state: current.state, new_state: change.tenant.state }),
            eventDependencies(now),
          ),
        );
        return storedTenant(change.tenant, 200);
      },
    );
    return tenantFromStored(result.response, id, context.correlationId);
  }

  return Object.freeze({
    provisionTenant: provision,
    activateTenant: (context: Readonly<PlatformCommandContext>, input: TenantLifecycleInput, metadata?: TenantCommandMetadata) =>
      transition(context, input, "ACTIVE", "tenant.activate", metadata),
    suspendTenant: (context: Readonly<PlatformCommandContext>, input: TenantLifecycleInput, metadata?: TenantCommandMetadata) =>
      transition(context, input, "SUSPENDED", "tenant.suspend", metadata),
    reactivateTenant: (context: Readonly<PlatformCommandContext>, input: TenantLifecycleInput, metadata?: TenantCommandMetadata) =>
      transition(context, input, "ACTIVE", "tenant.reactivate", metadata),
    closeTenant: (context: Readonly<PlatformCommandContext>, input: TenantLifecycleInput, metadata?: TenantCommandMetadata) =>
      transition(context, input, "CLOSED", "tenant.close", metadata),
  });
}

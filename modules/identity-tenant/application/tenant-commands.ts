import { buildEventEnvelopeFor, eventScopeForPlatformCommand, type BuildEventInput } from "../../../platform/event-envelope/src/index.ts";
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
  TenantAuditAction,
  TenantAuditRecord,
  TenantPersistence,
  TenantPlatformPermission,
} from "./ports.ts";

export interface TenantCommandDependencies {
  readonly persistence: TenantPersistence;
  readonly authorizer: PlatformAuthorizer;
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

type LifecycleTarget = "ACTIVE" | "SUSPENDED" | "CLOSED";

const REASON_REQUIRED: ReadonlySet<LifecycleTarget> = new Set(["SUSPENDED", "CLOSED"]);

function auditActionFor(change: TenantChange): TenantAuditAction {
  return change.event.type.replace(/\.v[0-9]+$/, "") as TenantAuditAction;
}

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

/**
 * Application handlers for platform-scoped tenant commands. Each command authorizes first, keeps
 * the pure aggregate free of persistence concerns and performs every write through one unit of
 * work, so the tenant change, its audit fact and its outbox event succeed or fail together.
 */
export function createTenantCommands(dependencies: TenantCommandDependencies) {
  const { persistence, authorizer, clock } = dependencies;
  const eventDependencies = (now: Date) => ({
    clock: () => now,
    ...(dependencies.newEventId === undefined ? {} : { newEventId: dependencies.newEventId }),
  });

  async function authorize(context: Readonly<PlatformCommandContext>, permission: TenantPlatformPermission): Promise<void> {
    assertIssuedPlatformContext(context);
    await authorizer.assertAllowed(context, permission);
  }

  async function provision(context: Readonly<PlatformCommandContext>, input: ProvisionTenantInput): Promise<Readonly<TenantSnapshot>> {
    await authorize(context, "tenant:provision");

    const id = tenantId(input.tenantId);
    const administrator = actorId(input.initialAdministratorActorId);
    const now = clock();
    const change = provisionTenant(id, input.displayName, now);
    const envelope = buildEventEnvelopeFor(
      eventScopeForPlatformCommand(context, id),
      eventInputFor(change, { display_name: change.tenant.displayName, new_state: change.tenant.state }),
      eventDependencies(now),
    );
    const audit: TenantAuditRecord = {
      action: auditActionFor(change),
      actorId: context.actorId,
      targetType: "Tenant",
      targetId: id,
      correlationId: context.correlationId,
      ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
      occurredAt: change.event.occurredAt,
      after: { state: change.tenant.state, version: change.tenant.version },
    };

    await persistence.runInTransaction(
      { correlationId: context.correlationId, ...(context.causationId === undefined ? {} : { causationId: context.causationId }) },
      async (unitOfWork) => {
        await unitOfWork.tenants.insert(change.tenant);
        await unitOfWork.roles.insertDefaultAdministratorRole({ tenantId: id, roleCode: "tenant_administrator" });
        await unitOfWork.memberships.insertInitialAdministrator({ tenantId: id, actorId: administrator, roleCode: "tenant_administrator" });
        await unitOfWork.audit.append(audit);
        await unitOfWork.outbox.append(envelope);
      },
    );
    return change.tenant;
  }

  async function transition(
    context: Readonly<PlatformCommandContext>,
    input: TenantLifecycleInput,
    target: LifecycleTarget,
  ): Promise<Readonly<TenantSnapshot>> {
    await authorize(context, "tenant:manage_lifecycle");

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

    return persistence.runInTransaction(
      { correlationId: context.correlationId, ...(context.causationId === undefined ? {} : { causationId: context.causationId }) },
      async (unitOfWork) => {
        const current = await unitOfWork.tenants.findById(id);
        if (current === undefined) {
          throw problem({ code: "tenant_not_found", detail: "The tenant does not exist.", correlation_id: context.correlationId });
        }
        const change = transitionTenant(current, target, input.expectedVersion, now);
        await unitOfWork.tenants.update(change.tenant, current.version);
        await unitOfWork.audit.append({
          action: auditActionFor(change),
          actorId: context.actorId,
          targetType: "Tenant",
          targetId: id,
          correlationId: context.correlationId,
          ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
          occurredAt: change.event.occurredAt,
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
        return change.tenant;
      },
    );
  }

  return Object.freeze({
    provisionTenant: provision,
    activateTenant: (context: Readonly<PlatformCommandContext>, input: TenantLifecycleInput) => transition(context, input, "ACTIVE"),
    suspendTenant: (context: Readonly<PlatformCommandContext>, input: TenantLifecycleInput) => transition(context, input, "SUSPENDED"),
    reactivateTenant: (context: Readonly<PlatformCommandContext>, input: TenantLifecycleInput) => transition(context, input, "ACTIVE"),
    closeTenant: (context: Readonly<PlatformCommandContext>, input: TenantLifecycleInput) => transition(context, input, "CLOSED"),
  });
}

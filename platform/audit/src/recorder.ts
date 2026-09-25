import { randomUUID } from "node:crypto";
import { eventScopeForPlatformCommand, eventScopeFromCurrentContext, type EventScope } from "../../event-envelope/src/index.ts";
import { addSpanEvent, telemetryMetrics } from "../../observability/src/index.ts";
import { problem, redactSensitiveText } from "../../problem-model/src/index.ts";
import type { PlatformCommandContext, TenantId } from "../../tenant-context/src/index.ts";
import { computeEvidenceHash, type AuditEvent, type UnsealedAuditEvent } from "./model.ts";
import { toSafeSnapshot, type AuditPolicy } from "./policy.ts";

const ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const MAX_REASON_LENGTH = 500;

/**
 * Append-only by construction: the port offers no update or delete. The adapter must also enforce
 * this at the database privilege level (no UPDATE/DELETE grant) and reject a tenant that differs
 * from the transaction's bound tenant.
 */
export interface AuditWriter {
  append(event: Readonly<AuditEvent>): Promise<void>;
}

export interface AuditRecordInput {
  /** Catalogued fact such as `tenant.suspended`; lowercase, dot-separated. */
  readonly action: string;
  readonly target: { readonly type: string; readonly id: string };
  readonly reason?: string;
  readonly approvalId?: string;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
  readonly occurredAt?: Date;
}

export interface AuditFailureInfo {
  readonly action: string;
  readonly tenantId: TenantId;
  readonly correlationId: string;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Builds audit events from a trusted scope, never from caller-supplied identity. A failed append
 * propagates so the surrounding transaction rolls back: an audited command without its audit
 * record cannot commit. Failures are also reported to `onWriteFailure` so operators are paged.
 */
export function createAuditRecorder(dependencies: {
  readonly policy: AuditPolicy;
  readonly clock: () => Date;
  readonly newId?: () => string;
  readonly onWriteFailure?: (info: AuditFailureInfo) => void;
}) {
  const newId = dependencies.newId ?? (() => `aud_${randomUUID()}`);

  async function recordForScope(writer: AuditWriter, scope: EventScope, input: AuditRecordInput): Promise<Readonly<AuditEvent>> {
    if (!ACTION_PATTERN.test(input.action)) {
      throw problem({ code: "audit_event_invalid", detail: "Audit action must be a lowercase dotted name.", correlation_id: scope.correlationId });
    }
    if (!nonBlank(input.target?.type) || !nonBlank(input.target?.id)) {
      throw problem({ code: "audit_event_invalid", detail: "Audit target type and id are required.", correlation_id: scope.correlationId });
    }
    const recorded = dependencies.clock();
    const occurred = input.occurredAt ?? recorded;
    if (Number.isNaN(occurred.valueOf()) || Number.isNaN(recorded.valueOf())) {
      throw problem({ code: "invalid_timestamp", detail: "Audit timestamps must be valid instants." });
    }
    if (occurred.valueOf() > recorded.valueOf()) {
      throw problem({ code: "invalid_timestamp", detail: "An audit event cannot occur after it is recorded." });
    }
    const reason = input.reason?.trim();
    const before = toSafeSnapshot(dependencies.policy, input.target.type, input.before);
    const after = toSafeSnapshot(dependencies.policy, input.target.type, input.after);

    const unsealed: UnsealedAuditEvent = {
      auditEventId: newId(),
      tenantId: scope.tenantId,
      occurredAt: occurred.toISOString(),
      recordedAt: recorded.toISOString(),
      actor: { id: scope.actorId, kind: scope.principalKind },
      action: input.action,
      target: { type: input.target.type, id: input.target.id },
      ...(reason === undefined || reason.length === 0 ? {} : { reason: redactSensitiveText(reason).slice(0, MAX_REASON_LENGTH) }),
      correlationId: scope.correlationId,
      ...(scope.causationId === undefined ? {} : { causationId: scope.causationId }),
      ...(input.approvalId === undefined ? {} : { approvalId: input.approvalId }),
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    };
    const event: AuditEvent = deepFreeze({ ...unsealed, evidenceHash: computeEvidenceHash(unsealed) });

    try {
      await writer.append(event);
    } catch (error) {
      telemetryMetrics.auditWriteFailure(input.action);
      try {
        dependencies.onWriteFailure?.({ action: input.action, tenantId: scope.tenantId, correlationId: scope.correlationId });
      } catch {
        // Alerting must never mask the original failure.
      }
      throw error;
    }
    addSpanEvent("audit.recorded", { "sintius.audit.action": input.action, "sintius.audit.target_type": input.target.type });
    return event;
  }

  return Object.freeze({
    recordForCurrentContext: async (writer: AuditWriter, input: AuditRecordInput) =>
      recordForScope(writer, eventScopeFromCurrentContext(), input),
    /** For platform-scoped commands acting on a named tenant, such as provisioning. */
    recordForPlatformCommand: async (
      writer: AuditWriter,
      context: Readonly<PlatformCommandContext>,
      targetTenantId: TenantId,
      input: AuditRecordInput,
    ) => recordForScope(writer, eventScopeForPlatformCommand(context, targetTenantId), input),
    recordForScope,
  });
}

export type AuditRecorder = ReturnType<typeof createAuditRecorder>;

import type { AuditRecorder, AuditWriter } from "../../audit/src/index.ts";
import { problem } from "../../problem-model/src/index.ts";
import type { PlatformCommandContext } from "../../tenant-context/src/index.ts";
import type { DeadLetterAction, DeadLetterInfo, OutboxStore } from "./ports.ts";

export interface DeadLetterOperationInput {
  readonly entryId: string;
  readonly action: DeadLetterAction;
  readonly reason: string;
}

/** Fields allowed in dead-letter audit snapshots; composed into the platform audit policy at the app root. */
export const OUTBOX_AUDIT_FIELDS = Object.freeze({
  OutboxEntry: Object.freeze(["event_id", "event_type", "aggregate_type", "aggregate_id", "resolution", "previous_status"]),
});

/** Permission an operator needs to resolve a dead-lettered event; part of the platform permission catalog. */
export const DEAD_LETTER_RESOLVE_PERMISSION = "outbox:dead_letter:resolve";

export interface DeadLetterUnitOfWork {
  readonly outbox: Pick<OutboxStore, "resolveDeadLetter">;
  readonly audit: AuditWriter;
}

export interface DeadLetterPersistence {
  /** The resolution and its audit event commit together or not at all. */
  runInTransaction<T>(
    scope: { readonly correlationId: string; readonly causationId?: string },
    work: (unitOfWork: DeadLetterUnitOfWork) => Promise<T>,
  ): Promise<T>;
}

/**
 * Operator handling of a dead-lettered event. The dispatcher never skips an event on its own,
 * because skipping one event in a financial stream can leave downstream state wrong. A person must
 * choose to requeue (retry after fixing the cause) or skip (accept the gap), with a stated reason.
 * `authorize` runs first, and the decision is audited against the affected event's tenant in the
 * same transaction, attributed to the platform context's actor.
 */
export function createDeadLetterOperations(dependencies: {
  readonly persistence: DeadLetterPersistence;
  readonly audit: AuditRecorder;
  readonly clock: () => Date;
  readonly authorize: (action: DeadLetterAction) => Promise<void>;
}) {
  return async function resolveDeadLetter(
    context: Readonly<PlatformCommandContext>,
    input: DeadLetterOperationInput,
  ): Promise<DeadLetterInfo> {
    await dependencies.authorize(input.action);
    const reason = input.reason?.trim() ?? "";
    if (reason.length === 0) {
      throw problem({ code: "dead_letter_reason_required", detail: "A reason is required to resolve a dead-lettered event.", correlation_id: context.correlationId });
    }
    if (input.action !== "requeue" && input.action !== "skip") {
      throw problem({ code: "invalid_trusted_context", detail: "Dead-letter action must be requeue or skip.", correlation_id: context.correlationId });
    }
    const now = dependencies.clock();

    return dependencies.persistence.runInTransaction(
      { correlationId: context.correlationId, ...(context.causationId === undefined ? {} : { causationId: context.causationId }) },
      async (unitOfWork) => {
        const resolved = await unitOfWork.outbox.resolveDeadLetter({
          entryId: input.entryId,
          action: input.action,
          operatorId: context.actorId,
          reason,
          now: now.toISOString(),
        });
        if (resolved === undefined) {
          throw problem({ code: "dead_letter_not_resolvable", detail: "The entry is not a dead-lettered event.", correlation_id: context.correlationId });
        }
        await dependencies.audit.recordForPlatformCommand(unitOfWork.audit, context, resolved.tenantId, {
          action: input.action === "skip" ? "outbox.dead_letter_skipped" : "outbox.dead_letter_requeued",
          target: { type: "OutboxEntry", id: input.entryId },
          reason,
          after: {
            event_id: resolved.eventId,
            event_type: resolved.eventType,
            aggregate_type: resolved.aggregateType,
            aggregate_id: resolved.aggregateId,
            resolution: input.action,
          },
          before: { previous_status: "dead" },
        });
        return resolved;
      },
    );
  };
}

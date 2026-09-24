import { problem } from "../../problem-model/src/index.ts";
import type { DeadLetterAction, OutboxStore } from "./ports.ts";

export interface DeadLetterOperationInput {
  readonly entryId: string;
  readonly action: DeadLetterAction;
  /** Authenticated operator; recorded with the reason as permanent evidence on the entry. */
  readonly operatorId: string;
  readonly reason: string;
}

/**
 * Operator handling of a dead-lettered event. The dispatcher never skips an event on its own,
 * because skipping one event in a financial stream can leave downstream state wrong. A person must
 * choose to requeue (retry after fixing the cause) or skip (accept the gap), with a stated reason.
 * `authorize` runs first so the caller's permission check cannot be bypassed.
 */
export function createDeadLetterOperations(dependencies: {
  readonly store: OutboxStore;
  readonly clock: () => Date;
  readonly authorize: (action: DeadLetterAction) => Promise<void>;
}) {
  return async function resolveDeadLetter(input: DeadLetterOperationInput): Promise<void> {
    await dependencies.authorize(input.action);
    const reason = input.reason?.trim() ?? "";
    if (reason.length === 0) {
      throw problem({ code: "dead_letter_reason_required", detail: "A reason is required to resolve a dead-lettered event." });
    }
    if (input.action !== "requeue" && input.action !== "skip") {
      throw problem({ code: "invalid_trusted_context", detail: "Dead-letter action must be requeue or skip." });
    }
    if (typeof input.operatorId !== "string" || input.operatorId.trim().length === 0) {
      throw problem({ code: "invalid_trusted_context", detail: "operatorId must not be blank." });
    }
    const resolved = await dependencies.store.resolveDeadLetter({
      entryId: input.entryId,
      action: input.action,
      operatorId: input.operatorId,
      reason,
      now: dependencies.clock().toISOString(),
    });
    if (!resolved) {
      throw problem({ code: "dead_letter_not_resolvable", detail: "The entry is not a dead-lettered event." });
    }
  };
}

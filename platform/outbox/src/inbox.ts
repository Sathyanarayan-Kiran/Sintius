import type { EventEnvelope } from "../../event-envelope/src/index.ts";
import { problem } from "../../problem-model/src/index.ts";
import type { InboxPersistence, InboxStore } from "./ports.ts";

const CONSUMER_PATTERN = /^[a-z][a-z0-9_.:-]{0,63}$/;

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Wraps a handler so each event id is processed once per consumer and tenant. The dedup record and
 * the handler's writes share one transaction: if the handler fails nothing is recorded and a
 * redelivery is processed again; a redelivery after success is a no-op.
 */
export function createIdempotentConsumer<U extends { readonly inbox: InboxStore }>(dependencies: {
  readonly consumer: string;
  readonly persistence: InboxPersistence<U>;
  readonly clock: () => Date;
  readonly handle: (envelope: Readonly<EventEnvelope>, unitOfWork: U) => Promise<void>;
}) {
  if (!CONSUMER_PATTERN.test(dependencies.consumer)) {
    throw problem({ code: "invalid_trusted_context", detail: "Consumer name must be a lowercase identifier." });
  }

  return async function consume(envelope: Readonly<EventEnvelope>): Promise<{ readonly processed: boolean }> {
    if (!nonBlank(envelope?.id) || !nonBlank(envelope?.tenant_id) || !nonBlank(envelope?.type)) {
      throw problem({ code: "invalid_trusted_context", detail: "Event envelope is missing its id, tenant or type." });
    }
    const scope = {
      tenantId: envelope.tenant_id,
      correlationId: envelope.correlation_id,
      ...(nonBlank(envelope.causation_id) ? { causationId: envelope.causation_id } : {}),
    };
    return dependencies.persistence.runInTransaction(scope, async (unitOfWork) => {
      const outcome = await unitOfWork.inbox.tryRecord({
        consumer: dependencies.consumer,
        tenantId: envelope.tenant_id,
        eventId: envelope.id,
        now: dependencies.clock().toISOString(),
      });
      if (outcome === "duplicate") return { processed: false };
      await dependencies.handle(envelope, unitOfWork);
      return { processed: true };
    });
  };
}

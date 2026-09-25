import type { EventEnvelope } from "../../event-envelope/src/index.ts";
import { createOutboxDispatcher, type DispatcherDependencies } from "./dispatcher.ts";

/**
 * A consumer's delivery worker (decision D14). It is the outbox dispatcher pointed at one
 * consumer's delivery queue, with the consumer's handler as the "publisher", so deliveries get
 * the same proven leasing, per-stream ordering, backoff, redacted errors and dead-lettering.
 * `consume` should be an idempotent consumer (createIdempotentConsumer): a delivery can be handed
 * over more than once after a crash, and the inbox makes the second hand-over a no-op.
 */
export function createDeliveryWorker(
  dependencies: Omit<DispatcherDependencies, "publisher"> & {
    readonly consume: (envelope: Readonly<EventEnvelope>) => Promise<unknown>;
  },
) {
  const { consume, ...rest } = dependencies;
  return createOutboxDispatcher({ ...rest, publisher: { publish: async (envelope) => void (await consume(envelope)) } });
}

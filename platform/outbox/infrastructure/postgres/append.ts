import { currentTraceCarrier } from "../../../observability/src/index.ts";
import type { EventEnvelope } from "../../../event-envelope/src/index.ts";

interface SqlClient {
  query(sql: string, parameters?: readonly unknown[]): Promise<unknown>;
}

/**
 * The one INSERT every producer's outbox writer uses, inside its tenant-bound domain transaction.
 * It records the active trace context beside the envelope (decision D15). Callers must already have
 * asserted that the envelope's tenant is the transaction's bound tenant; RLS enforces it again.
 */
export async function appendOutboxEvent(client: SqlClient, envelope: Readonly<EventEnvelope>): Promise<void> {
  const traceContext = currentTraceCarrier();
  await client.query(
    `INSERT INTO outbox_event (
       tenant_id, event_id, event_type, aggregate_type, aggregate_id, aggregate_version,
       envelope, next_attempt_at, appended_at, trace_context
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb)`,
    [
      envelope.tenant_id, envelope.id, envelope.type, envelope.aggregate_type, envelope.aggregate_id,
      envelope.aggregate_version, JSON.stringify(envelope), envelope.recorded_at, envelope.recorded_at,
      traceContext === undefined ? null : JSON.stringify(traceContext),
    ],
  );
}

import type { AuditEvent } from "../../src/index.ts";

interface SqlClient {
  query(sql: string, parameters?: readonly unknown[]): Promise<unknown>;
}

/**
 * The one INSERT every PostgreSQL audit writer uses. The application role has INSERT only on
 * audit_event, and RLS restricts it to the transaction's bound tenant; callers must still assert
 * the event's tenant is the bound tenant before calling.
 */
export async function appendAuditEvent(client: SqlClient, event: Readonly<AuditEvent>): Promise<void> {
  await client.query(
    `INSERT INTO audit_event (
       tenant_id, audit_event_id, occurred_at, recorded_at, actor, action, target, reason,
       correlation_id, causation_id, approval_id, before_snapshot, after_snapshot, evidence_hash
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14)`,
    [
      event.tenantId, event.auditEventId, event.occurredAt, event.recordedAt, JSON.stringify(event.actor),
      event.action, JSON.stringify(event.target), event.reason ?? null, event.correlationId,
      event.causationId ?? null, event.approvalId ?? null,
      event.before === undefined ? null : JSON.stringify(event.before),
      event.after === undefined ? null : JSON.stringify(event.after), event.evidenceHash,
    ],
  );
}

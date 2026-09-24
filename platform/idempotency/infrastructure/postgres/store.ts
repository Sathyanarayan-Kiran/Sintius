import { problem } from "../../../problem-model/src/index.ts";
import type { TenantId } from "../../../tenant-context/src/index.ts";
import type { ClaimInput, ClaimResult, IdempotencyRecord, IdempotencyStore, StoredResponse } from "../../src/index.ts";

interface QueryResult {
  readonly rowCount: number | null;
  readonly rows: readonly Record<string, unknown>[];
}

export interface IdempotencySqlClient {
  query(sql: string, parameters?: readonly unknown[]): Promise<QueryResult>;
}

function assertTenant(actual: string, expected: TenantId): void {
  if (actual !== expected) {
    throw problem({ code: "tenant_context_mismatch", detail: "The idempotency record does not belong to the bound tenant." });
  }
}

function iso(value: unknown): string {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.valueOf())) throw new Error("PostgreSQL returned an invalid idempotency timestamp.");
  return parsed.toISOString();
}

function recordFrom(row: Record<string, unknown>): Readonly<IdempotencyRecord> {
  const status = String(row.status);
  if (status !== "processing" && status !== "completed") throw new Error("PostgreSQL returned an invalid idempotency status.");
  const record: IdempotencyRecord = {
    tenantId: String(row.tenant_id) as TenantId,
    scope: String(row.command_scope),
    key: String(row.idempotency_key),
    requestHash: String(row.request_hash),
    status,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    ...(status === "completed"
      ? { response: { status: Number(row.response_status), body: structuredClone(row.response_body) as never } }
      : {}),
  };
  return Object.freeze(record);
}

/** Idempotency operations bound to the protected command's already-open PostgreSQL transaction. */
export function createPostgresIdempotencyStore(
  client: IdempotencySqlClient,
  boundTenantId: TenantId,
  isOpen: () => boolean,
): IdempotencyStore {
  const guard = () => {
    if (!isOpen()) throw new Error("PostgreSQL idempotency store used outside its transaction.");
  };

  return {
    claim: async (input: Readonly<ClaimInput>): Promise<ClaimResult> => {
      guard();
      assertTenant(input.tenantId, boundTenantId);
      const inserted = await client.query(
        `INSERT INTO idempotency_record (
           tenant_id, command_scope, idempotency_key, request_hash, status, created_at, expires_at
         ) VALUES ($1, $2, $3, $4, 'processing', $5, $6)
         ON CONFLICT (tenant_id, command_scope, idempotency_key) DO NOTHING
         RETURNING tenant_id`,
        [input.tenantId, input.scope, input.key, input.requestHash, input.now, input.expiresAt],
      );
      if (inserted.rowCount === 1) return { kind: "claimed" };

      const replaced = await client.query(
        `UPDATE idempotency_record
            SET request_hash = $4, status = 'processing', response_status = NULL,
                response_body = NULL, created_at = $5, expires_at = $6
          WHERE tenant_id = $1
            AND tenant_id = current_setting('app.tenant_id', true)
            AND command_scope = $2 AND idempotency_key = $3 AND expires_at <= $5
        RETURNING tenant_id`,
        [input.tenantId, input.scope, input.key, input.requestHash, input.now, input.expiresAt],
      );
      if (replaced.rowCount === 1) return { kind: "claimed" };

      const existing = await client.query(
        `SELECT tenant_id, command_scope, idempotency_key, request_hash, status,
                response_status, response_body, created_at, expires_at
           FROM idempotency_record
          WHERE tenant_id = $1
            AND tenant_id = current_setting('app.tenant_id', true)
            AND command_scope = $2 AND idempotency_key = $3`,
        [input.tenantId, input.scope, input.key],
      );
      if (existing.rowCount !== 1) throw new Error("Idempotency claim conflicted but no tenant-visible record exists.");
      const record = recordFrom(existing.rows[0]!);
      assertTenant(record.tenantId, boundTenantId);
      return { kind: "existing", record };
    },

    complete: async (input: { readonly tenantId: TenantId; readonly scope: string; readonly key: string; readonly response: StoredResponse }) => {
      guard();
      assertTenant(input.tenantId, boundTenantId);
      const completed = await client.query(
        `UPDATE idempotency_record
            SET status = 'completed', response_status = $4, response_body = $5::jsonb
          WHERE tenant_id = $1
            AND tenant_id = current_setting('app.tenant_id', true)
            AND command_scope = $2 AND idempotency_key = $3 AND status = 'processing'`,
        [input.tenantId, input.scope, input.key, input.response.status, JSON.stringify(input.response.body)],
      );
      if (completed.rowCount !== 1) throw new Error("Idempotency completion requires one processing claim in the same transaction.");
    },
  };
}

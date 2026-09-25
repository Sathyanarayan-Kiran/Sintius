import pg from "pg";
import { appendAuditEvent } from "../../../../platform/audit/infrastructure/postgres/writer.ts";
import { appendOutboxEvent } from "../../../../platform/outbox/infrastructure/postgres/append.ts";
import type { AuditEvent } from "../../../../platform/audit/src/index.ts";
import type { EventEnvelope } from "../../../../platform/event-envelope/src/index.ts";
import { createPostgresIdempotencyStore } from "../../../../platform/idempotency/infrastructure/postgres/store.ts";
import { problem } from "../../../../platform/problem-model/src/index.ts";
import type { TenantId } from "../../../../platform/tenant-context/src/index.ts";
import type { FoundationProofPersistence, FoundationProofUnitOfWork } from "../../application/ports.ts";

const { Pool } = pg;

interface QueryResult {
  readonly rowCount: number | null;
  readonly rows: readonly Record<string, unknown>[];
}

interface SqlClient {
  query(sql: string, parameters?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
}

function assertTenant(actual: string, expected: TenantId): void {
  if (actual !== expected) throw problem({ code: "tenant_context_mismatch", detail: "The proof transaction is bound to another tenant." });
}

function unitOfWork(client: SqlClient, boundTenantId: TenantId, isOpen: () => boolean): FoundationProofUnitOfWork {
  const guard = () => {
    if (!isOpen()) throw new Error("PostgreSQL foundation proof unit of work used outside its transaction.");
  };
  return {
    idempotency: createPostgresIdempotencyStore(client, boundTenantId, isOpen),
    records: {
      insert: async (record) => {
        guard();
        assertTenant(record.tenantId, boundTenantId);
        await client.query(
          `INSERT INTO foundation_proof_record
             (tenant_id, proof_record_id, label, actor_id, correlation_id, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [record.tenantId, record.proofRecordId, record.label, record.actorId, record.correlationId, record.recordedAt],
        );
      },
    },
    audit: {
      append: async (event: Readonly<AuditEvent>) => {
        guard();
        assertTenant(event.tenantId, boundTenantId);
        await appendAuditEvent(client, event);
      },
    },
    outbox: {
      append: async (envelope: Readonly<EventEnvelope>) => {
        guard();
        assertTenant(envelope.tenant_id, boundTenantId);
        await appendOutboxEvent(client, envelope);
      },
    },
  };
}

export class PostgresFoundationProofPersistence implements FoundationProofPersistence {
  readonly #pool;

  constructor(options: { readonly connectionString?: string; readonly maxConnections?: number } = {}) {
    this.#pool = new Pool({
      connectionString: options.connectionString ?? process.env.SINTIUS_DATABASE_URL ?? "postgresql://sintius_app@127.0.0.1:54329/sintius",
      max: options.maxConnections ?? 5,
    });
  }

  async runInTransaction<T>(
    scope: { readonly tenantId: TenantId; readonly correlationId: string; readonly causationId?: string },
    work: (unitOfWork: FoundationProofUnitOfWork) => Promise<T>,
  ): Promise<T> {
    const client = (await this.#pool.connect()) as SqlClient;
    let open = true;
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [scope.tenantId]);
      const binding = await client.query("SELECT current_setting('app.tenant_id', true) AS tenant_id");
      assertTenant(String(binding.rows[0]?.tenant_id ?? ""), scope.tenantId);
      const result = await work(unitOfWork(client, scope.tenantId, () => open));
      await client.query("COMMIT");
      open = false;
      return result;
    } catch (error) {
      if (open) await client.query("ROLLBACK").catch(() => undefined);
      open = false;
      throw error;
    } finally {
      open = false;
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

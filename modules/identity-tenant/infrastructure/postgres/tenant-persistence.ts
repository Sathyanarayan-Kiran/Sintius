import pg from "pg";
import type { AuditEvent } from "../../../../platform/audit/src/index.ts";
import type { EventEnvelope } from "../../../../platform/event-envelope/src/index.ts";
import { createPostgresIdempotencyStore } from "../../../../platform/idempotency/infrastructure/postgres/store.ts";
import { problem } from "../../../../platform/problem-model/src/index.ts";
import { tenantId, type TenantId } from "../../../../platform/tenant-context/src/index.ts";
import type { TenantPersistence, TenantTransactionScope, TenantUnitOfWork } from "../../application/ports.ts";
import type { TenantSnapshot, TenantState } from "../../domain/tenant.ts";

const { Pool } = pg;

interface QueryResult {
  readonly rowCount: number | null;
  readonly rows: readonly Record<string, unknown>[];
}

interface SqlClient {
  query(sql: string, parameters?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function snapshot(row: Record<string, unknown>): Readonly<TenantSnapshot> {
  return Object.freeze({
    id: tenantId(String(row.tenant_id)),
    displayName: String(row.display_name),
    state: String(row.state) as TenantState,
    version: Number(row.row_version),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function assertTenantMatch(actual: string, expected: TenantId): void {
  if (actual !== expected) {
    throw problem({ code: "tenant_context_mismatch", detail: "The database transaction is not bound to the required tenant." });
  }
}

function unitOfWork(client: SqlClient, boundTenantId: TenantId, isOpen: () => boolean): TenantUnitOfWork {
  const guard = () => {
    if (!isOpen()) throw new Error("PostgreSQL unit of work used outside its transaction.");
  };
  return {
    idempotency: createPostgresIdempotencyStore(client, boundTenantId, isOpen),
    tenants: {
      insert: async (tenant) => {
        guard();
        assertTenantMatch(tenant.id, boundTenantId);
        try {
          await client.query(
            `INSERT INTO tenant (tenant_id, display_name, state, row_version, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [tenant.id, tenant.displayName, tenant.state, tenant.version, tenant.createdAt, tenant.updatedAt],
          );
        } catch (error) {
          if (postgresCode(error) === "23505") throw problem({ code: "tenant_already_exists", detail: "The tenant already exists." });
          throw error;
        }
      },
      findById: async (id) => {
        guard();
        assertTenantMatch(id, boundTenantId);
        const result = await client.query(
          `SELECT tenant_id, display_name, state, row_version, created_at, updated_at
             FROM tenant
            WHERE tenant_id = $1 AND tenant_id = current_setting('app.tenant_id', true)`,
          [id],
        );
        return result.rowCount === 1 ? snapshot(result.rows[0]) : undefined;
      },
      update: async (tenant, expectedVersion) => {
        guard();
        assertTenantMatch(tenant.id, boundTenantId);
        const result = await client.query(
          `UPDATE tenant
              SET display_name = $2, state = $3, row_version = $4, updated_at = $5
            WHERE tenant_id = $1
              AND tenant_id = current_setting('app.tenant_id', true)
              AND row_version = $6`,
          [tenant.id, tenant.displayName, tenant.state, tenant.version, tenant.updatedAt, expectedVersion],
        );
        if (result.rowCount !== 1) throw problem({ code: "tenant_version_conflict", detail: "The tenant changed concurrently." });
      },
    },
    roles: {
      insertDefaultAdministratorRole: async (record) => {
        guard();
        assertTenantMatch(record.tenantId, boundTenantId);
        await client.query(
          `INSERT INTO tenant_role (tenant_id, role_code, permissions, status)
           VALUES ($1, $2, $3::jsonb, 'active')`,
          [record.tenantId, record.roleCode, JSON.stringify(["tenant:role:manage", "tenant:role:assign"])],
        );
      },
    },
    memberships: {
      insertInitialAdministrator: async (record) => {
        guard();
        assertTenantMatch(record.tenantId, boundTenantId);
        await client.query(
          `INSERT INTO tenant_role_assignment (tenant_id, actor_id, role_code, status)
           VALUES ($1, $2, $3, 'active')`,
          [record.tenantId, record.actorId, record.roleCode],
        );
      },
    },
    audit: {
      append: async (event: Readonly<AuditEvent>) => {
        guard();
        assertTenantMatch(event.tenantId, boundTenantId);
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
      },
    },
    outbox: {
      append: async (envelope: Readonly<EventEnvelope>) => {
        guard();
        assertTenantMatch(envelope.tenant_id, boundTenantId);
        await client.query(
          `INSERT INTO outbox_event (
             tenant_id, event_id, event_type, aggregate_type, aggregate_id, aggregate_version,
             envelope, next_attempt_at, appended_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
          [
            envelope.tenant_id, envelope.id, envelope.type, envelope.aggregate_type, envelope.aggregate_id,
            envelope.aggregate_version, JSON.stringify(envelope), envelope.recorded_at, envelope.recorded_at,
          ],
        );
      },
    },
  };
}

export interface PostgresTenantPersistenceOptions {
  readonly connectionString?: string;
  readonly maxConnections?: number;
}

/** Real PostgreSQL adapter. Every unit of work is one transaction with a transaction-local RLS tenant. */
export class PostgresTenantPersistence implements TenantPersistence {
  readonly #pool;

  constructor(options: PostgresTenantPersistenceOptions = {}) {
    this.#pool = new Pool({
      connectionString: options.connectionString ?? process.env.SINTIUS_DATABASE_URL ?? "postgresql://sintius_app@127.0.0.1:54329/sintius",
      max: options.maxConnections ?? 5,
    });
  }

  async runInTransaction<T>(scope: TenantTransactionScope, work: (unitOfWork: TenantUnitOfWork) => Promise<T>): Promise<T> {
    const client = (await this.#pool.connect()) as SqlClient;
    let open = true;
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [scope.tenantId]);
      const binding = await client.query("SELECT current_setting('app.tenant_id', true) AS tenant_id");
      assertTenantMatch(String(binding.rows[0]?.tenant_id ?? ""), scope.tenantId);
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

import pg from "pg";
import { appendAuditEvent } from "../../../../platform/audit/infrastructure/postgres/writer.ts";
import type { AuditEvent } from "../../../../platform/audit/src/index.ts";
import type { EventEnvelope } from "../../../../platform/event-envelope/src/index.ts";
import { appendOutboxEvent } from "../../../../platform/outbox/infrastructure/postgres/append.ts";
import { problem } from "../../../../platform/problem-model/src/index.ts";
import { currentTenantContext, type TenantId } from "../../../../platform/tenant-context/src/index.ts";
import type { RoleAdministrationUnitOfWork, SecurityPersistence, SecurityTransactionScope } from "../../application/authorization-ports.ts";
import type { Permission, RoleSnapshot, RoleStatus } from "../../domain/authorization.ts";

const { Pool } = pg;

interface SqlClient {
  query(sql: string, parameters?: readonly unknown[]): Promise<{ readonly rowCount: number | null; readonly rows: readonly Record<string, unknown>[] }>;
  release(): void;
}

function assertTenant(actual: string, expected: TenantId): void {
  if (actual !== expected) throw problem({ code: "tenant_context_mismatch", detail: "The role change is not for the bound tenant." });
}

function unitOfWork(client: SqlClient, tenant: TenantId, isOpen: () => boolean): RoleAdministrationUnitOfWork {
  const guard = (target: string) => {
    if (!isOpen()) throw new Error("PostgreSQL unit of work used outside its transaction.");
    assertTenant(target, tenant);
  };
  return {
    roles: {
      // FOR UPDATE: assignment changes to one role serialize, which the last-administrator guard relies on.
      findByCode: async (tenantId, roleCode) => {
        guard(tenantId);
        const result = await client.query(
          `SELECT role_code, permissions, status FROM tenant_role
            WHERE tenant_id = $1 AND role_code = $2 AND tenant_id = current_setting('app.tenant_id', true)
            FOR UPDATE`,
          [tenantId, roleCode],
        );
        const row = result.rows[0];
        if (row === undefined) return undefined;
        const permissions = Array.isArray(row.permissions) ? row.permissions.filter((value: unknown): value is Permission => typeof value === "string") : [];
        return Object.freeze({ roleCode: String(row.role_code), permissions: Object.freeze(permissions), status: String(row.status) as RoleStatus }) satisfies Readonly<RoleSnapshot>;
      },
    },
    assignments: {
      // A previously revoked assignment is reactivated rather than duplicated (the pair is the key).
      insert: async (tenantId, actorId, roleCode) => {
        guard(tenantId);
        const result = await client.query(
          `INSERT INTO tenant_role_assignment (tenant_id, actor_id, role_code, status)
           VALUES ($1, $2, $3, 'active')
           ON CONFLICT (tenant_id, actor_id, role_code) DO UPDATE
             SET status = 'active', revoked_at = NULL, assigned_at = clock_timestamp()
             WHERE tenant_role_assignment.status = 'revoked'
           RETURNING actor_id`,
          [tenantId, actorId, roleCode],
        );
        if (result.rowCount !== 1) throw problem({ code: "role_assignment_exists", detail: "The actor already holds this role." });
      },
      remove: async (tenantId, actorId, roleCode) => {
        guard(tenantId);
        const result = await client.query(
          `UPDATE tenant_role_assignment SET status = 'revoked', revoked_at = clock_timestamp()
            WHERE tenant_id = $1 AND actor_id = $2 AND role_code = $3 AND status = 'active'
              AND tenant_id = current_setting('app.tenant_id', true)`,
          [tenantId, actorId, roleCode],
        );
        if (result.rowCount !== 1) throw problem({ code: "role_assignment_not_found", detail: "The actor does not hold this role." });
      },
      countActiveHolders: async (tenantId, roleCode) => {
        guard(tenantId);
        const result = await client.query(
          `SELECT count(*)::int AS holders FROM tenant_role_assignment
            WHERE tenant_id = $1 AND role_code = $2 AND status = 'active' AND tenant_id = current_setting('app.tenant_id', true)`,
          [tenantId, roleCode],
        );
        return Number(result.rows[0]?.holders ?? 0);
      },
    },
    audit: {
      append: async (event: Readonly<AuditEvent>) => {
        guard(event.tenantId);
        await appendAuditEvent(client, event);
      },
    },
    outbox: {
      append: async (envelope: Readonly<EventEnvelope>) => {
        guard(envelope.tenant_id);
        await appendOutboxEvent(client, envelope);
      },
    },
  };
}

/**
 * Role administration on PostgreSQL. Commands run inside a resolved tenant context; each unit of
 * work is one transaction bound (RLS) to that tenant, so the role change, its audit fact and its
 * event commit together or not at all.
 */
export class PostgresSecurityPersistence implements SecurityPersistence {
  readonly #pool;

  constructor(options: { readonly connectionString?: string; readonly maxConnections?: number } = {}) {
    this.#pool = new Pool({
      connectionString: options.connectionString ?? process.env.SINTIUS_DATABASE_URL ?? "postgresql://sintius_app@127.0.0.1:54329/sintius",
      max: options.maxConnections ?? 5,
    });
  }

  async runInTransaction<T>(_scope: SecurityTransactionScope, work: (unitOfWork: RoleAdministrationUnitOfWork) => Promise<T>): Promise<T> {
    const tenant = currentTenantContext().tenantId;
    const client = (await this.#pool.connect()) as SqlClient;
    let open = true;
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
      const result = await work(unitOfWork(client, tenant, () => open));
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

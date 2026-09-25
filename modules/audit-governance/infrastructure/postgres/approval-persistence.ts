import pg from "pg";
import { appendAuditEvent } from "../../../../platform/audit/infrastructure/postgres/writer.ts";
import type { AuditEvent } from "../../../../platform/audit/src/index.ts";
import type { EventEnvelope } from "../../../../platform/event-envelope/src/index.ts";
import { appendOutboxEvent } from "../../../../platform/outbox/infrastructure/postgres/append.ts";
import { problem } from "../../../../platform/problem-model/src/index.ts";
import { actorId, currentTenantContext, tenantId, type TenantId } from "../../../../platform/tenant-context/src/index.ts";
import type { ApprovalPersistence, ApprovalPolicyReader, ApprovalUnitOfWork } from "../../application/approval-ports.ts";
import type { ApprovalDecision, ApprovalRequest, ApprovalStatus } from "../../domain/approval.ts";

const { Pool } = pg;

interface QueryResult {
  readonly rowCount: number | null;
  readonly rows: readonly Record<string, unknown>[];
}

interface SqlClient {
  query(sql: string, parameters?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
}

/** The approval transaction's query handle, given to the policy reader supplied by Identity & Tenant. */
export interface ApprovalTransaction {
  query(sql: string, parameters?: readonly unknown[]): Promise<QueryResult>;
}

function assertTenant(actual: string, expected: TenantId): void {
  if (actual !== expected) throw problem({ code: "tenant_context_mismatch", detail: "The approval request is not for the bound tenant." });
}

function requestFrom(row: Record<string, unknown>): Readonly<ApprovalRequest> {
  const decisions = (Array.isArray(row.decisions) ? row.decisions : []).map((item: Record<string, unknown>) =>
    Object.freeze({
      actorId: actorId(String(item.actorId)),
      decision: item.decision === "reject" ? "reject" : "approve",
      decidedAt: String(item.decidedAt),
      ...(typeof item.reason === "string" ? { reason: item.reason } : {}),
      ...(typeof item.creditedPermission === "string" ? { creditedPermission: item.creditedPermission } : {}),
    }) as Readonly<ApprovalDecision>,
  );
  const requirements = (Array.isArray(row.approver_requirements) ? row.approver_requirements : []).map((item: Record<string, unknown>) =>
    Object.freeze({ permission: String(item.permission), count: Number(item.count) }),
  );
  return Object.freeze({
    id: String(row.approval_id),
    tenantId: tenantId(String(row.tenant_id)),
    actionType: String(row.action_type),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    targetVersion: Number(row.target_version),
    makerId: actorId(String(row.maker_id)),
    requiredApprovals: Number(row.required_approvals),
    separationOfDuties: Boolean(row.separation_of_duties),
    approverRequirements: Object.freeze(requirements),
    status: String(row.status) as ApprovalStatus,
    decisions: Object.freeze(decisions),
    version: Number(row.row_version),
    createdAt: new Date(String(row.created_at)).toISOString(),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
  });
}

function unitOfWork(
  client: SqlClient,
  tenant: TenantId,
  isOpen: () => boolean,
  policies: (transaction: ApprovalTransaction) => ApprovalPolicyReader,
): ApprovalUnitOfWork {
  const guard = (target: string) => {
    if (!isOpen()) throw new Error("PostgreSQL unit of work used outside its transaction.");
    assertTenant(target, tenant);
  };
  const transaction: ApprovalTransaction = Object.freeze({
    query: (sql: string, parameters?: readonly unknown[]) => {
      if (!isOpen()) throw new Error("PostgreSQL unit of work used outside its transaction.");
      return client.query(sql, parameters);
    },
  });
  return {
    policies: policies(transaction),
    approvals: {
      insert: async (request) => {
        guard(request.tenantId);
        await client.query(
          `INSERT INTO approval_request (
             tenant_id, approval_id, action_type, target_type, target_id, target_version, maker_id,
             required_approvals, separation_of_duties, approver_requirements, status, decisions, row_version,
             created_at, expires_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14,$15)`,
          [
            request.tenantId, request.id, request.actionType, request.targetType, request.targetId, request.targetVersion,
            request.makerId, request.requiredApprovals, request.separationOfDuties, JSON.stringify(request.approverRequirements),
            request.status, JSON.stringify(request.decisions), request.version, request.createdAt, request.expiresAt,
          ],
        );
      },
      findById: async (tenantIdValue, id) => {
        guard(tenantIdValue);
        const result = await client.query(
          `SELECT * FROM approval_request
            WHERE tenant_id = $1 AND approval_id = $2 AND tenant_id = current_setting('app.tenant_id', true)`,
          [tenantIdValue, id],
        );
        return result.rows[0] === undefined ? undefined : requestFrom(result.rows[0]);
      },
      // Compare-and-set on row_version; only status, decisions and version may change.
      update: async (request, expectedVersion) => {
        guard(request.tenantId);
        const result = await client.query(
          `UPDATE approval_request SET status = $3, decisions = $4::jsonb, row_version = $5
            WHERE tenant_id = $1 AND approval_id = $2 AND row_version = $6
              AND tenant_id = current_setting('app.tenant_id', true)`,
          [request.tenantId, request.id, request.status, JSON.stringify(request.decisions), request.version, expectedVersion],
        );
        if (result.rowCount !== 1) throw problem({ code: "approval_version_conflict", detail: "The approval request changed concurrently." });
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
 * Maker-checker persistence on PostgreSQL. Each unit of work is one transaction bound (RLS) to the
 * current tenant: the request change, its audit fact and its event commit together. Policies are
 * read through a reader supplied by the composition root (Identity & Tenant owns the table).
 */
export class PostgresApprovalPersistence implements ApprovalPersistence {
  readonly #pool;
  readonly #policies: (transaction: ApprovalTransaction) => ApprovalPolicyReader;

  constructor(options: {
    readonly policies: (transaction: ApprovalTransaction) => ApprovalPolicyReader;
    readonly connectionString?: string;
    readonly maxConnections?: number;
  }) {
    this.#policies = options.policies;
    this.#pool = new Pool({
      connectionString: options.connectionString ?? process.env.SINTIUS_DATABASE_URL ?? "postgresql://sintius_app@127.0.0.1:54329/sintius",
      max: options.maxConnections ?? 5,
    });
  }

  async runInTransaction<T>(
    _scope: { readonly correlationId: string; readonly causationId?: string },
    work: (unitOfWork: ApprovalUnitOfWork) => Promise<T>,
  ): Promise<T> {
    const tenant = currentTenantContext().tenantId;
    const client = (await this.#pool.connect()) as SqlClient;
    let open = true;
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
      const result = await work(unitOfWork(client, tenant, () => open, this.#policies));
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

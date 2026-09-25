import pg from "pg";
import type { AuditEvent, AuditWriter } from "../../../audit/src/index.ts";
import type { EventEnvelope } from "../../../event-envelope/src/index.ts";
import { toCarrier } from "../../../observability/src/index.ts";
import { problem } from "../../../problem-model/src/index.ts";
import { tenantId, type TenantId } from "../../../tenant-context/src/index.ts";
import type { DeadLetterPersistence, DeadLetterUnitOfWork } from "../../src/operations.ts";
import type {
  DeadLetterAction,
  DeadLetterInfo,
  InboxPersistence,
  InboxStore,
  InboxTransactionScope,
  LeaseRequest,
  OutboxEntry,
  OutboxStats,
  OutboxStatus,
  OutboxStore,
} from "../../src/ports.ts";

const { Pool } = pg;

interface QueryResult {
  readonly rowCount: number | null;
  readonly rows: readonly Record<string, unknown>[];
}

interface SqlClient {
  query(sql: string, parameters?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
}

interface PoolOptions {
  readonly connectionString?: string;
  readonly maxConnections?: number;
}

const DISPATCHER_URL = "postgresql://sintius_dispatcher@127.0.0.1:54329/sintius";
const APP_URL = "postgresql://sintius_app@127.0.0.1:54329/sintius";
const MAX_ERROR_LENGTH = 2000;
const ENTRY_ID_PATTERN = /^[1-9][0-9]{0,18}$/;

function iso(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.valueOf())) throw new Error("PostgreSQL returned an invalid outbox timestamp.");
  return parsed.toISOString();
}

function entryFrom(row: Record<string, unknown>, sql: QueueSql): Readonly<OutboxEntry> {
  const optional = (key: string, field: string, map: (value: unknown) => unknown = String) =>
    row[key] === null || row[key] === undefined ? {} : { [field]: map(row[key]) };
  return Object.freeze({
    entryId: String(row.entry_id),
    sequence: Number(row.entry_id),
    envelope: Object.freeze(structuredClone(row.envelope) as EventEnvelope),
    status: String(row.status) as OutboxStatus,
    attempts: Number(row.attempts),
    nextAttemptAt: iso(row.next_attempt_at),
    appendedAt: iso(row[sql.queuedAt]),
    ...optional("leased_by", "leasedBy"),
    ...optional("lease_expires_at", "leaseExpiresAt", iso),
    ...optional("last_error", "lastError"),
    ...optional(sql.doneAt, "publishedAt", iso),
    ...optional("resolution", "resolution", (value) => Object.freeze(structuredClone(value))),
    ...(toCarrier(row.trace_context) === undefined ? {} : { traceContext: toCarrier(row.trace_context) }),
  }) as Readonly<OutboxEntry>;
}

function ageSeconds(now: string, oldest: unknown): number | undefined {
  return oldest === null || oldest === undefined ? undefined : (Date.parse(now) - Date.parse(iso(oldest))) / 1000;
}

async function withTransaction<T>(pool: InstanceType<typeof Pool>, work: (client: SqlClient, isOpen: () => boolean) => Promise<T>): Promise<T> {
  const client = (await pool.connect()) as SqlClient;
  let open = true;
  try {
    await client.query("BEGIN");
    const result = await work(client, () => open);
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

async function bindTenant(client: SqlClient, boundTenantId: string): Promise<void> {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [boundTenantId]);
  const binding = await client.query("SELECT current_setting('app.tenant_id', true) AS tenant_id");
  if (String(binding.rows[0]?.tenant_id ?? "") !== boundTenantId) {
    throw problem({ code: "tenant_context_mismatch", detail: "The database transaction is not bound to the required tenant." });
  }
}

/**
 * Which queue a store works on: the producers' outbox, or one consumer's deliveries (decision D14).
 * Table and column names come from this fixed descriptor, never from caller input.
 */
export type QueueSelector = { readonly kind: "outbox" } | { readonly kind: "delivery"; readonly consumer: string };

const CONSUMER_PATTERN = /^[a-z][a-z0-9_.:-]{0,63}$/;

interface QueueSql {
  readonly table: "outbox_event" | "event_delivery";
  readonly done: "published" | "delivered";
  readonly doneAt: "published_at" | "delivered_at";
  readonly queuedAt: "appended_at" | "enqueued_at";
  readonly consumer: string | undefined;
}

function queueSql(queue: QueueSelector = { kind: "outbox" }): QueueSql {
  if (queue.kind === "outbox") return { table: "outbox_event", done: "published", doneAt: "published_at", queuedAt: "appended_at", consumer: undefined };
  if (!CONSUMER_PATTERN.test(queue.consumer)) throw new TypeError("Consumer name must be a lowercase identifier.");
  return { table: "event_delivery", done: "delivered", doneAt: "delivered_at", queuedAt: "enqueued_at", consumer: queue.consumer };
}

/** `AND <alias>.consumer = $n` for delivery queues; empty for the outbox. */
function consumerScope(sql: QueueSql, alias: string, parameter: number): string {
  return sql.consumer === undefined ? "" : ` AND ${alias}.consumer = $${parameter}`;
}

function withConsumer(sql: QueueSql, parameters: unknown[]): unknown[] {
  return sql.consumer === undefined ? parameters : [...parameters, sql.consumer];
}

/**
 * Relay-side queue store, connected as the `sintius_dispatcher` workload role. Each call is a
 * single statement, so leasing is atomic without an explicit transaction. The same store serves
 * the outbox (producers to transport) and each consumer's deliveries (transport to consumer).
 *
 * Leasing only considers the head of each stream: (tenant, aggregate type, aggregate id), plus the
 * consumer for deliveries, so one consumer's dead letter never blocks another consumer. An entry is
 * eligible when no earlier entry of its stream is unfinished. `FOR UPDATE SKIP LOCKED` lets
 * concurrent workers take disjoint heads; a head another worker just leased fails the re-check on
 * the committed row and is left alone. Order within a stream is `entry_id`, which follows commit
 * order because producers append after the aggregate's compare-and-set row update.
 */
export class PostgresOutboxStore implements OutboxStore {
  readonly #pool;
  readonly #sql: QueueSql;

  constructor(options: PoolOptions & { readonly queue?: QueueSelector } = {}) {
    this.#sql = queueSql(options.queue);
    this.#pool = new Pool({
      connectionString: options.connectionString ?? process.env.SINTIUS_DISPATCHER_DATABASE_URL ?? DISPATCHER_URL,
      max: options.maxConnections ?? 5,
    });
  }

  async leaseBatch(request: Readonly<LeaseRequest>): Promise<readonly Readonly<OutboxEntry>[]> {
    if (!Number.isInteger(request.limit) || request.limit < 1) return [];
    const sql = this.#sql;
    const result = await this.#pool.query(
      `WITH candidate AS (
         SELECT head.entry_id
           FROM ${sql.table} head
          WHERE ((head.status = 'pending' AND head.next_attempt_at <= $2::timestamptz)
             OR (head.status = 'leased' AND head.lease_expires_at <= $2::timestamptz))${consumerScope(sql, "head", 5)}
            AND NOT EXISTS (
                  SELECT 1
                    FROM ${sql.table} earlier
                   WHERE earlier.tenant_id = head.tenant_id
                     AND earlier.aggregate_type = head.aggregate_type
                     AND earlier.aggregate_id = head.aggregate_id${sql.consumer === undefined ? "" : "\n                     AND earlier.consumer = head.consumer"}
                     AND earlier.entry_id < head.entry_id
                     AND earlier.status NOT IN ('${sql.done}', 'skipped'))
          ORDER BY head.entry_id
          LIMIT $4
          FOR UPDATE OF head SKIP LOCKED
       )
       UPDATE ${sql.table} leased
          SET status = 'leased',
              attempts = leased.attempts + 1,
              leased_by = $1,
              lease_expires_at = $2::timestamptz + make_interval(secs => $3)
         FROM candidate
        WHERE leased.entry_id = candidate.entry_id
       RETURNING leased.*`,
      withConsumer(sql, [request.workerId, request.now, request.leaseSeconds, request.limit]),
    );
    return result.rows.map((row) => entryFrom(row, sql)).sort((left, right) => left.sequence - right.sequence);
  }

  async markPublished(input: { readonly entryId: string; readonly workerId: string; readonly now: string }): Promise<boolean> {
    if (!ENTRY_ID_PATTERN.test(input.entryId)) return false;
    const sql = this.#sql;
    const result = await this.#pool.query(
      `UPDATE ${sql.table}
          SET status = '${sql.done}', ${sql.doneAt} = $3, leased_by = NULL, lease_expires_at = NULL
        WHERE entry_id = $1 AND status = 'leased' AND leased_by = $2${consumerScope(sql, sql.table, 4)}`,
      withConsumer(sql, [input.entryId, input.workerId, input.now]),
    );
    return result.rowCount === 1;
  }

  async recordFailure(input: {
    readonly entryId: string;
    readonly workerId: string;
    readonly now: string;
    readonly error: string;
    readonly retryAt?: string;
  }): Promise<boolean> {
    if (!ENTRY_ID_PATTERN.test(input.entryId)) return false;
    const sql = this.#sql;
    const result = await this.#pool.query(
      `UPDATE ${sql.table}
          SET status = CASE WHEN $4::timestamptz IS NULL THEN 'dead' ELSE 'pending' END,
              next_attempt_at = COALESCE($4::timestamptz, next_attempt_at),
              last_error = $3,
              leased_by = NULL,
              lease_expires_at = NULL
        WHERE entry_id = $1 AND status = 'leased' AND leased_by = $2${consumerScope(sql, sql.table, 5)}`,
      withConsumer(sql, [input.entryId, input.workerId, input.error.slice(0, MAX_ERROR_LENGTH), input.retryAt ?? null]),
    );
    return result.rowCount === 1;
  }

  /** Outside a transaction; `PostgresDeadLetterPersistence` is the audited path operators use. */
  async resolveDeadLetter(input: {
    readonly entryId: string;
    readonly action: DeadLetterAction;
    readonly operatorId: string;
    readonly reason: string;
    readonly now: string;
  }): Promise<DeadLetterInfo | undefined> {
    const client = (await this.#pool.connect()) as SqlClient;
    try {
      return await resolveDeadLetterWith(client, input, this.#sql);
    } finally {
      client.release();
    }
  }

  async stats(now: string): Promise<OutboxStats> {
    const sql = this.#sql;
    const result = await this.#pool.query(
      `SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
              count(*) FILTER (WHERE status = 'leased')::int AS leased,
              count(*) FILTER (WHERE status = 'dead')::int AS dead_letter,
              count(DISTINCT jsonb_build_array(tenant_id, aggregate_type, aggregate_id)) FILTER (WHERE status = 'dead')::int AS blocked_streams,
              min(${sql.queuedAt}) FILTER (WHERE status = 'dead') AS oldest_dead,
              min(${sql.queuedAt}) AS oldest_unpublished
         FROM ${sql.table}
        WHERE status NOT IN ('${sql.done}', 'skipped')${consumerScope(sql, sql.table, 1)}`,
      withConsumer(sql, []),
    );
    const row = result.rows[0]!;
    return Object.freeze({
      pending: Number(row.pending),
      leased: Number(row.leased),
      deadLetter: Number(row.dead_letter),
      blockedStreams: Number(row.blocked_streams),
      oldestDeadLetterAgeSeconds: ageSeconds(now, row.oldest_dead),
      oldestUnpublishedAgeSeconds: ageSeconds(now, row.oldest_unpublished),
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

async function resolveDeadLetterWith(
  client: SqlClient,
  input: {
    readonly entryId: string;
    readonly action: DeadLetterAction;
    readonly operatorId: string;
    readonly reason: string;
    readonly now: string;
  },
  sql: QueueSql,
): Promise<DeadLetterInfo | undefined> {
  if (!ENTRY_ID_PATTERN.test(input.entryId) || (input.action !== "requeue" && input.action !== "skip")) return undefined;
  const resolution = { action: input.action, operatorId: input.operatorId, reason: input.reason, resolvedAt: input.now };
  const result = await client.query(
    `UPDATE ${sql.table}
        SET status = CASE WHEN $2 = 'skip' THEN 'skipped' ELSE 'pending' END,
            attempts = CASE WHEN $2 = 'skip' THEN attempts ELSE 0 END,
            next_attempt_at = CASE WHEN $2 = 'skip' THEN next_attempt_at ELSE $3::timestamptz END,
            resolution = $4::jsonb
      WHERE entry_id = $1 AND status = 'dead'${consumerScope(sql, sql.table, 5)}
      RETURNING entry_id, tenant_id, event_id, event_type, aggregate_type, aggregate_id`,
    withConsumer(sql, [input.entryId, input.action, input.now, JSON.stringify(resolution)]),
  );
  if (result.rowCount !== 1) return undefined;
  const row = result.rows[0]!;
  return Object.freeze({
    entryId: String(row.entry_id),
    tenantId: tenantId(String(row.tenant_id)),
    eventId: String(row.event_id),
    eventType: String(row.event_type),
    aggregateType: String(row.aggregate_type),
    aggregateId: String(row.aggregate_id),
  });
}

/** Appends audit rows only for the tenant the transaction is currently bound to. */
function boundAuditWriter(client: SqlClient, boundTenant: () => TenantId | undefined, isOpen: () => boolean): AuditWriter {
  return {
    append: async (event: Readonly<AuditEvent>) => {
      if (!isOpen()) throw new Error("PostgreSQL unit of work used outside its transaction.");
      if (boundTenant() !== event.tenantId) {
        throw problem({ code: "tenant_context_mismatch", detail: "The audit event does not belong to the bound tenant." });
      }
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
  };
}

/**
 * Operator dead-letter resolution as the dispatcher role. The entry is resolved first; the
 * transaction is then bound to that entry's tenant so the audit row passes RLS for that tenant only.
 */
export class PostgresDeadLetterPersistence implements DeadLetterPersistence {
  readonly #pool;
  readonly #sql: QueueSql;

  constructor(options: PoolOptions & { readonly queue?: QueueSelector } = {}) {
    this.#sql = queueSql(options.queue);
    this.#pool = new Pool({
      connectionString: options.connectionString ?? process.env.SINTIUS_DISPATCHER_DATABASE_URL ?? DISPATCHER_URL,
      max: options.maxConnections ?? 2,
    });
  }

  runInTransaction<T>(
    _scope: { readonly correlationId: string; readonly causationId?: string },
    work: (unitOfWork: DeadLetterUnitOfWork) => Promise<T>,
  ): Promise<T> {
    return withTransaction(this.#pool, async (client, isOpen) => {
      let bound: TenantId | undefined;
      let resolved = false;
      return work({
        outbox: {
          resolveDeadLetter: async (input) => {
            if (!isOpen()) throw new Error("PostgreSQL unit of work used outside its transaction.");
            if (resolved) throw new Error("One dead-letter resolution per transaction.");
            resolved = true;
            const info = await resolveDeadLetterWith(client, input, this.#sql);
            if (info !== undefined) {
              await bindTenant(client, info.tenantId);
              bound = info.tenantId;
            }
            return info;
          },
        },
        audit: boundAuditWriter(client, () => bound, isOpen),
      });
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

/** Transaction handle a consumer's own repositories write through; bound to the event's tenant. */
export interface PostgresConsumerTransaction {
  readonly tenantId: TenantId;
  query(sql: string, parameters?: readonly unknown[]): Promise<QueryResult>;
}

function inboxStore(client: SqlClient, boundTenantId: string, isOpen: () => boolean): InboxStore {
  return {
    tryRecord: async ({ consumer, tenantId: recordTenant, eventId, now }) => {
      if (!isOpen()) throw new Error("PostgreSQL unit of work used outside its transaction.");
      if (recordTenant !== boundTenantId) {
        throw problem({ code: "tenant_context_mismatch", detail: "The inbox record does not belong to the bound tenant." });
      }
      // A concurrent duplicate waits on the primary key until the first delivery commits or rolls back.
      const result = await client.query(
        `INSERT INTO inbox_record (tenant_id, consumer, event_id, recorded_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, consumer, event_id) DO NOTHING`,
        [recordTenant, consumer, eventId, now],
      );
      return result.rowCount === 1 ? "recorded" : "duplicate";
    },
  };
}

/**
 * Consumer-side inbox as the application role. Each delivery is one transaction bound to the event's
 * tenant; `unitOfWork` builds the consumer's own repositories on the same transaction.
 */
export class PostgresInboxPersistence<U extends { readonly inbox: InboxStore }> implements InboxPersistence<U> {
  readonly #pool;
  readonly #unitOfWork: (transaction: PostgresConsumerTransaction) => Omit<U, "inbox">;

  constructor(options: PoolOptions & { readonly unitOfWork: (transaction: PostgresConsumerTransaction) => Omit<U, "inbox"> }) {
    this.#pool = new Pool({
      connectionString: options.connectionString ?? process.env.SINTIUS_DATABASE_URL ?? APP_URL,
      max: options.maxConnections ?? 5,
    });
    this.#unitOfWork = options.unitOfWork;
  }

  runInTransaction<T>(scope: InboxTransactionScope, work: (unitOfWork: U) => Promise<T>): Promise<T> {
    const boundTenantId = tenantId(scope.tenantId);
    return withTransaction(this.#pool, async (client, isOpen) => {
      await bindTenant(client, boundTenantId);
      const transaction: PostgresConsumerTransaction = Object.freeze({
        tenantId: boundTenantId,
        query: (sql: string, parameters?: readonly unknown[]) => {
          if (!isOpen()) throw new Error("PostgreSQL unit of work used outside its transaction.");
          return client.query(sql, parameters);
        },
      });
      return work({ ...this.#unitOfWork(transaction), inbox: inboxStore(client, boundTenantId, isOpen) } as U);
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

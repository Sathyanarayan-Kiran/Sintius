/**
 * The tenant-isolation release gate (P0-009, BL-001-04 / BL-017-03).
 *
 * Two independent checks, both driven by the live database catalog so that a new table is covered
 * the moment its migration runs:
 *
 * 1. `auditIsolationCatalog` inspects PostgreSQL's catalog: every table holds tenant data behind
 *    enabled and forced row-level security with tenant-bound policies, the application roles have
 *    exactly the reviewed privileges and no power to bypass RLS, and nothing (views, SECURITY
 *    DEFINER functions, ownership) offers a way around it.
 * 2. `runIsolationMatrix` attacks every table as a real application role: reads, inserts, updates,
 *    re-tenanting updates and deletes against another tenant's rows, and every operation with no
 *    tenant bound. Each attack must be refused by a privilege error or see zero rows, and a positive
 *    control proves the role can still reach its own tenant's rows, so a refusal is due to tenant
 *    isolation rather than a broken fixture.
 *
 * Changing the reviewed state (a new table, grant or relay policy) means updating the manifests
 * below, which is the intended review point.
 */

export interface SqlClient {
  query(sql: string, parameters?: readonly unknown[]): Promise<{ readonly rowCount: number | null; readonly rows: readonly Record<string, unknown>[] }>;
}

/** Platform metadata that holds no tenant data. Anything else in the schema must be tenant-isolated. */
export const NON_TENANT_TABLES: Readonly<Record<string, string>> = Object.freeze({
  schema_migration: "Migration bookkeeping, written only by the migration role.",
  credential_revocation: "Revoked token IDs, read during authentication before any tenant is known; read-only for the application.",
});

/** Reviewed read policies on non-tenant tables. Application roles may never write a non-tenant table. */
export const NON_TENANT_POLICIES: Readonly<Record<string, string>> = Object.freeze({
  "credential_revocation.revocation_read": "SELECT",
});

/**
 * Relay tables are read across tenants by the dispatcher workload by design (ADR-009, D14): it moves
 * committed events from the outbox to per-consumer queues and never interprets their data. Their
 * primary keys are global sequence numbers so that delivery order is a single index scan.
 */
export const RELAY_TABLES: Readonly<Record<string, string>> = Object.freeze({
  outbox_event: "The dispatcher leases stream heads across tenants.",
  event_delivery: "The dispatcher fans events out to consumer queues across tenants.",
});

/** Cross-tenant policies reviewed for the dispatcher role; any other policy must be tenant-bound. */
export const RELAY_POLICIES: Readonly<Record<string, string>> = Object.freeze({
  "outbox_event.dispatcher_read": "SELECT",
  "outbox_event.dispatcher_update": "UPDATE",
  "event_delivery.relay_read": "SELECT",
  "event_delivery.relay_insert": "INSERT",
  "event_delivery.relay_update": "UPDATE",
});

export const APPLICATION_ROLES = Object.freeze(["sintius_app", "sintius_dispatcher"] as const);
export type ApplicationRole = (typeof APPLICATION_ROLES)[number];

/**
 * Reviewed privileges per role. `UPDATE(a,b)` is a column-limited grant. The gate fails on any
 * difference, including a privilege that is removed, so the manifest always matches the database.
 */
export const PRIVILEGE_MANIFEST: Readonly<Record<ApplicationRole, Readonly<Record<string, readonly string[]>>>> = Object.freeze({
  sintius_app: {
    approval_policy: ["INSERT", "SELECT", "UPDATE"],
    approval_request: ["INSERT", "SELECT", "UPDATE(decisions,row_version,status)"],
    audit_event: ["INSERT"],
    foundation_proof_record: ["INSERT", "SELECT"],
    idempotency_record: ["INSERT", "SELECT", "UPDATE"],
    inbox_record: ["INSERT", "SELECT"],
    outbox_event: ["INSERT"],
    // Granted with the outbox (migration 005); the identity column itself needs no sequence privilege.
    outbox_event_entry_id_seq: ["SELECT", "USAGE"],
    credential_revocation: ["SELECT"],
    tenant: ["INSERT", "SELECT", "UPDATE"],
    tenant_identity_provider: ["INSERT", "SELECT", "UPDATE"],
    tenant_role: ["INSERT", "SELECT", "UPDATE"],
    tenant_role_assignment: ["INSERT", "SELECT", "UPDATE"],
  },
  sintius_dispatcher: {
    audit_event: ["INSERT"],
    event_delivery: ["INSERT", "SELECT", "UPDATE(attempts,delivered_at,last_error,lease_expires_at,leased_by,next_attempt_at,resolution,status)"],
    outbox_event: ["SELECT", "UPDATE(attempts,last_error,lease_expires_at,leased_by,next_attempt_at,published_at,resolution,status)"],
  },
});

const TENANT_PREDICATE = "(tenant_id = current_setting('app.tenant_id'::text, true))";
const AT = "2026-09-25T09:00:00.000Z";
const LATER = "2026-10-25T09:00:00.000Z";
const HASH = "0".repeat(64);

type Row = Readonly<Record<string, unknown>>;

/**
 * One valid row per table for a tenant. `key` makes the row's own identity unique so the matrix can
 * insert fresh rows; rows that reference a parent use the parent's `iso` fixture row.
 */
export const TENANT_TABLE_FIXTURES: Readonly<Record<string, (tenant: string, key: string) => Row>> = Object.freeze({
  tenant: (tenant) => ({ tenant_id: tenant, display_name: `Isolation ${tenant}`, state: "ACTIVE", row_version: 1, created_at: AT, updated_at: AT }),
  tenant_identity_provider: (tenant, key) => ({ tenant_id: tenant, provider_id: `idp_${key}`, mechanism: "oidc", issuer: "https://idp.isolation.test" }),
  tenant_role: (tenant, key) => ({ tenant_id: tenant, role_code: `role_${key}`, permissions: "[]", status: "active" }),
  tenant_role_assignment: (tenant, key) => ({ tenant_id: tenant, actor_id: `actor_${key}`, role_code: "role_iso", status: "active" }),
  approval_policy: (tenant, key) => ({ tenant_id: tenant, action_type: `isolation:check:${key}`, required_approvals: 1, expires_after_seconds: 3600 }),
  approval_request: (tenant, key) => ({
    tenant_id: tenant, approval_id: `apr_${key}`, action_type: "isolation:check", target_type: "Isolation", target_id: "iso_1",
    target_version: 1, maker_id: "actor_iso", required_approvals: 1, separation_of_duties: true, status: "PENDING",
    decisions: "[]", row_version: 1, created_at: AT, expires_at: LATER,
  }),
  audit_event: (tenant, key) => ({
    tenant_id: tenant, audit_event_id: `aud_${key}`, occurred_at: AT, recorded_at: AT, actor: '{"id":"actor_iso"}',
    action: "isolation.checked", target: '{"type":"Isolation","id":"iso_1"}', correlation_id: `corr_${key}`, evidence_hash: HASH,
  }),
  outbox_event: (tenant, key) => ({
    tenant_id: tenant, event_id: `evt_${key}`, event_type: "isolation.checked.v1", aggregate_type: "Isolation", aggregate_id: `iso_${key}`,
    aggregate_version: 1, envelope: "{}", status: "published", published_at: AT, next_attempt_at: AT, appended_at: AT,
  }),
  event_delivery: (tenant, key) => ({
    consumer: "isolation.gate", tenant_id: tenant, event_id: `evt_${key}`, event_type: "isolation.checked.v1", aggregate_type: "Isolation",
    aggregate_id: `iso_${key}`, aggregate_version: 1, envelope: "{}", status: "delivered", delivered_at: AT, next_attempt_at: AT, enqueued_at: AT,
  }),
  inbox_record: (tenant, key) => ({ tenant_id: tenant, consumer: "isolation.gate", event_id: `evt_${key}`, recorded_at: AT }),
  idempotency_record: (tenant, key) => ({
    tenant_id: tenant, command_scope: "isolation.check", idempotency_key: `idem_key_${key}`.padEnd(16, "0"), request_hash: HASH,
    status: "processing", created_at: AT, expires_at: LATER,
  }),
  foundation_proof_record: (tenant, key) => ({
    tenant_id: tenant, proof_record_id: `proof_${key}`, label: "isolation", actor_id: "actor_iso", correlation_id: `corr_${key}`, recorded_at: AT,
  }),
});

/** Parents before children, so fixture rows satisfy foreign keys. */
const FIXTURE_ORDER = ["tenant", "tenant_role", "tenant_role_assignment"];

function identifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected identifier: ${name}`);
  return `"${name}"`;
}

export async function insertFixture(client: SqlClient, table: string, row: Row): Promise<void> {
  const columns = Object.keys(row);
  await client.query(
    `INSERT INTO ${identifier(table)} (${columns.map(identifier).join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
    columns.map((column) => row[column]),
  );
}

export async function tenantTables(client: SqlClient): Promise<string[]> {
  const result = await client.query(
    `SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') ORDER BY c.relname`,
  );
  return result.rows.map((row) => String(row.relname)).filter((name) => !(name in NON_TENANT_TABLES));
}

/** Seeds one `iso` row per table for each tenant, as the migration role (a superuser bypasses RLS). */
export async function seedTenants(admin: SqlClient, tenants: readonly string[]): Promise<void> {
  const tables = Object.keys(TENANT_TABLE_FIXTURES);
  const ordered = [...FIXTURE_ORDER, ...tables.filter((table) => !FIXTURE_ORDER.includes(table))];
  for (const tenant of tenants) {
    for (const table of ordered) await insertFixture(admin, table, TENANT_TABLE_FIXTURES[table]!(tenant, "iso"));
  }
}

export async function removeTenants(admin: SqlClient, tenants: readonly string[]): Promise<void> {
  const tables = await tenantTables(admin);
  const ordered = [...tables.filter((table) => !FIXTURE_ORDER.includes(table)), ...[...FIXTURE_ORDER].reverse()];
  for (const table of ordered) await admin.query(`DELETE FROM ${identifier(table)} WHERE tenant_id = ANY($1)`, [tenants]);
}

// ---------------------------------------------------------------------------------------------
// 1. Catalog audit
// ---------------------------------------------------------------------------------------------

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

/** Returns one finding per violated rule; an empty list means the catalog passes. */
export async function auditIsolationCatalog(client: SqlClient): Promise<string[]> {
  const findings: string[] = [];
  const tables = await tenantTables(client);

  const shape = await client.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
            a.attnotnull AS tenant_not_null, format_type(a.atttypid, a.atttypmod) AS tenant_type,
            (SELECT pa.attname FROM pg_index i JOIN pg_attribute pa ON pa.attrelid = i.indrelid AND pa.attnum = i.indkey[0]
              WHERE i.indrelid = c.oid AND i.indisprimary) AS pk_first_column,
            EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND (i.indisprimary OR i.indisunique) AND a.attnum = ANY (i.indkey))
              AS tenant_in_unique_key
       FROM pg_class c
       LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')`,
  );
  const byTable = new Map(shape.rows.map((row) => [String(row.relname), row]));
  for (const table of tables) {
    const row = byTable.get(table)!;
    if (row.tenant_type === null) {
      findings.push(`${table}: no tenant_id column`);
      continue;
    }
    if (row.tenant_type !== "text" || row.tenant_not_null !== true) findings.push(`${table}: tenant_id must be text NOT NULL`);
    if (row.relrowsecurity !== true) findings.push(`${table}: row-level security is not enabled`);
    if (row.relforcerowsecurity !== true) findings.push(`${table}: row-level security is not forced`);
    if (row.tenant_in_unique_key !== true) findings.push(`${table}: no primary or unique key includes tenant_id`);
    if (!(table in RELAY_TABLES) && row.pk_first_column !== "tenant_id") findings.push(`${table}: primary key must lead with tenant_id`);
    if (TENANT_TABLE_FIXTURES[table] === undefined) findings.push(`${table}: no isolation fixture, so the A/B matrix cannot attack it`);
  }

  for (const table of Object.keys(NON_TENANT_TABLES)) {
    const row = byTable.get(table);
    if (row === undefined || table === "schema_migration") continue;
    if (row.tenant_type !== null) findings.push(`${table}: listed as non-tenant but has a tenant_id column`);
    if (row.relrowsecurity !== true || row.relforcerowsecurity !== true) findings.push(`${table}: row-level security is not enabled and forced`);
  }

  const policies = await client.query(
    `SELECT tablename, policyname, permissive, roles::text[] AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public'`,
  );
  for (const policy of policies.rows) {
    const name = `${String(policy.tablename)}.${String(policy.policyname)}`;
    const roles = policy.roles as string[];
    if (roles.includes("public")) findings.push(`${name}: policy applies to PUBLIC`);
    if (roles.some((role) => !(APPLICATION_ROLES as readonly string[]).includes(role))) findings.push(`${name}: policy applies to an unreviewed role`);
    if (NON_TENANT_POLICIES[name] !== undefined) {
      if (policy.cmd !== NON_TENANT_POLICIES[name] || policy.with_check !== null) findings.push(`${name}: non-tenant policy changed`);
      continue;
    }
    if (RELAY_POLICIES[name] !== undefined) {
      if (policy.cmd !== RELAY_POLICIES[name] || !sameList(roles, ["sintius_dispatcher"])) findings.push(`${name}: relay policy changed`);
      continue;
    }
    if (policy.permissive !== "PERMISSIVE") continue; // A restrictive policy can only narrow access.
    const qualOk = policy.cmd === "INSERT" ? policy.qual === null : policy.qual === TENANT_PREDICATE;
    const checkOk = policy.cmd === "SELECT" || policy.cmd === "DELETE" ? policy.with_check === null : policy.with_check === TENANT_PREDICATE;
    if (!qualOk || !checkOk) findings.push(`${name}: policy is not bound to app.tenant_id`);
  }

  const privileges = await client.query(
    `SELECT c.relname, r.rolname, a.privilege_type, NULL::text AS column_name
       FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee
      WHERE c.relnamespace = 'public'::regnamespace AND r.rolname = ANY($1)
     UNION ALL
     SELECT c.relname, r.rolname, a.privilege_type, att.attname
       FROM pg_attribute att JOIN pg_class c ON c.oid = att.attrelid CROSS JOIN LATERAL aclexplode(att.attacl) a JOIN pg_roles r ON r.oid = a.grantee
      WHERE c.relnamespace = 'public'::regnamespace AND r.rolname = ANY($1)`,
    [APPLICATION_ROLES],
  );
  const actual = new Map<string, Map<string, Set<string>>>();
  const columnGrants = new Map<string, string[]>();
  for (const row of privileges.rows) {
    const role = String(row.rolname);
    const table = String(row.relname);
    if (row.column_name === null) {
      if (!actual.has(role)) actual.set(role, new Map());
      if (!actual.get(role)!.has(table)) actual.get(role)!.set(table, new Set());
      actual.get(role)!.get(table)!.add(String(row.privilege_type));
    } else {
      const key = `${role}|${table}|${String(row.privilege_type)}`;
      columnGrants.set(key, [...(columnGrants.get(key) ?? []), String(row.column_name)]);
    }
  }
  for (const [key, columns] of columnGrants) {
    const [role, table, privilege] = key.split("|") as [string, string, string];
    // A table-level grant also appears per column; only purely column-level grants are listed.
    if (actual.get(role)?.get(table)?.has(privilege) === true) continue;
    if (!actual.has(role)) actual.set(role, new Map());
    if (!actual.get(role)!.has(table)) actual.get(role)!.set(table, new Set());
    actual.get(role)!.get(table)!.add(`${privilege}(${columns.sort().join(",")})`);
  }
  for (const role of APPLICATION_ROLES) {
    const expected = PRIVILEGE_MANIFEST[role];
    const granted = actual.get(role) ?? new Map<string, Set<string>>();
    for (const table of new Set([...Object.keys(expected), ...granted.keys()])) {
      const want = [...(expected[table] ?? [])].sort();
      const have = [...(granted.get(table) ?? [])].sort();
      if (want.join(" ") !== have.join(" ")) findings.push(`${role} on ${table}: granted [${have.join(", ")}], reviewed [${want.join(", ")}]`);
    }
  }

  for (const role of APPLICATION_ROLES) {
    for (const table of Object.keys(NON_TENANT_TABLES)) {
      const writes = [...(actual.get(role)?.get(table) ?? [])].filter((privilege) => privilege !== "SELECT");
      if (writes.length > 0) findings.push(`${role} on ${table}: application roles may only read non-tenant tables`);
    }
  }

  const publicGrants = await client.query(
    `SELECT c.relname, a.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.relnamespace = 'public'::regnamespace AND a.grantee = 0`,
  );
  for (const row of publicGrants.rows) findings.push(`${String(row.relname)}: ${String(row.privilege_type)} granted to PUBLIC`);

  const roles = await client.query(
    `SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
            (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS memberships,
            (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owned_relations,
            (SELECT count(*)::int FROM pg_proc p WHERE p.proowner = r.oid) AS owned_functions
       FROM pg_roles r WHERE r.rolname = ANY($1)`,
    [APPLICATION_ROLES],
  );
  for (const role of APPLICATION_ROLES) {
    const row = roles.rows.find((candidate) => candidate.rolname === role);
    if (row === undefined) {
      findings.push(`${role}: role is missing`);
      continue;
    }
    for (const power of ["rolsuper", "rolbypassrls", "rolcreaterole", "rolcreatedb", "rolreplication"]) {
      if (row[power] === true) findings.push(`${role}: has ${power.replace(/^rol/, "")}`);
    }
    if (Number(row.memberships) > 0) findings.push(`${role}: is a member of another role and could inherit its access`);
    if (Number(row.owned_relations) > 0 || Number(row.owned_functions) > 0) findings.push(`${role}: owns database objects, and owners can change their security`);
  }

  const bypasses = await client.query(
    `SELECT 'view ' || c.relname AS object FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')
        AND NOT coalesce('security_invoker=true' = ANY (c.reloptions), false)
     UNION ALL
     SELECT 'function ' || p.proname FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
        AND (has_function_privilege('sintius_app', p.oid, 'EXECUTE') OR has_function_privilege('sintius_dispatcher', p.oid, 'EXECUTE'))`,
  );
  for (const row of bypasses.rows) findings.push(`${String(row.object)}: runs with its owner's rights and would bypass row-level security`);

  return findings;
}

// ---------------------------------------------------------------------------------------------
// 2. A/B attack matrix
// ---------------------------------------------------------------------------------------------

export type MatrixOutcome = "denied" | "isolated" | "reached" | "not granted" | "LEAK" | "CONTROL FAILED";

export interface MatrixCell {
  readonly role: string;
  readonly table: string;
  readonly context: "own tenant" | "no tenant";
  readonly operation: string;
  readonly outcome: MatrixOutcome;
  readonly detail?: string;
}

interface Attempt {
  readonly rowCount?: number;
  readonly count?: number;
  readonly code?: string;
  readonly message?: string;
}

let savepoints = 0;

/** Runs one statement under a savepoint with the given tenant bound (or none), then undoes it. */
async function attempt(client: SqlClient, tenant: string, sql: string, parameters: readonly unknown[] = []): Promise<Attempt> {
  const savepoint = `isolation_${++savepoints}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
    const result = await client.query(sql, parameters);
    const count = result.rows[0]?.n;
    return { rowCount: result.rowCount ?? 0, ...(count === undefined ? {} : { count: Number(count) }) };
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    return { code: String(failure.code), message: String(failure.message) };
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

function insertSql(table: string, row: Row): { sql: string; parameters: unknown[] } {
  const columns = Object.keys(row);
  return {
    sql: `INSERT INTO ${identifier(table)} (${columns.map(identifier).join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
    parameters: columns.map((column) => row[column]),
  };
}

const INSUFFICIENT_PRIVILEGE = "42501";

/** A refusal must be a privilege or RLS error (42501) or touch zero rows; anything else is a leak. */
function refused(result: Attempt, detail: string): { outcome: MatrixOutcome; detail?: string } {
  if (result.code === INSUFFICIENT_PRIVILEGE) return { outcome: "denied" };
  if (result.code !== undefined) return { outcome: "LEAK", detail: `${detail}: expected a refusal, got ${result.code} ${result.message}` };
  if ((result.count ?? result.rowCount) === 0) return { outcome: "isolated" };
  return { outcome: "LEAK", detail: `${detail}: reached ${result.count ?? result.rowCount} row(s)` };
}

/**
 * Attacks every table as the connected role, inside the caller's transaction (each attempt is
 * undone). `own` must have fixture rows in every table and `other` must be another seeded tenant.
 */
export async function runIsolationMatrix(
  client: SqlClient,
  options: { readonly tables: readonly string[]; readonly own: string; readonly other: string; readonly skip?: (table: string) => boolean },
): Promise<MatrixCell[]> {
  const cells: MatrixCell[] = [];
  const role = String((await client.query("SELECT current_user AS role")).rows[0]!.role);
  const { own, other } = options;
  let fresh = 0;

  for (const table of options.tables) {
    if (options.skip?.(table) === true) continue;
    const fixture = TENANT_TABLE_FIXTURES[table];
    const name = identifier(table);
    const record = (context: MatrixCell["context"], operation: string, result: { outcome: MatrixOutcome; detail?: string }) =>
      cells.push({ role, table, context, operation, ...result });
    if (fixture === undefined) {
      record("own tenant", "all", { outcome: "CONTROL FAILED", detail: "no fixture" });
      continue;
    }
    const can = async (privilege: string) =>
      (await client.query("SELECT has_table_privilege(current_user, $1, $2) AS ok", [table, privilege])).rows[0]!.ok === true;
    const updatable = (
      await client.query(
        `SELECT attname FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped
            AND has_column_privilege(current_user, attrelid, attnum, 'UPDATE') ORDER BY attnum`,
        [table],
      )
    ).rows.map((row) => String(row.attname));
    const canInsert = await can("INSERT");
    const canDelete = await can("DELETE");

    // Positive control: the role reaches its own rows wherever it has the privilege to.
    const ownRead = await attempt(client, own, `SELECT count(*)::int AS n FROM ${name} WHERE tenant_id = $1`, [own]);
    if (ownRead.code === INSUFFICIENT_PRIVILEGE) record("own tenant", "read own rows (control)", { outcome: "not granted" });
    else if ((ownRead.count ?? 0) >= 1) record("own tenant", "read own rows (control)", { outcome: "reached" });
    else record("own tenant", "read own rows (control)", { outcome: "CONTROL FAILED", detail: ownRead.message ?? "own fixture row not visible" });

    record("own tenant", "read other tenant", refused(await attempt(client, own, `SELECT count(*)::int AS n FROM ${name} WHERE tenant_id <> $1`, [own]), "read"));

    const foreign = insertSql(table, fixture(other, `atk${++fresh}`));
    const insertOther = await attempt(client, own, foreign.sql, foreign.parameters);
    record("own tenant", "insert for other tenant", insertOther.code === INSUFFICIENT_PRIVILEGE
      ? { outcome: "denied" }
      : { outcome: "LEAK", detail: `insert: ${insertOther.code ?? "succeeded"} ${insertOther.message ?? ""}`.trim() });
    if (canInsert) {
      // Control: the same row for the bound tenant passes RLS (success, or a later key/constraint error).
      const local = insertSql(table, fixture(own, `ctl${++fresh}`));
      const insertOwn = await attempt(client, own, local.sql, local.parameters);
      record("own tenant", "insert own row (control)", insertOwn.code === INSUFFICIENT_PRIVILEGE
        ? { outcome: "CONTROL FAILED", detail: insertOwn.message ?? "" }
        : { outcome: "reached" });
    }

    if (updatable.length > 0) {
      const column = identifier(updatable[0]!);
      record("own tenant", "update other tenant", refused(await attempt(client, own, `UPDATE ${name} SET ${column} = ${column} WHERE tenant_id = $1`, [other]), "update"));
      const updateOwn = await attempt(client, own, `UPDATE ${name} SET ${column} = ${column} WHERE tenant_id = $1`, [own]);
      // A trigger rejecting the no-op (for example an append-only guard) still proves the row was reached.
      const reached = (updateOwn.rowCount ?? 0) >= 1 || (updateOwn.code !== undefined && updateOwn.code !== INSUFFICIENT_PRIVILEGE);
      record("own tenant", "update own rows (control)", reached
        ? { outcome: "reached" }
        : { outcome: "CONTROL FAILED", detail: updateOwn.message ?? "own fixture row not updatable" });
    } else {
      record("own tenant", "update other tenant", { outcome: "not granted" });
    }
    if (updatable.includes("tenant_id")) {
      const move = await attempt(client, own, `UPDATE ${name} SET tenant_id = $2 WHERE tenant_id = $1`, [own, other]);
      record("own tenant", "move own row to other tenant", move.code === INSUFFICIENT_PRIVILEGE
        ? { outcome: "denied" }
        : { outcome: "LEAK", detail: `move: ${move.code ?? `updated ${move.rowCount} row(s)`} ${move.message ?? ""}`.trim() });
    }
    record("own tenant", "delete other tenant", canDelete
      ? refused(await attempt(client, own, `DELETE FROM ${name} WHERE tenant_id = $1`, [other]), "delete")
      : { outcome: "not granted" });

    // No tenant bound: nothing is readable, writable or deletable.
    record("no tenant", "read", refused(await attempt(client, "", `SELECT count(*)::int AS n FROM ${name}`), "read"));
    if (canInsert) {
      const orphan = insertSql(table, fixture(own, `nctx${++fresh}`));
      const insertNone = await attempt(client, "", orphan.sql, orphan.parameters);
      record("no tenant", "insert", insertNone.code === INSUFFICIENT_PRIVILEGE
        ? { outcome: "denied" }
        : { outcome: "LEAK", detail: `insert: ${insertNone.code ?? "succeeded"} ${insertNone.message ?? ""}`.trim() });
    }
    if (updatable.length > 0) {
      const column = identifier(updatable[0]!);
      record("no tenant", "update", refused(await attempt(client, "", `UPDATE ${name} SET ${column} = ${column}`), "update"));
    }
    if (canDelete) record("no tenant", "delete", refused(await attempt(client, "", `DELETE FROM ${name}`), "delete"));
  }
  return cells;
}

export function failures(cells: readonly MatrixCell[]): MatrixCell[] {
  return cells.filter((cell) => cell.outcome === "LEAK" || cell.outcome === "CONTROL FAILED");
}

/** A compact table for test diagnostics and release evidence. */
export function formatMatrix(cells: readonly MatrixCell[]): string {
  return cells
    .map((cell) => `${cell.role.padEnd(18)} ${cell.table.padEnd(24)} ${cell.context.padEnd(10)} ${cell.operation.padEnd(30)} ${cell.outcome}${cell.detail === undefined ? "" : ` (${cell.detail})`}`)
    .join("\n");
}

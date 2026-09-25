import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";
import { PostgresSecurityPersistence } from "../../modules/identity-tenant/infrastructure/postgres/security-persistence.ts";
import { PlatformProblem } from "../../platform/problem-model/src/index.ts";
import { runTenantJob, tenantId, type TenantId } from "../../platform/tenant-context/src/index.ts";
import { testPrincipal } from "../support/authenticated-principal.ts";
import {
  RELAY_TABLES,
  TENANT_TABLE_FIXTURES,
  auditIsolationCatalog,
  failures,
  formatMatrix,
  insertFixture,
  removeTenants,
  runIsolationMatrix,
  seedTenants,
  tenantTables,
  type MatrixCell,
  type SqlClient,
} from "./support/tenant-isolation.ts";

/**
 * Release gate for tenant isolation (P0-009). It runs in the Release gate CI job, so any failure
 * here blocks merging to master. Every table in the schema is covered from the catalog, not from a
 * hand-kept list: a new table without RLS, a policy or a fixture fails the gate.
 */

const { Pool, Client } = pg;
const adminUrl = process.env.SINTIUS_MIGRATION_DATABASE_URL ?? "postgresql://sintius_admin@127.0.0.1:54329/sintius";
const appUrl = process.env.SINTIUS_DATABASE_URL ?? "postgresql://sintius_app@127.0.0.1:54329/sintius";
const dispatcherUrl = process.env.SINTIUS_DISPATCHER_DATABASE_URL ?? "postgresql://sintius_dispatcher@127.0.0.1:54329/sintius";
const admin = new Pool({ connectionString: adminUrl, max: 2 });
const A = tenantId("tenant_iso_A");
const B = tenantId("tenant_iso_B");

const code = (expected: string) => (error: unknown) => error instanceof PlatformProblem && error.problem.code === expected;

async function withClient<T>(url: string, work: (client: SqlClient) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Runs the matrix in one transaction that is always rolled back, from each tenant's side. */
async function matrixFor(url: string, skip?: (table: string) => boolean): Promise<MatrixCell[]> {
  const tables = await tenantTables(admin);
  return withClient(url, async (client) => {
    const cells: MatrixCell[] = [];
    for (const [own, other] of [[A, B], [B, A]] as const) {
      await client.query("BEGIN");
      try {
        cells.push(...(await runIsolationMatrix(client, { tables, own, other, ...(skip === undefined ? {} : { skip }) })));
      } finally {
        await client.query("ROLLBACK");
      }
    }
    return cells;
  });
}

before(async () => {
  await removeTenants(admin, [A, B]);
  await seedTenants(admin, [A, B]);
});

after(async () => {
  await removeTenants(admin, [A, B]);
  await admin.end();
});

test("TC-017-03-01 the catalog puts every tenant table behind forced RLS with tenant-bound policies, reviewed grants and no bypass", async () => {
  const findings = await auditIsolationCatalog(admin);
  assert.deepEqual(findings, [], `Isolation catalog findings:\n${findings.join("\n")}`);
  const tables = await tenantTables(admin);
  assert.ok(tables.length >= 12, "the audit covered the whole schema");
  assert.deepEqual(tables.filter((table) => TENANT_TABLE_FIXTURES[table] === undefined), []);
});

test("TC-001-04-01 / TC-017-03-01 tenant A/B matrix: every table refuses cross-tenant reads, inserts, updates, re-tenanting and deletes", async (t) => {
  const tables = await tenantTables(admin);
  const app = await matrixFor(appUrl);
  // The dispatcher is a cross-tenant relay on the reviewed relay tables only; everywhere else it is isolated too.
  const dispatcher = await matrixFor(dispatcherUrl, (table) => table in RELAY_TABLES);
  const cells = [...app, ...dispatcher];
  t.diagnostic(`\n${formatMatrix(cells)}`);

  assert.deepEqual(failures(cells), [], `Isolation matrix failures:\n${formatMatrix(failures(cells))}`);
  // The matrix attacked every table, and the controls prove refusals come from isolation, not broken fixtures.
  assert.deepEqual([...new Set(app.map((cell) => cell.table))].sort(), [...tables].sort());
  for (const table of ["tenant", "tenant_role", "approval_request", "idempotency_record", "foundation_proof_record", "inbox_record"]) {
    assert.ok(app.some((cell) => cell.table === table && cell.operation === "read own rows (control)" && cell.outcome === "reached"), `${table} own rows reachable`);
  }
  for (const table of ["tenant", "tenant_role", "tenant_role_assignment", "idempotency_record"]) {
    assert.ok(app.some((cell) => cell.table === table && cell.operation === "move own row to other tenant" && cell.outcome === "denied"), `${table} rows cannot be re-tenanted`);
  }
  assert.ok(app.some((cell) => cell.table === "audit_event" && cell.operation === "insert own row (control)" && cell.outcome === "reached"));
  assert.ok(dispatcher.some((cell) => cell.table === "audit_event" && cell.operation === "insert for other tenant" && cell.outcome === "denied"));
});

test("TC-001-04-02 missing database tenant context fails closed on every table and never carries over between transactions", async () => {
  const tables = await tenantTables(admin);
  await withClient(appUrl, async (client) => {
    assert.equal((await client.query("SELECT current_setting('app.tenant_id', true) AS tenant")).rows[0]!.tenant, null, "a fresh connection has no tenant");
    for (const table of tables) {
      await client.query("BEGIN");
      try {
        const read = await client.query(`SELECT count(*)::int AS n FROM "${table}"`).then(
          (result) => ({ rows: Number(result.rows[0]!.n) }),
          (error: { code?: string }) => ({ code: error.code }),
        );
        assert.ok("code" in read ? read.code === "42501" : read.rows === 0, `${table}: read without a tenant saw rows`);
      } finally {
        await client.query("ROLLBACK");
      }
      await client.query("BEGIN");
      try {
        await assert.rejects(insertFixture(client, table, TENANT_TABLE_FIXTURES[table]!(A, "nullctx")), { code: "42501" }, `${table}: insert without a tenant`);
      } finally {
        await client.query("ROLLBACK");
      }
    }

    // The binding is transaction-local: a committed transaction for tenant A leaves nothing behind.
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [A]);
    assert.equal(Number((await client.query("SELECT count(*)::int AS n FROM tenant")).rows[0]!.n), 1);
    await client.query("COMMIT");
    assert.equal(Number((await client.query("SELECT count(*)::int AS n FROM tenant")).rows[0]!.n), 0);
  });

  // Repositories refuse to open a transaction at all without a trusted tenant context.
  const persistence = new PostgresSecurityPersistence({ connectionString: appUrl, maxConnections: 1 });
  try {
    await assert.rejects(persistence.runInTransaction({ correlationId: "corr_iso" }, async () => undefined), code("tenant_context_missing"));
  } finally {
    await persistence.close();
  }
});

test("TC-017-03-02 an injected isolation regression fails the gate", async () => {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    // Five independent regressions, each of the kind a careless migration could introduce.
    await client.query("CREATE POLICY isolation_regression ON foundation_proof_record FOR SELECT TO sintius_app USING (true)");
    await client.query("ALTER TABLE tenant_role NO FORCE ROW LEVEL SECURITY");
    await client.query("CREATE TABLE isolation_regression (id integer PRIMARY KEY)");
    await client.query("GRANT DELETE ON audit_event TO sintius_app");
    await client.query("ALTER ROLE sintius_dispatcher BYPASSRLS");

    const findings = await auditIsolationCatalog(client);
    for (const expected of [
      "foundation_proof_record.isolation_regression: policy is not bound to app.tenant_id",
      "tenant_role: row-level security is not forced",
      "isolation_regression: no tenant_id column",
      "sintius_app on audit_event: granted [DELETE, INSERT], reviewed [INSERT]",
      "sintius_dispatcher: has bypassrls",
    ]) {
      assert.ok(findings.includes(expected), `expected finding "${expected}" in:\n${findings.join("\n")}`);
    }

    // The matrix catches the leaking policy by behavior as well, attacking as the application role.
    await client.query("SET LOCAL ROLE sintius_app");
    const cells = await runIsolationMatrix(client, { tables: ["foundation_proof_record", "audit_event"], own: A, other: B });
    const leaks = failures(cells).map((cell) => `${cell.table}: ${cell.operation}`);
    assert.ok(leaks.includes("foundation_proof_record: read other tenant"), `expected a read leak in:\n${formatMatrix(cells)}`);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  assert.deepEqual(await auditIsolationCatalog(admin), [], "the injected regressions were rolled back");
});

test("worker context: a scheduled job's database work is bound to its own tenant", async () => {
  const persistence = new PostgresSecurityPersistence({ connectionString: appUrl, maxConnections: 2 });
  const holders = (tenant: TenantId, asked: TenantId) =>
    runTenantJob(
      { jobName: "isolation.check", runId: `run_${tenant}`, principal: testPrincipal([tenant], { actor: "svc_scheduler", kind: "workload" }), tenantId: tenant, tenantState: "ACTIVE" },
      () => persistence.runInTransaction({ correlationId: "unused" }, (unitOfWork) => unitOfWork.assignments.countActiveHolders(asked, "role_iso")),
    );
  try {
    assert.deepEqual(await Promise.all([holders(A, A), holders(B, B)]), [1, 1]);
    await assert.rejects(holders(A, B), code("tenant_context_mismatch"), "a job for tenant A cannot ask about tenant B");
  } finally {
    await persistence.close();
  }
});

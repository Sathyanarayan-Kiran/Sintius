import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.SINTIUS_MIGRATION_DATABASE_URL ?? "postgresql://sintius_admin@127.0.0.1:54329/sintius";
const migrationsDirectory = resolve(import.meta.dirname, "../../modules/identity-tenant/infrastructure/postgres/migrations");
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(736468487)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        migration_name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    const migrationNames = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
    for (const migrationName of migrationNames) {
      const sql = await readFile(resolve(migrationsDirectory, migrationName), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query("SELECT checksum FROM schema_migration WHERE migration_name = $1", [migrationName]);
      if (existing.rowCount === 1) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${migrationName}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migration (migration_name, checksum) VALUES ($1, $2)", [migrationName, checksum]);
        await client.query("COMMIT");
        process.stdout.write(`Applied ${migrationName}\n`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(736468487)").catch(() => undefined);
    client.release();
  }
} finally {
  await pool.end();
}

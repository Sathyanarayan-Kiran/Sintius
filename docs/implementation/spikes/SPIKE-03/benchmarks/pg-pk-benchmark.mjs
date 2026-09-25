import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { generateUuidV7 } from "../../../../../platform/id/src/uuid7.ts";

/**
 * SPIKE-03 (decision D7): a short, reproducible insert/index-locality comparison between the
 * current scheme (a caller-chosen or UUIDv4-shaped text primary key, uncorrelated with insertion
 * order) and the proposed scheme (a UUIDv7 primary key, time-ordered by construction). It is spike
 * evidence for one design decision, not a load test and not production benchmarking code — it runs
 * against whatever PostgreSQL instance SINTIUS_MIGRATION_DATABASE_URL points at (a throwaway
 * `sintius_admin` role that can create and drop tables) and cleans up after itself.
 *
 * Usage: node pg-pk-benchmark.mjs [rowCount]
 */

const rowCount = Number(process.argv[2] ?? "200000");
const connectionString = process.env.SINTIUS_MIGRATION_DATABASE_URL ?? "postgresql://sintius_admin@127.0.0.1:54329/sintius";

const { Client } = pg;
const client = new Client({ connectionString });

function randomTextId() {
  // Shaped like today's caller-chosen slugs / evt_<uuid> IDs: fixed length, but its bytes carry no
  // relationship to insertion order, which is exactly the property SPIKE-03 is measuring the cost of.
  return randomUUID();
}

async function timedBulkInsert(table, idColumnType, ids) {
  await client.query(`CREATE UNLOGGED TABLE ${table} (id ${idColumnType} PRIMARY KEY, payload text NOT NULL)`);
  const startedAt = performance.now();
  const batchSize = 1000;
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize);
    const values = batch.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(",");
    const parameters = batch.flatMap((id) => [id, randomBytes(32).toString("hex")]);
    await client.query(`INSERT INTO ${table} (id, payload) VALUES ${values}`, parameters);
  }
  const insertMilliseconds = performance.now() - startedAt;
  await client.query(`VACUUM (ANALYZE) ${table}`);
  const sizeResult = await client.query("SELECT pg_relation_size($1::regclass) AS bytes", [`${table}_pkey`]);
  const tableSizeResult = await client.query("SELECT pg_total_relation_size($1::regclass) AS bytes", [table]);
  return {
    insertMilliseconds,
    indexBytes: Number(sizeResult.rows[0].bytes),
    totalRelationBytes: Number(tableSizeResult.rows[0].bytes),
  };
}

async function main() {
  await client.connect();
  await client.query("DROP TABLE IF EXISTS bench_text_pk, bench_uuid7_pk");
  try {
    console.log(`SPIKE-03: ${rowCount} rows, one 1000-row batch INSERT at a time, then VACUUM (ANALYZE).`);

    const textIds = Array.from({ length: rowCount }, randomTextId);
    const textResult = await timedBulkInsert("bench_text_pk", "text", textIds);
    console.log(`text (UUIDv4-shaped, uncorrelated with insert order): ${textResult.insertMilliseconds.toFixed(0)} ms insert, ${(textResult.indexBytes / 1024 / 1024).toFixed(2)} MiB index, ${(textResult.totalRelationBytes / 1024 / 1024).toFixed(2)} MiB total`);

    // Generated in strictly increasing insertion order, as real UUIDv7 primary keys would be.
    const uuid7Ids = Array.from({ length: rowCount }, () => generateUuidV7());
    const uuid7Result = await timedBulkInsert("bench_uuid7_pk", "uuid", uuid7Ids);
    console.log(`uuid (UUIDv7, time-ordered):                          ${uuid7Result.insertMilliseconds.toFixed(0)} ms insert, ${(uuid7Result.indexBytes / 1024 / 1024).toFixed(2)} MiB index, ${(uuid7Result.totalRelationBytes / 1024 / 1024).toFixed(2)} MiB total`);

    const result = {
      captured_at: new Date().toISOString().slice(0, 10),
      row_count: rowCount,
      environment: { postgres_version: (await client.query("SHOW server_version")).rows[0].server_version },
      results: [
        { candidate: "text (UUIDv4-shaped, uncorrelated)", column_type: "text", ...textResult },
        { candidate: "uuid (UUIDv7, time-ordered)", column_type: "uuid", ...uuid7Result },
      ],
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.query("DROP TABLE IF EXISTS bench_text_pk, bench_uuid7_pk");
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

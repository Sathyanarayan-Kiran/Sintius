import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Runs one named test suite with Node's test runner. When SINTIUS_TEST_REPORT_DIR is set (CI), a
 * TAP report is also written there as release-gate evidence. Cross-platform: no shell expansion.
 */
const SUITES = {
  unit: { files: ["tests/all.test.ts"], flags: [] },
  // Each PostgreSQL file shares one database, so files run one at a time.
  postgres: {
    files: [
      "modules/identity-tenant/tests/postgres-persistence.test.ts",
      "platform/outbox/tests/postgres-outbox.test.ts",
      "platform/outbox/tests/postgres-delivery.test.ts",
      "tests/integration/phase0-release-gate.test.ts",
      "apps/api/tests/postgres-http.test.ts",
    ],
    flags: ["--test-concurrency=1"],
  },
};

const name = process.argv[2];
const suite = SUITES[name];
if (suite === undefined) {
  console.error(`Unknown suite "${name}". Use one of: ${Object.keys(SUITES).join(", ")}.`);
  process.exit(2);
}

const reportDirectory = process.env.SINTIUS_TEST_REPORT_DIR;
const reporters = [];
if (reportDirectory) {
  mkdirSync(reportDirectory, { recursive: true });
  reporters.push(
    "--test-reporter=spec", "--test-reporter-destination=stdout",
    "--test-reporter=tap", `--test-reporter-destination=${resolve(reportDirectory, `${name}.tap`)}`,
  );
}

const result = spawnSync(process.execPath, ["--test", ...suite.flags, ...reporters, ...suite.files], { stdio: "inherit" });
process.exit(result.status ?? 1);

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadImplementationEvidence } from "./implementation-evidence.mjs";

/**
 * CI step after the test suites: re-validates every implementation-evidence claim against the TAP
 * reports of this run, so a claimed requirement whose tests did not pass fails the build.
 */
const root = resolve(import.meta.dirname, "../..");
const reportDirectory = process.env.SINTIUS_TEST_REPORT_DIR;
if (!reportDirectory) {
  console.error("Set SINTIUS_TEST_REPORT_DIR to the directory holding this run's TAP reports.");
  process.exit(2);
}
const register = JSON.parse(readFileSync(resolve(root, "docs/implementation/requirement-register.json"), "utf8"));
const evidence = loadImplementationEvidence(root, register.requirements, { reportDirectory: resolve(root, reportDirectory) });
console.log(`Implementation evidence verified against test reports: ${evidence.size} requirement(s), every mapped test passed in this run.`);

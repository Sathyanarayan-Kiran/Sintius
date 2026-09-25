import { resolve } from "node:path";
import { runStoryDefinitionOfDoneCheck } from "./story-dod.ts";
import { runTestStrategyCheck } from "./test-strategy.ts";

/**
 * CI step (US-MSR-103-DOD, US-MSR-099-TEST-STRATEGY): re-verifies both pipeline controls against
 * this run's TAP reports, the same way check-evidence.mjs re-verifies implementation evidence. A
 * story dishonestly marked `implemented`, or a quality-suite class silently missing, fails the gate.
 */
const root = resolve(import.meta.dirname, "../..");
const reportDirectory = process.env.SINTIUS_TEST_REPORT_DIR;
if (!reportDirectory) {
  console.error("Set SINTIUS_TEST_REPORT_DIR to the directory holding this run's TAP reports.");
  process.exit(2);
}

const dod = runStoryDefinitionOfDoneCheck(root, { reportDirectory });
const strategy = runTestStrategyCheck(root, { reportDirectory });
const failures = [...dod.failures, ...strategy.failures];
if (failures.length > 0) {
  throw new Error(`Pipeline controls failed:\n- ${failures.join("\n- ")}`);
}
console.log("Pipeline controls verified against this run: Definition of Done and test strategy gates pass.");

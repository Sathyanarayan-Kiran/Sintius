import assert from "node:assert/strict";
import test from "node:test";
import { checkStoryDefinitionOfDone, type Roadmap, type RoadmapStory } from "../story-dod.ts";

/**
 * US-MSR-103-DOD (master specification §103): "a feature is not complete merely because its
 * interface exists"; a story marked `implemented` must have every mapped test passing and, when
 * this run supplies TAP reports, actually passing in this run — and a financially material story
 * must additionally show reconciliation evidence or a reviewed rationale for why none applies.
 */

function roadmapWith(story: RoadmapStory, epicId = "SUB-E001"): Roadmap {
  return { epics: [{ id: epicId, stories: [story] }] };
}

test("TC-US-MSR-103-DOD-01 pipeline rejects a completed story with missing required evidence", () => {
  const missingTest = roadmapWith({ id: "US-X-01", implementation: "implemented", tests: [{ id: "TC-X-01-01", status: "not_run", type: "unit" }] });
  const { failures: notPassing } = checkStoryDefinitionOfDone(missingTest, { automated: new Set(["TC-X-01-01"]) });
  assert.ok(notPassing.some((failure) => failure.includes("TC-X-01-01") && failure.includes("not passing")), "a test marked not_run must block completion");

  const noAutomation = roadmapWith({ id: "US-X-02", implementation: "implemented", tests: [{ id: "TC-X-02-01", status: "passing", type: "unit" }] });
  const { failures: notAutomated } = checkStoryDefinitionOfDone(noAutomation, { automated: new Set() });
  assert.ok(notAutomated.some((failure) => failure.includes("TC-X-02-01") && failure.includes("no automated test")), "a passing status with no real automated test must block completion");

  const didNotRunInCi = roadmapWith({ id: "US-X-03", implementation: "implemented", tests: [{ id: "TC-X-03-01", status: "passing", type: "unit" }] });
  const { failures: notInReports } = checkStoryDefinitionOfDone(didNotRunInCi, {
    automated: new Set(["TC-X-03-01"]),
    reports: { passed: new Set(), failed: new Set(["TC-X-03-01"]) },
  });
  assert.ok(notInReports.some((failure) => failure.includes("TC-X-03-01") && failure.includes("did not pass")), "a test that failed in this run's reports must block completion even if the roadmap says passing");

  const noTests = roadmapWith({ id: "US-X-04", implementation: "implemented", tests: [] });
  const { failures: emptyTests } = checkStoryDefinitionOfDone(noTests, { automated: new Set() });
  assert.ok(emptyTests.some((failure) => failure.includes("US-X-04") && failure.includes("no tests")), "a story with no tests at all cannot be complete");

  const clean = roadmapWith({ id: "US-X-05", implementation: "implemented", tests: [{ id: "TC-X-05-01", status: "passing", type: "unit" }] });
  const { failures: none } = checkStoryDefinitionOfDone(clean, { automated: new Set(["TC-X-05-01"]), reports: { passed: new Set(["TC-X-05-01"]), failed: new Set() } });
  assert.deepEqual(none, [], "a genuinely complete story must not be rejected");

  const notImplemented = roadmapWith({ id: "US-X-06", implementation: "in_progress", tests: [{ id: "TC-X-06-01", status: "not_run", type: "unit" }] });
  const { failures: skipped } = checkStoryDefinitionOfDone(notImplemented, { automated: new Set() });
  assert.deepEqual(skipped, [], "a story not claimed implemented is out of scope for this gate");
});

test("TC-US-MSR-103-DOD-02 financial story completion requires reconciliation evidence", () => {
  const withoutReconciliation = roadmapWith(
    { id: "US-BILLING-01", implementation: "implemented", tests: [{ id: "TC-BILLING-01-01", status: "passing", type: "unit" }] },
    "SUB-E007",
  );
  const { failures: missing } = checkStoryDefinitionOfDone(withoutReconciliation, { automated: new Set(["TC-BILLING-01-01"]) });
  assert.ok(missing.some((failure) => failure.includes("US-BILLING-01") && failure.includes("reconciliation")), "a financially material story needs reconciliation evidence or a reviewed rationale");

  const withReconciliationTest = roadmapWith(
    {
      id: "US-BILLING-02",
      implementation: "implemented",
      tests: [
        { id: "TC-BILLING-02-01", status: "passing", type: "unit" },
        { id: "TC-BILLING-02-02", status: "passing", type: "reconciliation" },
      ],
    },
    "SUB-E007",
  );
  const { failures: satisfiedByTest } = checkStoryDefinitionOfDone(withReconciliationTest, { automated: new Set(["TC-BILLING-02-01", "TC-BILLING-02-02"]) });
  assert.deepEqual(satisfiedByTest, [], "a passing reconciliation-typed test satisfies the requirement");

  const withRationale = roadmapWith(
    {
      id: "US-BILLING-03",
      implementation: "implemented",
      tests: [{ id: "TC-BILLING-03-01", status: "passing", type: "unit" }],
      reconciliationRationale: "This story only renders a read-only catalog screen; it posts no ledger entry and moves no money, so no reconciliation test applies.",
    },
    "SUB-E007",
  );
  const { failures: satisfiedByRationale } = checkStoryDefinitionOfDone(withRationale, { automated: new Set(["TC-BILLING-03-01"]) });
  assert.deepEqual(satisfiedByRationale, [], "a reviewed rationale satisfies the requirement when no reconciliation test applies");

  const nonFinancial = roadmapWith(
    { id: "US-PLATFORM-01", implementation: "implemented", tests: [{ id: "TC-PLATFORM-01-01", status: "passing", type: "unit" }] },
    "SUB-E001",
  );
  const { failures: exempt } = checkStoryDefinitionOfDone(nonFinancial, { automated: new Set(["TC-PLATFORM-01-01"]) });
  assert.deepEqual(exempt, [], "a story in a non-financial epic is not subject to the reconciliation rule");
});

import assert from "node:assert/strict";
import test from "node:test";
import type { Roadmap } from "../story-dod.ts";
import { checkTestStrategy, SUITE_CLASSES } from "../test-strategy.ts";

/**
 * US-MSR-099-TEST-STRATEGY (master specification §99; docs/pre-implementation/24-testing-strategy.md
 * §16): every quality-suite class the strategy names is either demonstrated by a real, automated,
 * passing test, or is explicitly recorded as not yet applicable with a reviewed reason — never
 * silently absent from the pipeline's own accounting of itself.
 */

function fixtureRoadmap(): Roadmap {
  return {
    epics: [
      {
        id: "SUB-E001",
        stories: [
          {
            id: "US-FIXTURE-01",
            tests: [
              { id: "TC-FIXTURE-UNIT", status: "passing", type: "unit" },
              { id: "TC-FIXTURE-INTEGRATION", status: "passing", type: "integration" },
              { id: "TC-FIXTURE-CONTRACT", status: "passing", type: "contract" },
              { id: "TC-FIXTURE-SECURITY", status: "passing", type: "security" },
              { id: "TC-FIXTURE-CHAOS", status: "passing", type: "chaos" },
              { id: "TC-FIXTURE-NOT-RUN", status: "not_run", type: "unit" },
            ],
          },
        ],
      },
    ],
  };
}

test("TC-US-MSR-099-TEST-STRATEGY-01 pipeline requires every applicable quality-suite class", () => {
  const fullyAutomated = new Set([
    "TC-FIXTURE-UNIT",
    "TC-FIXTURE-INTEGRATION",
    "TC-FIXTURE-CONTRACT",
    "TC-FIXTURE-SECURITY",
    "TC-FIXTURE-CHAOS",
    "TC-PLATFORM-MONEY-GOLDEN-01",
    "TC-017-03-01",
    "TC-017-03-02",
  ]);
  const { failures: clean } = checkTestStrategy({ roadmap: fixtureRoadmap(), automated: fullyAutomated });
  assert.deepEqual(clean, [], "every applicable suite class has real, automated, passing evidence in the fixture");

  const missingUnit = checkTestStrategy({
    roadmap: { epics: [{ id: "SUB-E001", stories: [{ id: "US-FIXTURE-02", tests: [] }] }] },
    automated: new Set(),
  });
  assert.ok(missingUnit.failures.some((failure) => failure.startsWith("unit ") && failure.includes("no passing roadmap test")), "an applicable class with no passing test at all must fail");

  const untitled = checkTestStrategy({ roadmap: fixtureRoadmap(), automated: new Set(["TC-FIXTURE-INTEGRATION", "TC-FIXTURE-CONTRACT", "TC-FIXTURE-SECURITY", "TC-FIXTURE-CHAOS"]) });
  assert.ok(
    untitled.failures.some((failure) => failure.startsWith("unit ") && failure.includes("none of its candidate tests") && failure.includes("TC-FIXTURE-UNIT")),
    "an applicable class whose only candidate test has no real automated test must fail",
  );

  const failedInCi = checkTestStrategy({
    roadmap: fixtureRoadmap(),
    automated: fullyAutomated,
    reports: { passed: new Set(["TC-FIXTURE-INTEGRATION", "TC-FIXTURE-CONTRACT", "TC-FIXTURE-SECURITY", "TC-FIXTURE-CHAOS", "TC-PLATFORM-MONEY-GOLDEN-01", "TC-017-03-01", "TC-017-03-02"]), failed: new Set(["TC-FIXTURE-UNIT"]) },
  });
  assert.ok(
    failedInCi.failures.some((failure) => failure.startsWith("unit ") && failure.includes("none of its candidate tests") && failure.includes("TC-FIXTURE-UNIT")),
    "a class whose only candidate test failed in this run's reports must fail even though the roadmap says passing",
  );

  const everyDeclaredClassHandled = SUITE_CLASSES.every((suiteClass) => suiteClass.applicable || (typeof suiteClass.rationale === "string" && suiteClass.rationale.trim().length >= 20));
  assert.ok(everyDeclaredClassHandled, "every suite class in the declared taxonomy is either applicable or carries a reviewed rationale");
});

test("TC-US-MSR-099-TEST-STRATEGY-02 golden-dataset determinism and provenance check is itself a required, applicable class", () => {
  const goldenClass = SUITE_CLASSES.find((suiteClass) => suiteClass.id === "golden");
  assert.ok(goldenClass?.applicable, "the golden pricing/billing class must be applicable given platform/money already exists");
  assert.deepEqual(goldenClass?.evidenceTestIds, ["TC-PLATFORM-MONEY-GOLDEN-01"], "the golden class must point at the platform/money golden-dataset determinism test");

  const withoutGoldenEvidence = checkTestStrategy({ roadmap: fixtureRoadmap(), automated: new Set(["TC-FIXTURE-UNIT", "TC-FIXTURE-INTEGRATION", "TC-FIXTURE-CONTRACT", "TC-FIXTURE-SECURITY", "TC-FIXTURE-CHAOS"]) });
  assert.ok(withoutGoldenEvidence.failures.some((failure) => failure.startsWith("golden ")), "the golden class must fail when its determinism test has no real automated coverage");

  const withGoldenEvidence = checkTestStrategy({
    roadmap: fixtureRoadmap(),
    automated: new Set(["TC-FIXTURE-UNIT", "TC-FIXTURE-INTEGRATION", "TC-FIXTURE-CONTRACT", "TC-FIXTURE-SECURITY", "TC-FIXTURE-CHAOS", "TC-PLATFORM-MONEY-GOLDEN-01", "TC-017-03-01", "TC-017-03-02"]),
  });
  assert.ok(withGoldenEvidence.failures.every((failure) => !failure.startsWith("golden ")), "the golden class must pass once its determinism test is automated");
});

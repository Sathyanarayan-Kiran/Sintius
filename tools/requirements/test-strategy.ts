import { resolve } from "node:path";
import { loadRoadmap, type Roadmap } from "./story-dod.ts";
import { automatedTestIds, tapResults, type TapResults } from "./test-inventory.ts";

/**
 * US-MSR-099-TEST-STRATEGY: docs/pre-implementation/24-testing-strategy.md §16 names the platform's
 * quality-suite classes and their gating tier. A class becomes "applicable" once Phase 0 scope
 * actually needs it (a story of that phase uses it, or the platform layer it protects exists); an
 * applicable class must have real, automated, passing coverage, and a class that is not yet
 * applicable must say so explicitly with a reviewed reason, never be silently absent. Reviewed
 * against §16 on 2026-09-25 for the modules that exist at Phase 0 exit (platform, identity-tenant,
 * audit-governance, foundation-proof): no pricing, rating, billing, payments, collections, revenue,
 * usage or UI module exists yet, so their suite classes are not yet applicable.
 */
export interface SuiteClass {
  readonly id: string;
  readonly name: string;
  readonly applicable: boolean;
  readonly roadmapTypes?: readonly string[];
  readonly evidenceTestIds?: readonly string[];
  readonly rationale?: string;
}

export const SUITE_CLASSES: readonly SuiteClass[] = Object.freeze([
  { id: "unit", name: "Unit", applicable: true, roadmapTypes: ["unit"] },
  { id: "integration", name: "Integration", applicable: true, roadmapTypes: ["integration", "concurrency"] },
  { id: "contract", name: "Contract", applicable: true, roadmapTypes: ["contract"] },
  {
    id: "golden",
    name: "Golden pricing/billing",
    applicable: true,
    // No pricing/rating/billing module exists yet; platform/money (proration, D6, and largest-
    // remainder allocation, D5) is the deterministic financial-calculation surface that does, so
    // the golden-dataset rule already applies to it (§5: "for financial calculations use
    // deterministic golden datasets").
    evidenceTestIds: ["TC-PLATFORM-MONEY-GOLDEN-01"],
  },
  {
    id: "property",
    name: "Property-based",
    applicable: false,
    rationale: "No pricing/rating/billing module exists yet; the deliverable 12 §23 property suite has nothing to generate cases against.",
  },
  {
    id: "provider-simulation",
    name: "Provider simulation",
    applicable: false,
    rationale: "No payment or tax provider adapter exists yet (Stripe scope is an open item awaiting the Product Owner).",
  },
  { id: "tenant-isolation", name: "Tenant isolation", applicable: true, evidenceTestIds: ["TC-017-03-01", "TC-017-03-02"] },
  { id: "load", name: "Load", applicable: false, rationale: "Scheduled-tier only (§9); no deployed reference environment exists yet to load-test." },
  { id: "failover", name: "Failover", applicable: true, roadmapTypes: ["chaos"] },
  { id: "security", name: "Security", applicable: true, roadmapTypes: ["security"] },
  {
    id: "reconciliation",
    name: "Reconciliation",
    applicable: false,
    rationale: "No invoice, receivable or journal module exists yet (Phase 1+); nothing to reconcile.",
  },
  { id: "accessibility", name: "Accessibility", applicable: false, rationale: "No UI screen exists yet; §13 scopes this to rendered screens." },
  { id: "backup-restore", name: "Backup and restore", applicable: false, rationale: "Scheduled-tier only (§14); no deployed environment exists yet to drill against." },
  {
    id: "end-to-end",
    name: "End-to-end acceptance",
    applicable: false,
    rationale: "The PRD §11 scenario needs subscriptions, usage and billing (Phase 1+), which do not exist yet.",
  },
]);

export interface TestStrategyOptions {
  readonly automated?: ReadonlySet<string>;
  readonly roadmap?: Roadmap;
  readonly reports?: TapResults;
}

export interface TestStrategyResult {
  readonly failures: readonly string[];
}

/**
 * Checks that every applicable class has real, automated, passing evidence and every inapplicable
 * class carries a reviewed rationale (never silently absent from the check itself).
 */
export function checkTestStrategy(options: TestStrategyOptions = {}): TestStrategyResult {
  const automated = options.automated ?? new Set<string>();
  const roadmap = options.roadmap;
  const reports = options.reports;
  const failures: string[] = [];

  const passingRoadmapTestIdsByType = new Map<string, string[]>();
  if (roadmap !== undefined) {
    for (const epic of roadmap.epics) {
      for (const story of epic.stories) {
        for (const test of story.tests) {
          if (test.status !== "passing") continue;
          if (!passingRoadmapTestIdsByType.has(test.type)) passingRoadmapTestIdsByType.set(test.type, []);
          passingRoadmapTestIdsByType.get(test.type)!.push(test.id);
        }
      }
    }
  }

  // A class needs only one real, passing candidate test to be proven present; candidates that
  // don't pan out (a roadmap test with no real automated counterpart, say) are not themselves
  // failures as long as another candidate proves the class.
  const isProven = (testId: string): boolean => automated.has(testId) && (reports === undefined || (reports.passed.has(testId) && !reports.failed.has(testId)));

  for (const suiteClass of SUITE_CLASSES) {
    const where = `${suiteClass.id} (${suiteClass.name})`;
    if (!suiteClass.applicable) {
      if (typeof suiteClass.rationale !== "string" || suiteClass.rationale.trim().length < 20) {
        failures.push(`${where}: an inapplicable suite class requires a reviewed rationale`);
      }
      continue;
    }
    const explicitIds = suiteClass.evidenceTestIds ?? [];
    const roadmapIds = (suiteClass.roadmapTypes ?? []).flatMap((type) => passingRoadmapTestIdsByType.get(type) ?? []);
    const candidateIds = [...explicitIds, ...roadmapIds];
    if (candidateIds.length === 0) { failures.push(`${where}: applicable but no passing roadmap test or evidence test is assigned to it`); continue; }
    if (!candidateIds.some(isProven)) {
      failures.push(`${where}: applicable but none of its candidate tests (${candidateIds.join(", ")}) is automated and passing`);
    }
  }
  return { failures };
}

export function runTestStrategyCheck(root: string, options: { readonly reportDirectory?: string } = {}): TestStrategyResult {
  const roadmap = loadRoadmap(root);
  const automated = automatedTestIds(root);
  const reports = options.reportDirectory === undefined ? undefined : tapResults(resolve(root, options.reportDirectory));
  return checkTestStrategy({ roadmap, automated, ...(reports === undefined ? {} : { reports }) });
}

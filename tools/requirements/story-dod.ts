import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { automatedTestIds, tapResults, type TapResults } from "./test-inventory.ts";

/**
 * US-MSR-103-DOD: the master Definition of Done (master specification §103) is a pipeline control,
 * not a manual checklist. A story marked `implemented` in the durable roadmap source is a claim
 * that every acceptance-relevant test named on it is real, titled with its TC ID and actually
 * passing; a financially material story additionally claims reconciliation evidence. This module
 * checks both claims against the same ground truth implementation evidence uses (real test titles,
 * real TAP output), so a false "done" fails the gate rather than being trusted.
 */

/**
 * Epics whose stories move money or its record (pricing, billing, receivables, payments,
 * collections, revenue recognition, finance/reconciliation): master specification §103's
 * "financial reconciliation tested where applicable" clause applies to their stories.
 */
export const FINANCIALLY_MATERIAL_EPICS: readonly string[] = Object.freeze([
  "SUB-E005", // Pricing
  "SUB-E007", // Billing
  "SUB-E008", // Accounts Receivable
  "SUB-E009", // Payments
  "SUB-E012", // Collections
  "SUB-E014", // Revenue Recognition / Analyst
  "SUB-E017", // Audit & Compliance / Finance Controller
]);

export interface RoadmapTest {
  readonly id: string;
  readonly status: string;
  readonly type: string;
}

export interface RoadmapStory {
  readonly id: string;
  readonly implementation?: string;
  readonly tests: readonly RoadmapTest[];
  readonly reconciliationRationale?: string;
}

export interface RoadmapEpic {
  readonly id: string;
  readonly stories: readonly RoadmapStory[];
}

export interface Roadmap {
  readonly epics: readonly RoadmapEpic[];
}

export function loadRoadmap(root: string): Roadmap {
  const context: { SINTIUS_ROADMAP?: Roadmap } = {};
  runInNewContext(readFileSync(resolve(root, "docs/implementation/implementation-roadmap-data.js"), "utf8"), context);
  if (context.SINTIUS_ROADMAP === undefined) throw new Error("implementation-roadmap-data.js did not define SINTIUS_ROADMAP");
  return context.SINTIUS_ROADMAP;
}

export interface StoryDefinitionOfDoneOptions {
  readonly automated?: ReadonlySet<string>;
  readonly reports?: TapResults;
  readonly financiallyMaterialEpics?: readonly string[];
}

export interface StoryDefinitionOfDoneResult {
  readonly failures: readonly string[];
}

/**
 * Checks every story marked `implemented`:
 * 1. every one of its tests is `passing` in the roadmap source;
 * 2. every one of those tests exists as an automated test titled with its ID;
 * 3. when reports are supplied (CI), every one of those tests actually passed in this run;
 * 4. if its epic is financially material, at least one of its tests is a `reconciliation` test
 *    (a type in the roadmap's own taxonomy — see docs/pre-implementation/24-testing-strategy.md
 *    §12), unless the story records an explicit, reviewed `reconciliationRationale` for why none
 *    applies (for example: the story moves no money and posts no ledger entry).
 */
export function checkStoryDefinitionOfDone(roadmap: Roadmap, options: StoryDefinitionOfDoneOptions = {}): StoryDefinitionOfDoneResult {
  const automated = options.automated ?? new Set<string>();
  const reports = options.reports;
  const financialEpics = new Set(options.financiallyMaterialEpics ?? FINANCIALLY_MATERIAL_EPICS);
  const failures: string[] = [];

  for (const epic of roadmap.epics) {
    for (const story of epic.stories) {
      if (story.implementation !== "implemented") continue;
      const where = story.id;
      if (story.tests.length === 0) failures.push(`${where}: marked implemented with no tests`);
      for (const test of story.tests) {
        if (test.status !== "passing") failures.push(`${where}: test ${test.id} is ${test.status}, not passing`);
        if (!automated.has(test.id)) failures.push(`${where}: test ${test.id} has no automated test titled with its ID`);
        if (reports !== undefined && (!reports.passed.has(test.id) || reports.failed.has(test.id))) {
          failures.push(`${where}: test ${test.id} did not pass in the supplied test reports`);
        }
      }
      if (financialEpics.has(epic.id)) {
        const hasReconciliationTest = story.tests.some((test) => test.type === "reconciliation" && test.status === "passing");
        const rationale = typeof story.reconciliationRationale === "string" ? story.reconciliationRationale.trim() : "";
        if (!hasReconciliationTest && rationale.length < 20) {
          failures.push(`${where}: a financially material story requires a passing reconciliation test, or a reviewed reconciliationRationale explaining why none applies`);
        }
      }
    }
  }
  return { failures };
}

export function runStoryDefinitionOfDoneCheck(root: string, options: { readonly reportDirectory?: string; readonly financiallyMaterialEpics?: readonly string[] } = {}): StoryDefinitionOfDoneResult {
  const roadmap = loadRoadmap(root);
  const automated = automatedTestIds(root);
  const reports = options.reportDirectory === undefined ? undefined : tapResults(resolve(root, options.reportDirectory));
  return checkStoryDefinitionOfDone(roadmap, {
    automated,
    ...(reports === undefined ? {} : { reports }),
    ...(options.financiallyMaterialEpics === undefined ? {} : { financiallyMaterialEpics: options.financiallyMaterialEpics }),
  });
}

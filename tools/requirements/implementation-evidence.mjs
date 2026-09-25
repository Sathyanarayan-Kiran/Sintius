import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { loadSpecificationTestStatus } from "./specification-test-status.ts";
import { automatedTestIds, tapResults } from "./test-inventory.ts";

/**
 * Implementation evidence overlay (docs/implementation/implementation-evidence.json).
 *
 * A requirement counts as implemented only when:
 * 1. it is an accepted requirement;
 * 2. a reviewer recorded an entry naming the code that implements it (every path must exist);
 * 3. EVERY test mapped to the requirement is marked `passing`, either in the durable roadmap
 *    source (the 103 canonical stories) or in the specification-test-status overlay (generated,
 *    specification-derived stories such as US-MSR-080-01);
 * 4. every one of those tests exists as an automated test titled with its ID in the repository;
 * 5. when test reports are supplied (CI), every one of those tests passed in this run.
 * Editing either overlay alone can never raise the count: rules 3-5 tie it to executed tests.
 */
export const EVIDENCE_PATH = "docs/implementation/implementation-evidence.json";
export { tapResults } from "./test-inventory.ts";

/** Canonical roadmap statuses merged with the reviewed specification-test-status overlay. */
export function roadmapTestStatuses(root, options = {}) {
  const context = {};
  runInNewContext(readFileSync(resolve(root, "docs/implementation/implementation-roadmap-data.js"), "utf8"), context);
  const statuses = new Map();
  for (const epic of context.SINTIUS_ROADMAP.epics) for (const story of epic.stories) for (const test of story.tests) statuses.set(test.id, test.status);

  const generatedIdsPath = resolve(root, "docs/implementation/normalized-backlog.json");
  if (existsSync(generatedIdsPath)) {
    const normalizedBacklog = JSON.parse(readFileSync(generatedIdsPath, "utf8"));
    const generatedStories = normalizedBacklog.epics.flatMap((epic) => epic.stories).filter((story) => story.sourceSection !== undefined);
    const generatedTestIds = new Set(generatedStories.flatMap((story) => story.tests.map((test) => test.id)));
    const overlay = loadSpecificationTestStatus(root, generatedTestIds, options);
    for (const [testId, status] of overlay) statuses.set(testId, status);
  }
  return statuses;
}

/**
 * Validates the overlay against the register being generated and returns requirementId → evidence
 * references. Throws with every problem listed, so a bad claim fails the gate.
 */
export function loadImplementationEvidence(root, requirements, options = {}) {
  const path = resolve(root, EVIDENCE_PATH);
  if (!existsSync(path)) return new Map();
  const overlay = JSON.parse(readFileSync(path, "utf8"));
  const byId = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const statuses = roadmapTestStatuses(root, options);
  const automated = automatedTestIds(root);
  const reports = options.reportDirectory === undefined ? undefined : tapResults(options.reportDirectory);
  const failures = [];
  const evidence = new Map();

  for (const entry of overlay.evidence ?? []) {
    const where = entry.requirementId ?? "(missing requirementId)";
    const requirement = byId.get(entry.requirementId);
    if (requirement === undefined) { failures.push(`${where}: unknown requirement`); continue; }
    if (requirement.disposition !== "accepted") failures.push(`${where}: only accepted requirements can carry implementation evidence`);
    if (evidence.has(entry.requirementId)) failures.push(`${where}: duplicate evidence entry`);
    if (typeof entry.summary !== "string" || entry.summary.trim().length < 20) failures.push(`${where}: a reviewed summary of how the requirement is met is required`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedAt ?? "")) failures.push(`${where}: reviewedAt must be a YYYY-MM-DD date`);
    const code = Array.isArray(entry.code) ? entry.code : [];
    if (code.length === 0) failures.push(`${where}: at least one implementing code path is required`);
    for (const file of code) if (!existsSync(resolve(root, file))) failures.push(`${where}: code path ${file} does not exist`);
    const tests = requirement.mappings.testIds;
    if (tests.length === 0) failures.push(`${where}: the requirement has no mapped tests to prove it`);
    for (const test of tests) {
      if (statuses.get(test) !== "passing") failures.push(`${where}: mapped test ${test} is ${statuses.get(test) ?? "not in the roadmap"}, not passing`);
      if (!automated.has(test)) failures.push(`${where}: mapped test ${test} has no automated test titled with its ID`);
      if (reports !== undefined && (!reports.passed.has(test) || reports.failed.has(test))) failures.push(`${where}: mapped test ${test} did not pass in the supplied test reports`);
    }
    evidence.set(entry.requirementId, Object.freeze([...code.map((file) => `code:${file}`), ...tests.map((test) => `test:${test}`)]));
  }

  if (failures.length > 0) throw new Error(`Implementation evidence is invalid:\n- ${failures.join("\n- ")}`);
  return evidence;
}

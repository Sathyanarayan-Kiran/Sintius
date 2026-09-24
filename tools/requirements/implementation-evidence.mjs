import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

/**
 * Implementation evidence overlay (docs/implementation/implementation-evidence.json).
 *
 * A requirement counts as implemented only when:
 * 1. it is an accepted requirement;
 * 2. a reviewer recorded an entry naming the code that implements it (every path must exist);
 * 3. EVERY test mapped to the requirement is marked `passing` in the durable roadmap source;
 * 4. every one of those tests exists as an automated test titled with its ID in the repository;
 * 5. when test reports are supplied (CI), every one of those tests passed in this run.
 * Editing the overlay alone can never raise the count: rules 3-5 tie it to executed tests.
 */
export const EVIDENCE_PATH = "docs/implementation/implementation-evidence.json";
const TEST_ID = /^TC-[A-Z0-9-]+$/;

function roadmapTestStatuses(root) {
  const context = {};
  runInNewContext(readFileSync(resolve(root, "docs/implementation/implementation-roadmap-data.js"), "utf8"), context);
  const statuses = new Map();
  for (const epic of context.SINTIUS_ROADMAP.epics) for (const story of epic.stories) for (const test of story.tests) statuses.set(test.id, test.status);
  return statuses;
}

function automatedTestIds(root) {
  const ids = new Set();
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".test.ts")) {
        for (const match of readFileSync(path, "utf8").matchAll(/\btest\(\s*["'`]((?:TC-[A-Z0-9-]+[ ,/]*)+)/g)) {
          for (const id of match[1].split(/[ ,/]+/)) if (TEST_ID.test(id)) ids.add(id);
        }
      }
    }
  };
  for (const layer of ["apps", "modules", "platform", "tests"]) if (existsSync(resolve(root, layer))) walk(resolve(root, layer));
  return ids;
}

/** Parses TAP files: a test ID passes when at least one test titled with it is `ok` and none is `not ok`. */
export function tapResults(reportDirectory) {
  const passed = new Set();
  const failed = new Set();
  for (const name of readdirSync(reportDirectory).filter((file) => file.endsWith(".tap"))) {
    for (const line of readFileSync(resolve(reportDirectory, name), "utf8").split("\n")) {
      const match = /^\s*(not ok|ok) \d+ - ((?:TC-[A-Z0-9-]+[ ,/]*)+)/.exec(line);
      if (match === null) continue;
      for (const id of match[2].split(/[ ,/]+/).filter((value) => TEST_ID.test(value))) (match[1] === "ok" ? passed : failed).add(id);
    }
  }
  return { passed, failed };
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
  const statuses = roadmapTestStatuses(root);
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

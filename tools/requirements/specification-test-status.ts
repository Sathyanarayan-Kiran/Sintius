import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { automatedTestIds, tapResults } from "./test-inventory.ts";

/**
 * Status overlay for specification-derived tests (docs/implementation/specification-test-status.json).
 *
 * `tools/backlog/generate-jira-backlog.mjs` regenerates one story per master-specification section
 * chunk and its tests every run, always seeded `not_run`: nothing about a generated test's status is
 * durable, so a requirement mapped only to a generated test (an `US-MSR-<section>-<seq>` story, not
 * one of the 103 canonical stories) could never be honestly claimed. This overlay is the durable,
 * reviewed status source for those test IDs, validated the same way as implementation evidence: a
 * `passing` claim requires an automated test titled with that ID, and (when test reports are
 * supplied) that it actually passed in this run. Editing the overlay alone can never fabricate a
 * pass — it can only assert what a real, executed test already proved.
 */
export const SPECIFICATION_TEST_STATUS_PATH = "docs/implementation/specification-test-status.json";
const VALID_STATUSES = new Set(["passing", "partial", "blocked", "not_run"]);

export interface SpecificationTestStatusOptions {
  readonly reportDirectory?: string;
}

interface OverlayEntry {
  readonly testId?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly reviewedAt?: string;
}

/**
 * Validates the overlay against the set of test IDs the generator actually produced this run and
 * returns testId → status. Throws with every problem listed, so a bad claim fails the gate.
 */
export function loadSpecificationTestStatus(
  root: string,
  generatedTestIds: ReadonlySet<string>,
  options: SpecificationTestStatusOptions = {},
): Map<string, string> {
  const path = resolve(root, SPECIFICATION_TEST_STATUS_PATH);
  if (!existsSync(path)) return new Map();
  const overlay = JSON.parse(readFileSync(path, "utf8")) as { readonly statuses?: readonly OverlayEntry[] };
  const automated = automatedTestIds(root);
  const reports = options.reportDirectory === undefined ? undefined : tapResults(resolve(root, options.reportDirectory));
  const failures: string[] = [];
  const statuses = new Map<string, string>();

  for (const entry of overlay.statuses ?? []) {
    const where = entry.testId ?? "(missing testId)";
    if (entry.testId === undefined || !generatedTestIds.has(entry.testId)) { failures.push(`${where}: not a specification-derived test ID in this generation`); continue; }
    if (statuses.has(entry.testId)) { failures.push(`${where}: duplicate status entry`); continue; }
    if (entry.status === undefined || !VALID_STATUSES.has(entry.status)) failures.push(`${where}: status must be one of ${[...VALID_STATUSES].join(", ")}`);
    if (typeof entry.summary !== "string" || entry.summary.trim().length < 20) failures.push(`${where}: a reviewed summary of how the test was demonstrated is required`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedAt ?? "")) failures.push(`${where}: reviewedAt must be a YYYY-MM-DD date`);
    if (entry.status === "passing") {
      if (!automated.has(entry.testId)) failures.push(`${where}: claimed passing but has no automated test titled with its ID`);
      if (reports !== undefined && (!reports.passed.has(entry.testId) || reports.failed.has(entry.testId))) {
        failures.push(`${where}: claimed passing but did not pass in the supplied test reports`);
      }
    }
    statuses.set(entry.testId, entry.status ?? "not_run");
  }

  if (failures.length > 0) throw new Error(`Specification test status overlay is invalid:\n- ${failures.join("\n- ")}`);
  return statuses;
}

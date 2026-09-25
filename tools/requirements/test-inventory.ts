import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Shared inventory helpers: which TC IDs exist as automated tests in the repository, and which of
 * those passed in a given CI run's TAP reports. Used by both the canonical implementation-evidence
 * overlay and the specification-derived test-status overlay, so a claim of either kind is checked
 * against the same ground truth (real test titles, real TAP output), never against itself.
 */
export const TEST_ID = /^TC-[A-Z0-9-]+$/;

/** Every TC-* ID that appears as (part of) a `test("TC-...", ...)` title under the source layers. */
export function automatedTestIds(root: string): Set<string> {
  const ids = new Set<string>();
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".test.ts")) {
        for (const match of readFileSync(path, "utf8").matchAll(/\btest\(\s*["'`]((?:TC-[A-Z0-9-]+[ ,/]*)+)/g)) {
          for (const id of match[1]!.split(/[ ,/]+/)) if (TEST_ID.test(id)) ids.add(id);
        }
      }
    }
  };
  for (const layer of ["apps", "modules", "platform", "tests", "tools"]) if (existsSync(resolve(root, layer))) walk(resolve(root, layer));
  return ids;
}

export interface TapResults {
  readonly passed: Set<string>;
  readonly failed: Set<string>;
}

/** Parses TAP files: a test ID passes when at least one test titled with it is `ok` and none is `not ok`. */
export function tapResults(reportDirectory: string): TapResults {
  const passed = new Set<string>();
  const failed = new Set<string>();
  for (const name of readdirSync(reportDirectory).filter((file) => file.endsWith(".tap"))) {
    for (const line of readFileSync(resolve(reportDirectory, name), "utf8").split("\n")) {
      const match = /^\s*(not ok|ok) \d+ - ((?:TC-[A-Z0-9-]+[ ,/]*)+)/.exec(line);
      if (match === null) continue;
      for (const id of match[2]!.split(/[ ,/]+/).filter((value) => TEST_ID.test(value))) (match[1] === "ok" ? passed : failed).add(id);
    }
  }
  return { passed, failed };
}

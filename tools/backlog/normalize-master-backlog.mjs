import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const run = (relative, env = {}) => {
  const result = spawnSync(process.execPath, [resolve(root, relative)], { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${relative} failed`);
  if (result.stdout.trim()) console.log(result.stdout.trim());
};

run("tools/requirements/extract-master-requirements.mjs", { SINTIUS_IGNORE_NORMALIZED: "1" });
run("tools/backlog/generate-jira-backlog.mjs");
run("tools/requirements/extract-master-requirements.mjs");

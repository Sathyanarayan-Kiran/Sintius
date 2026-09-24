import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(import.meta.dirname, "../..");
function parseCsv(source) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted && character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (!quoted && character === ',') { row.push(cell); cell = ""; continue; }
    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      if (cell.length || row.length) { row.push(cell); rows.push(row); row = []; cell = ""; }
      continue;
    }
    cell += character;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift();
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}
const generator = resolve(root, "tools/backlog/normalize-master-backlog.mjs");
const result = spawnSync(process.execPath, [generator], { cwd: root, encoding: "utf8" });
if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Requirement extraction failed");

const register = JSON.parse(readFileSync(resolve(root, "docs/implementation/requirement-register.json"), "utf8"));
const coverage = JSON.parse(readFileSync(resolve(root, "docs/implementation/requirement-coverage.json"), "utf8"));
const registerHtml = readFileSync(resolve(root, "docs/implementation/requirement-register.html"), "utf8");
const roadmapHtml = readFileSync(resolve(root, "docs/implementation/implementation-roadmap.html"), "utf8");
const roadmapSource = readFileSync(resolve(root, "docs/implementation/implementation-roadmap-data.js"), "utf8");
const normalizedRoadmapSource = readFileSync(resolve(root, "docs/implementation/normalized-backlog-data.js"), "utf8");
const roadmapContext = {};
runInNewContext(roadmapSource, roadmapContext);
runInNewContext(normalizedRoadmapSource, roadmapContext);
const roadmapStories = roadmapContext.SINTIUS_ROADMAP.epics.flatMap((epic) => epic.stories);
const roadmapStoryIds = new Set(roadmapStories.map((story) => story.id));
const roadmapTestIds = new Set(roadmapStories.flatMap((story) => story.tests.map((test) => test.id)));

assert.ok(register.requirements.length > 0, "Requirement register cannot be empty");
assert.equal(coverage.denominator, register.requirements.length, "Coverage denominator must equal the register size");
assert.equal(new Set(register.requirements.map((r) => r.id)).size, register.requirements.length, "Requirement IDs must be unique");
for (const requirement of register.requirements) {
  assert.ok(requirement.statement, `${requirement.id} has no statement`);
  assert.ok(requirement.source.line > 0, `${requirement.id} has no source line`);
  for (const storyId of requirement.mappings.storyIds) assert.ok(roadmapStoryIds.has(storyId), `${requirement.id} maps unknown story ${storyId}`);
  for (const testId of requirement.mappings.testIds) assert.ok(roadmapTestIds.has(testId), `${requirement.id} maps unknown test ${testId}`);
}
const acceptedRequirements = register.requirements.filter((requirement) => requirement.validationStatus === "validated" && requirement.disposition === "accepted");
for (const requirement of acceptedRequirements.filter((requirement) => requirement.implementationPhase === "Phase 0")) {
  assert.ok(requirement.mappings.storyIds.length > 0, `${requirement.id} is an accepted Phase 0 requirement without a story`);
  assert.ok(requirement.mappings.testIds.length > 0, `${requirement.id} is an accepted Phase 0 requirement without a test`);
}
for (const requirement of acceptedRequirements) {
  assert.ok(requirement.mappings.storyIds.length > 0, `${requirement.id} is accepted without a story`);
  assert.ok(requirement.mappings.acceptanceCriteriaIds.length > 0, `${requirement.id} is accepted without an acceptance criterion`);
  assert.ok(requirement.mappings.testIds.length > 0, `${requirement.id} is accepted without a test`);
}
const expectedTraceabilityStatus = coverage.reviewed.count === coverage.denominator
  && coverage.storyMapped.count === coverage.accepted.count
  && coverage.acceptanceCriteriaMapped.count === coverage.accepted.count
  && coverage.testMapped.count === coverage.accepted.count
  ? "complete"
  : "incomplete";
assert.equal(coverage.backlogTraceabilityStatus, expectedTraceabilityStatus, "Backlog traceability status must derive from candidate disposition, story mapping and test mapping counts");
assert.equal(coverage.honestCoverageStatus, "incomplete", "Overall coverage cannot be complete while implementation evidence is absent");
assert.equal(coverage.reviewed.count, coverage.denominator, "Every source candidate must be dispositioned");
const normalizedBacklog = JSON.parse(readFileSync(resolve(root, "docs/implementation/normalized-backlog.json"), "utf8"));
assert.equal(normalizedBacklog.counts.sourceCandidates, coverage.denominator, "Normalized backlog must retain the complete source denominator");
assert.equal(normalizedBacklog.counts.acceptedRequirements, coverage.accepted.count, "Normalized backlog accepted count must match coverage");
const traceabilityCsv = readFileSync(resolve(root, "docs/implementation/jira/sintius-requirement-traceability.csv"), "utf8");
const traceabilityRows = parseCsv(traceabilityCsv);
assert.equal(traceabilityRows.length, coverage.denominator, "Traceability CSV must contain one row per source candidate");
for (const row of traceabilityRows.filter((item) => item.Disposition === "accepted")) {
  assert.ok(row["Story IDs"], `${row["Requirement ID"]} has no story in the traceability CSV`);
  assert.ok(row["Acceptance Criteria IDs"], `${row["Requirement ID"]} has no acceptance criterion in the traceability CSV`);
  assert.ok(row["Test IDs"], `${row["Requirement ID"]} has no test in the traceability CSV`);
}
const jiraCsv = readFileSync(resolve(root, "docs/implementation/jira/sintius-jira-issues.csv"), "utf8");
assert.ok(jiraCsv.includes('"Issue ID","Issue Type","Summary"'), "Jira CSV must expose import hierarchy fields");
const jiraRows = parseCsv(jiraCsv);
assert.equal(jiraRows.filter((row) => row["Issue Type"] === "Epic").length, 17, "Jira CSV must contain all canonical epics");
assert.equal(jiraRows.filter((row) => row["Issue Type"] === "Story").length, normalizedBacklog.counts.totalStories, "Jira CSV story count must match the normalized backlog");
assert.equal(new Set(jiraRows.map((row) => row["Issue ID"])).size, jiraRows.length, "Jira CSV Issue IDs must be unique");
const jiraEpicIssueIds = new Set(jiraRows.filter((row) => row["Issue Type"] === "Epic").map((row) => row["Issue ID"]));
for (const row of jiraRows.filter((item) => item["Issue Type"] === "Story")) assert.ok(jiraEpicIssueIds.has(row.Parent), `${row["External ID"]} has an invalid Jira parent`);
const testRows = parseCsv(readFileSync(resolve(root, "docs/implementation/jira/sintius-test-catalogue.csv"), "utf8"));
assert.equal(testRows.length, normalizedBacklog.counts.tests, "Test catalogue row count must match the normalized backlog");
assert.ok(registerHtml.includes('src="requirement-register-data.js"'), "Requirement Register HTML must load generated register data");
assert.ok(roadmapHtml.includes('src="requirement-register-data.js"'), "Implementation roadmap must load master coverage data");
const registerScriptStart = registerHtml.lastIndexOf("<script>") + "<script>".length;
const registerScriptEnd = registerHtml.indexOf("</script>", registerScriptStart);
new Function(registerHtml.slice(registerScriptStart, registerScriptEnd));
console.log(result.stdout.trim());
console.log(`Requirement coverage gate valid; backlog traceability is ${coverage.backlogTraceabilityStatus}, implementation coverage is ${coverage.implementationCoverageStatus}.`);

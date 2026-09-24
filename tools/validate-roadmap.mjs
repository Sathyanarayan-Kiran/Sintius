import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const htmlPath = resolve("docs/implementation/implementation-roadmap.html");
const dataPath = resolve("docs/implementation/implementation-roadmap-data.js");
const backlogPath = resolve("docs/pre-implementation/19-mvp-backlog.md");
const html = readFileSync(htmlPath, "utf8");
const dataSource = readFileSync(dataPath, "utf8");
const normalizedDataSource = readFileSync(resolve("docs/implementation/normalized-backlog-data.js"), "utf8");
const context = {};
runInNewContext(dataSource, context, { filename: dataPath });
const canonicalStories = context.SINTIUS_ROADMAP.epics.flatMap((epic) => epic.stories);
runInNewContext(normalizedDataSource, context, { filename: resolve("docs/implementation/normalized-backlog-data.js") });
const seed = context.SINTIUS_ROADMAP;

assert.ok(seed, "Complete roadmap data was not initialized");
assert.equal(seed.epics.length, 17, "Roadmap must contain all 17 canonical epics");
const stories = seed.epics.flatMap((epic) => epic.stories);
const mvpStories = canonicalStories.filter((story) => story.backlog[0].startsWith("BL-"));
const futureStories = canonicalStories.filter((story) => story.backlog[0].startsWith("FUT-"));
const controlStories = canonicalStories.filter((story) => !story.backlog[0].startsWith("BL-") && !story.backlog[0].startsWith("FUT-"));
const tests = stories.flatMap((story) => story.tests);
const acceptanceCriteria = stories.reduce((sum, story) => sum + (story.acceptanceCriteria?.length || story.acceptance.length), 0);
assert.equal(mvpStories.length, 77, "Every MVP BL-* item must have exactly one story");
assert.equal(futureStories.length, 24, "Every non-MVP horizon cell must have a future story");
assert.equal(controlStories.length, 2, "Quality strategy and Definition of Done must have cross-cutting control stories");
assert.equal(canonicalStories.length, 103, "Roadmap must preserve the canonical 103-story catalogue");
assert.ok(stories.length > canonicalStories.length, "Roadmap must include source-derived master-requirement stories");
assert.equal(acceptanceCriteria, seed.normalization.acceptanceCriteria, "Rendered roadmap acceptance-criterion count must match the normalized backlog");

function assertUnique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} IDs must be unique`);
}

assertUnique(seed.epics.map((epic) => epic.id), "Epic");
assertUnique(stories.map((story) => story.id), "Story");
assertUnique(tests.map((test) => test.id), "Test");

const backlogSource = readFileSync(backlogPath, "utf8");
const canonicalBacklogIds = [...new Set([...backlogSource.matchAll(/BL-\d{3}-\d{2}/g)].map((match) => match[0]))].sort();
const roadmapBacklogIds = mvpStories.map((story) => story.backlog[0]).sort();
assert.equal(JSON.stringify(roadmapBacklogIds), JSON.stringify(canonicalBacklogIds), "Roadmap BL-* coverage must exactly match deliverable 19");

for (const story of stories) {
  assert.ok(story.persona, `${story.id} must name a persona`);
  assert.ok(story.phase, `${story.id} must name a delivery horizon`);
  assert.ok(story.acceptance.length > 0, `${story.id} must have acceptance criteria`);
  assert.ok(story.tests.length > 0, `${story.id} must have associated tests`);
}

assert.ok(html.includes('<script src="implementation-roadmap-data.js"></script>'), "HTML must load the complete roadmap data");
assert.ok(html.includes('<script src="normalized-backlog-data.js"></script>'), "HTML must load normalized master-requirement stories");
const dashboardStart = html.lastIndexOf("<script>") + "<script>".length;
const dashboardEnd = html.indexOf("</script>", dashboardStart);
assert.ok(dashboardStart > "<script>".length - 1 && dashboardEnd > dashboardStart, "Dashboard script is missing");
new Function(html.slice(dashboardStart, dashboardEnd));

console.log(`Roadmap valid: ${seed.epics.length} epics, ${canonicalStories.length} canonical stories, ${stories.length - canonicalStories.length} source-derived stories, ${tests.length} tests.`);

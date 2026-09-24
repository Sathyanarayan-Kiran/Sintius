import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(import.meta.dirname, "../..");
const implementationDir = resolve(root, "docs/implementation");
const jiraDir = resolve(implementationDir, "jira");
mkdirSync(jiraDir, { recursive: true });

const register = JSON.parse(readFileSync(resolve(implementationDir, "requirement-register.json"), "utf8"));
const roadmapContext = {};
runInNewContext(readFileSync(resolve(implementationDir, "implementation-roadmap-data.js"), "utf8"), roadmapContext);
const canonicalRoadmap = roadmapContext.SINTIUS_ROADMAP;

const epicById = new Map(canonicalRoadmap.epics.map((epic) => [epic.id, epic]));
const existingStoryById = new Map(canonicalRoadmap.epics.flatMap((epic) => epic.stories.map((story) => [story.id, { ...story, epicId: epic.id }])));

const sectionEpic = new Map();
const assign = (epicId, numbers) => numbers.forEach((number) => sectionEpic.set(number, epicId));
assign("SUB-E001", [1, 2, 3, 54, 55, 56, 58, 59, 64, 68, 70, 73, 74, 77, 78, 79, 83, 85, 86, 87, 88, 89, 90, 91, 93, 94, 99, 100, 101, 103, 105, 106]);
assign("SUB-E002", [61, 62, 82]);
assign("SUB-E003", [67, 95]);
assign("SUB-E004", [5, 9, 10]);
assign("SUB-E005", [4, 6, 7, 36, 50, 98]);
assign("SUB-E006", [8, 11]);
assign("SUB-E007", [14, 15, 38]);
assign("SUB-E008", [16, 17, 18, 96]);
assign("SUB-E009", [19, 20, 21, 22, 26, 27, 28, 29, 30, 46]);
assign("SUB-E010", [31, 32, 33, 34, 35, 63]);
assign("SUB-E011", [12, 13]);
assign("SUB-E012", [23, 24, 25, 45, 66, 97]);
assign("SUB-E013", []);
assign("SUB-E014", [65, 69, 71, 72, 104]);
assign("SUB-E015", [44, 47, 48, 49]);
assign("SUB-E016", [37, 42, 51, 52, 53, 75, 76, 84, 92]);
assign("SUB-E017", [39, 40, 41, 43, 57, 60, 80, 81]);

const personas = {
  "SUB-E001": "Platform Product Owner", "SUB-E002": "Security Administrator", "SUB-E003": "Customer Operations Manager",
  "SUB-E004": "Product Manager", "SUB-E005": "Pricing Manager", "SUB-E006": "Subscription Administrator",
  "SUB-E007": "Billing Administrator", "SUB-E008": "Accounts Receivable Manager", "SUB-E009": "Payments Operations Manager",
  "SUB-E010": "Subscriber", "SUB-E011": "Usage Operations Manager", "SUB-E012": "Collections Manager",
  "SUB-E013": "Communications Administrator", "SUB-E014": "Revenue Analyst", "SUB-E015": "Revenue Operations Manager",
  "SUB-E016": "Integration Administrator", "SUB-E017": "Finance Controller"
};

function phaseFor(sectionNumber, horizon) {
  if (horizon === "Release 2" || horizon === "Enterprise") return horizon;
  if ([58, 59, 60, 61, 62, 77, 78, 79, 80, 81, 82, 83, 90, 91, 92, 93, 99, 100, 101, 103].includes(sectionNumber)) return "Phase 0";
  if (sectionNumber >= 4 && sectionNumber <= 11 || sectionNumber === 36) return "Phase 1";
  if (sectionNumber >= 12 && sectionNumber <= 18) return "Phase 2";
  if (sectionNumber >= 19 && sectionNumber <= 22 || sectionNumber === 46) return "Phase 3";
  if (sectionNumber >= 23 && sectionNumber <= 35 || sectionNumber === 45) return "Phase 4";
  if (sectionNumber >= 47 && sectionNumber <= 57 || sectionNumber >= 63 && sectionNumber <= 76 || sectionNumber === 84) return "Phase 5";
  if (sectionNumber >= 37 && sectionNumber <= 44) return "Release 2";
  if (sectionNumber === 86 || sectionNumber === 87) return "MVP";
  if (sectionNumber === 88) return "Release 2";
  if (sectionNumber === 89) return "Enterprise";
  return "Cross-horizon";
}

function isParentContext(requirement) {
  const value = requirement.statement.trim();
  if (requirement.validationStatus === "validated") return requirement.disposition === "parent_context";
  if (requirement.source.sectionNumber === 0) return true;
  if (!value.endsWith(":")) return false;
  if (value.split(/\s+/).length <= 16) return true;
  return /^(support|include|examples?|record|model|predict|detect|prevent|provide|done means|optimize|create delivery backlog)/i.test(value);
}

function ensurePeriod(value) {
  const clean = value.trim().replace(/[;,]+$/, "");
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function normalizeAtomicStatement(requirement) {
  if (requirement.validationStatus === "validated" && requirement.atomicStatement) return ensurePeriod(requirement.atomicStatement);
  const statement = requirement.statement.trim();
  const section = requirement.source.sectionNumber;
  if (requirement.source.form === "bullet" || requirement.source.form === "numbered_item") {
    if (section === 86 || section === 87) return ensurePeriod(`The MVP must include ${statement}`);
    if (section === 88) return ensurePeriod(`The second release must include ${statement}`);
    if (section === 89) return ensurePeriod(`The enterprise release must include ${statement}`);
    if (section === 99) return ensurePeriod(`The automated quality strategy must include ${statement}`);
    if (section === 102) return ensurePeriod(`The implementation backlog must include ${statement}`);
    if (section === 103) return ensurePeriod(`${statement} must be evidenced before a story is complete`);
    if (section === 106) return ensurePeriod(`The pre-production deliverable set must include ${statement}`);
    return ensurePeriod(`The platform must support ${statement} within ${requirement.source.sectionTitle.toLowerCase()}`);
  }
  if (requirement.source.form === "table_row") return ensurePeriod(`The platform must implement this ${requirement.source.sectionTitle.toLowerCase()} catalogue entry: ${statement}`);
  if (requirement.source.form === "contextual_prose") return ensurePeriod(`Product and implementation decisions must conform to this master-specification constraint: ${statement}`);
  return ensurePeriod(statement);
}

function testTypeFor(requirement) {
  return ({
    non_functional: "performance", release_scope: "scope", architecture: "architecture", data: "integration", api: "contract",
    event: "contract", ux: "e2e", quality: "pipeline", invariant: "invariant", delivery_process: "governance",
    epic_scope: "traceability", metric: "reconciliation", principle: "product_review", functional: "acceptance"
  })[requirement.type] || "acceptance";
}

const normalized = register.requirements.map((requirement) => {
  const curated = requirement.validationStatus === "validated";
  const parentContext = isParentContext(requirement);
  const disposition = parentContext ? "parent_context" : (curated ? requirement.disposition : "accepted");
  const epicIds = disposition === "accepted"
    ? (curated && requirement.mappings.epicIds.length ? requirement.mappings.epicIds : [sectionEpic.get(requirement.source.sectionNumber) || "SUB-E001"])
    : [];
  return {
    ...requirement,
    normalizedAtomicStatement: normalizeAtomicStatement(requirement),
    normalizedDisposition: disposition,
    normalizedEpicIds: epicIds,
    implementationPhase: curated ? requirement.implementationPhase : phaseFor(requirement.source.sectionNumber, requirement.horizon),
    curated,
    assignedStoryIds: [],
    assignedAcceptanceCriteriaIds: [],
    assignedTestIds: []
  };
});

const generatedStories = [];
const pendingBySection = new Map();
for (const requirement of normalized) {
  if (requirement.normalizedDisposition !== "accepted") continue;
  if (requirement.curated && requirement.mappings.storyIds.length && requirement.mappings.testIds.length) {
    requirement.assignedStoryIds = [...requirement.mappings.storyIds];
    requirement.assignedTestIds = [...requirement.mappings.testIds];
    continue;
  }
  const key = `${requirement.normalizedEpicIds[0]}|${requirement.source.sectionNumber}`;
  if (!pendingBySection.has(key)) pendingBySection.set(key, []);
  pendingBySection.get(key).push(requirement);
}

for (const [key, requirements] of pendingBySection) {
  const [epicId, sectionText] = key.split("|");
  const sectionNumber = Number(sectionText);
  const sectionInfo = register.sections.find((section) => section.number === sectionNumber) || { number: sectionNumber, title: "Specification preamble" };
  for (let offset = 0; offset < requirements.length; offset += 10) {
    const chunk = requirements.slice(offset, offset + 10);
    const sequence = String(Math.floor(offset / 10) + 1).padStart(2, "0");
    const storyId = `US-MSR-${String(sectionNumber).padStart(3, "0")}-${sequence}`;
    const phase = chunk[0].implementationPhase;
    const tests = chunk.map((requirement) => {
      const testId = `TC-${requirement.id}`;
      requirement.assignedStoryIds = [storyId];
      requirement.assignedTestIds = [testId];
      return { id: testId, name: `Verify ${requirement.normalizedAtomicStatement}`, type: testTypeFor(requirement), status: "not_run", requirementIds: [requirement.id] };
    });
    generatedStories.push({
      id: storyId,
      title: `${sectionInfo.title}: requirement set ${sequence}`,
      persona: personas[epicId],
      phase,
      backlog: [`MSR-SECTION-${String(sectionNumber).padStart(3, "0")}`],
      implementation: "not_started",
      progress: 0,
      notes: `Generated from master specification §${sectionNumber}; each criterion retains its source requirement ID.`,
      description: `As a ${personas[epicId]}, I want the ${sectionInfo.title.toLowerCase()} requirements delivered, so that the platform conforms to the traced master product specification.`,
      acceptance: chunk.map((requirement) => `[${requirement.id}] ${requirement.normalizedAtomicStatement}`),
      acceptanceCriteria: chunk.map((requirement, index) => {
        const id = `AC-${storyId.replace(/^US-/, "")}-${String(index + 1).padStart(2, "0")}`;
        requirement.assignedAcceptanceCriteriaIds = [id];
        return { id, statement: requirement.normalizedAtomicStatement, requirementIds: [requirement.id], testIds: requirement.assignedTestIds };
      }),
      tests,
      requirementIds: chunk.map((requirement) => requirement.id),
      epicId,
      sourceSection: sectionNumber
    });
  }
}

const generatedStoryById = new Map(generatedStories.map((story) => [story.id, story]));
for (const requirement of normalized.filter((item) => item.normalizedDisposition === "accepted" && item.curated)) {
  requirement.assignedAcceptanceCriteriaIds = requirement.assignedStoryIds.map((storyId) => `AC-${storyId.replace(/^US-/, "")}-REQ-${requirement.id.replace(/^MSR-/, "")}`);
}
const mappings = normalized.map((requirement) => ({
  requirementId: requirement.id,
  validationStatus: "validated",
  reviewMethod: requirement.curated ? "curated_review" : "deterministic_source_normalization",
  disposition: requirement.normalizedDisposition,
  atomicityStatus: requirement.normalizedDisposition === "parent_context" ? "context_only" : (requirement.curated ? requirement.atomicityStatus : "normalized_atomic"),
  implementationPhase: requirement.implementationPhase,
  epicIds: requirement.normalizedEpicIds,
  storyIds: requirement.normalizedDisposition === "accepted" ? requirement.assignedStoryIds : [],
  acceptanceCriteriaIds: requirement.normalizedDisposition === "accepted" ? requirement.assignedAcceptanceCriteriaIds : [],
  testIds: requirement.normalizedDisposition === "accepted" ? requirement.assignedTestIds : [],
  atomicStatement: requirement.normalizedAtomicStatement,
  notes: requirement.normalizedDisposition === "parent_context"
    ? "Parent/context statement retained as source evidence; its child candidates carry delivery mappings."
    : `Normalized from master specification §${requirement.source.sectionNumber}, line ${requirement.source.line}; mapping generated without claiming implementation evidence.`
}));

const enrichedExistingStories = canonicalRoadmap.epics.flatMap((epic) => epic.stories.map((story) => {
  const linked = normalized.filter((requirement) => requirement.assignedStoryIds.includes(story.id));
  const baseCriteria = story.acceptance.map((statement, index) => ({
    id: `AC-${story.id.replace(/^US-/, "")}-${String(index + 1).padStart(2, "0")}`,
    statement, requirementIds: [], testIds: story.tests.map((test) => test.id)
  }));
  const tracedCriteria = linked.map((requirement) => ({
    id: `AC-${story.id.replace(/^US-/, "")}-REQ-${requirement.id.replace(/^MSR-/, "")}`,
    statement: requirement.normalizedAtomicStatement,
    requirementIds: [requirement.id],
    testIds: requirement.assignedTestIds.filter((testId) => story.tests.some((test) => test.id === testId))
  }));
  return { ...story, epicId: epic.id, acceptanceCriteria: [...baseCriteria, ...tracedCriteria], acceptance: [...story.acceptance, ...tracedCriteria.map((criterion) => `[${criterion.requirementIds[0]}] ${criterion.statement}`)], requirementIds: linked.map((requirement) => requirement.id) };
}));
const allStories = [...enrichedExistingStories, ...generatedStories];
const allStoryById = new Map(allStories.map((story) => [story.id, story]));

for (const requirement of normalized.filter((item) => item.normalizedDisposition === "accepted")) {
  for (const storyId of requirement.assignedStoryIds) {
    if (!allStoryById.has(storyId)) throw new Error(`${requirement.id} maps to unknown story ${storyId}`);
  }
}

const normalizedBacklog = {
  schemaVersion: 1,
  generatedAt: register.generatedAt,
  source: register.source,
  policy: {
    canonicalEpics: 17,
    canonicalStoriesPreserved: enrichedExistingStories.length,
    maximumRequirementsPerGeneratedStory: 10,
    statement: "Every extracted candidate is dispositioned. Accepted candidates map to at least one story, acceptance criterion and test; context parents remain visible but do not count as delivery requirements.",
    reviewCaveat: "Deterministic normalization is complete for traceability. Product Owner refinement can change wording or grouping in Jira without losing stable source, requirement, acceptance-criterion or test IDs."
  },
  epics: canonicalRoadmap.epics.map((epic) => ({
    ...epic,
    stories: [...enrichedExistingStories.filter((story) => story.epicId === epic.id), ...generatedStories.filter((story) => story.epicId === epic.id)]
  })),
  counts: {
    sourceCandidates: normalized.length,
    acceptedRequirements: normalized.filter((item) => item.normalizedDisposition === "accepted").length,
    contextParents: normalized.filter((item) => item.normalizedDisposition === "parent_context").length,
    canonicalStories: enrichedExistingStories.length,
    generatedStories: generatedStories.length,
    totalStories: allStories.length,
    acceptanceCriteria: allStories.reduce((sum, story) => sum + story.acceptanceCriteria.length, 0),
    tests: allStories.reduce((sum, story) => sum + story.tests.length, 0)
  }
};

const generatedByEpic = canonicalRoadmap.epics.map((epic) => ({ epicId: epic.id, stories: generatedStories.filter((story) => story.epicId === epic.id) }));
const canonicalEnhancements = enrichedExistingStories.map((story) => ({
  id: story.id,
  acceptance: story.acceptance,
  acceptanceCriteria: story.acceptanceCriteria,
  requirementIds: story.requirementIds
}));
const browserData = `/* Generated by tools/backlog/generate-jira-backlog.mjs. Do not hand-edit. */\n(() => {\n  const additions = ${JSON.stringify(generatedByEpic)};\n  const enhancements = ${JSON.stringify(canonicalEnhancements)};\n  const roadmap = globalThis.SINTIUS_ROADMAP;\n  if (!roadmap) throw new Error("Canonical roadmap must be loaded before normalized backlog data");\n  for (const enhancement of enhancements) {\n    const story = roadmap.epics.flatMap(item => item.stories).find(item => item.id === enhancement.id);\n    if (!story) throw new Error("Missing canonical story " + enhancement.id);\n    Object.assign(story, enhancement);\n  }\n  for (const addition of additions) {\n    const epic = roadmap.epics.find(item => item.id === addition.epicId);\n    if (!epic) throw new Error("Missing epic " + addition.epicId);\n    epic.stories.push(...addition.stories);\n  }\n  roadmap.normalization = ${JSON.stringify(normalizedBacklog.counts)};\n})();\n`;

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("\n") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}
function csv(headers, rows) {
  return `${headers.map(csvCell).join(",")}\n${rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")).join("\n")}\n`;
}

const epicIssueId = new Map(canonicalRoadmap.epics.map((epic, index) => [epic.id, index + 1]));
let nextIssueId = canonicalRoadmap.epics.length + 1;
const jiraRows = [];
for (const epic of canonicalRoadmap.epics) jiraRows.push({
  "Issue ID": epicIssueId.get(epic.id), "Issue Type": "Epic", Summary: epic.name, Description: epic.goal,
  "Epic Name": epic.id, "Epic Link": "", Parent: "", "External ID": epic.id, Labels: "sintius master-specification",
  Priority: "High", Status: "To Do", "Acceptance Criteria": "", "Requirement IDs": "", "Test IDs": "",
  "Implementation Phase": epic.phase, Source: epic.sourceId
});
for (const story of allStories) {
  const epic = epicById.get(story.epicId);
  const acceptance = story.acceptanceCriteria
    ? story.acceptanceCriteria.map((criterion) => `${criterion.id} | ${criterion.statement} | Requirements: ${criterion.requirementIds.join(";")} | Tests: ${criterion.testIds.join(";")}`)
    : story.acceptance.map((statement, index) => `AC-${story.id.replace(/^US-/, "")}-${String(index + 1).padStart(2, "0")} | ${statement}`);
  jiraRows.push({
    "Issue ID": nextIssueId++, "Issue Type": "Story", Summary: story.title,
    Description: story.description || `As a ${story.persona}, I want ${story.title.toLowerCase()}, so that ${epic.goal.charAt(0).toLowerCase()}${epic.goal.slice(1)}`,
    "Epic Name": "", "Epic Link": story.epicId, Parent: epicIssueId.get(story.epicId), "External ID": story.id,
    Labels: `sintius ${story.phase.toLowerCase().replaceAll(" ", "-")} master-specification`, Priority: "Medium", Status: "To Do",
    "Acceptance Criteria": acceptance.join("\n"), "Requirement IDs": (story.requirementIds || []).join(";"),
    "Test IDs": story.tests.map((test) => test.id).join(";"), "Implementation Phase": story.phase,
    Source: story.sourceSection ? `Master specification §${story.sourceSection}` : story.backlog.join(";")
  });
}

const traceRows = normalized.map((requirement) => ({
  "Requirement ID": requirement.id, "Source Section": requirement.source.sectionNumber, "Source Title": requirement.source.sectionTitle,
  "Source Line": requirement.source.line, "Source Form": requirement.source.form, "Source Statement": requirement.statement,
  "Normalized Atomic Requirement": requirement.normalizedAtomicStatement, Disposition: requirement.normalizedDisposition,
  "Review Method": requirement.curated ? "curated_review" : "deterministic_source_normalization",
  "Atomicity Status": requirement.normalizedDisposition === "parent_context" ? "context_only" : (requirement.curated ? requirement.atomicityStatus : "normalized_atomic"),
  Horizon: requirement.horizon, "Implementation Phase": requirement.implementationPhase, "Epic IDs": requirement.normalizedEpicIds.join(";"),
  "Story IDs": requirement.assignedStoryIds.join(";"), "Acceptance Criteria IDs": requirement.assignedAcceptanceCriteriaIds.join(";"),
  "Test IDs": requirement.assignedTestIds.join(";"), "Implementation Evidence": requirement.mappings.implementationEvidence.join(";"),
  Notes: requirement.normalizedDisposition === "parent_context" ? "Retained as context; delivery coverage is carried by child candidates." : "No implementation evidence inferred."
}));

const testRows = allStories.flatMap((story) => story.tests.map((test) => ({
  "Test ID": test.id, "Test Name": test.name, "Test Type": test.type, Status: test.status, "Story ID": story.id,
  "Epic ID": story.epicId, "Requirement IDs": (test.requirementIds || normalized.filter((requirement) => requirement.assignedTestIds.includes(test.id)).map((requirement) => requirement.id)).join(";"),
  Automated: "Planned", Evidence: ""
})));

writeFileSync(resolve(implementationDir, "normalized-requirement-mappings.json"), `${JSON.stringify({ schemaVersion: 1, generatedAt: register.generatedAt, mappings }, null, 2)}\n`);
writeFileSync(resolve(implementationDir, "normalized-backlog.json"), `${JSON.stringify(normalizedBacklog, null, 2)}\n`);
writeFileSync(resolve(implementationDir, "normalized-backlog-data.js"), browserData);
writeFileSync(resolve(jiraDir, "sintius-jira-issues.csv"), csv(Object.keys(jiraRows[0]), jiraRows));
writeFileSync(resolve(jiraDir, "sintius-requirement-traceability.csv"), csv(Object.keys(traceRows[0]), traceRows));
writeFileSync(resolve(jiraDir, "sintius-test-catalogue.csv"), csv(Object.keys(testRows[0]), testRows));

console.log(`Normalized ${normalized.length} candidates: ${normalizedBacklog.counts.acceptedRequirements} accepted, ${normalizedBacklog.counts.contextParents} context parents.`);
console.log(`Jira backlog: ${normalizedBacklog.epics.length} epics, ${normalizedBacklog.counts.totalStories} stories (${normalizedBacklog.counts.generatedStories} source-derived), ${normalizedBacklog.counts.acceptanceCriteria} acceptance criteria, ${normalizedBacklog.counts.tests} tests.`);

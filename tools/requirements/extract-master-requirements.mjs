import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { phase0RequirementMappings } from "./phase0-requirement-mappings.mjs";

const root = resolve(import.meta.dirname, "../..");
const masterPath = resolve(root, "AI_Native_Subscription_Revenue_Platform_Master_Product_Specification.md");
const mappingsPath = resolve(root, "docs/implementation/requirement-mappings.json");
const normalizedMappingsPath = resolve(root, "docs/implementation/normalized-requirement-mappings.json");
const registerPath = resolve(root, "docs/implementation/requirement-register.json");
const browserDataPath = resolve(root, "docs/implementation/requirement-register-data.js");
const coveragePath = resolve(root, "docs/implementation/requirement-coverage.json");

const source = readFileSync(masterPath, "utf8").replace(/\r\n/g, "\n");
const lines = source.split("\n");
const mappingsFile = JSON.parse(readFileSync(mappingsPath, "utf8"));
const mappingById = new Map(phase0RequirementMappings.map((mapping) => [mapping.requirementId, mapping]));
for (const mapping of mappingsFile.mappings) mappingById.set(mapping.requirementId, mapping);
const normalizedMappings = process.env.SINTIUS_IGNORE_NORMALIZED !== "1" && existsSync(normalizedMappingsPath)
  ? JSON.parse(readFileSync(normalizedMappingsPath, "utf8")).mappings
  : [];
for (const mapping of normalizedMappings) mappingById.set(mapping.requirementId, mapping);
const normative = /\b(must|should|shall|required|requires?|needs? to|cannot|may not|do not|never|every|all|support|provide|allow|enable|include|capture|display|track|store|maintain|produce|implement|build|add|use|select|define|generate|ensure|prevent|detect|expose|offer|integrate|retain|scale|protect|separate|traceable|auditable)\b/i;

function clean(value) {
  return value.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
}

function typeFor(sectionNumber) {
  if (sectionNumber >= 77 && sectionNumber <= 85) return "non_functional";
  if (sectionNumber >= 86 && sectionNumber <= 89) return "release_scope";
  if (sectionNumber === 90) return "architecture";
  if (sectionNumber === 91) return "data";
  if (sectionNumber === 92) return "api";
  if (sectionNumber === 93) return "event";
  if (sectionNumber >= 94 && sectionNumber <= 98) return "ux";
  if (sectionNumber === 99) return "quality";
  if (sectionNumber === 100) return "invariant";
  if (sectionNumber === 101 || sectionNumber === 103 || sectionNumber === 106) return "delivery_process";
  if (sectionNumber === 102) return "epic_scope";
  if (sectionNumber === 104) return "metric";
  if (sectionNumber === 105) return "principle";
  return "functional";
}

function horizonFor(sectionNumber) {
  if (sectionNumber === 86 || sectionNumber === 87) return "MVP";
  if (sectionNumber === 88) return "Release 2";
  if (sectionNumber === 89) return "Enterprise";
  return "Cross-horizon";
}

function strengthFor(statement) {
  if (/\b(must|shall|required|cannot|may not|never|do not)\b/i.test(statement)) return "mandatory";
  if (/\bshould\b/i.test(statement)) return "recommended";
  return "implicit";
}

function verificationFor(type) {
  return ({
    non_functional: "Measured SLO or architecture test",
    release_scope: "Scope review and release acceptance",
    architecture: "Architecture decision and conformance test",
    data: "Schema/migration and persistence test",
    api: "OpenAPI contract test",
    event: "Schema compatibility and delivery test",
    ux: "End-to-end and accessibility test",
    quality: "Automated quality suite",
    invariant: "Release-blocking property/integration test",
    delivery_process: "Delivery-gate evidence",
    epic_scope: "Backlog traceability review",
    metric: "Metric-definition reconciliation",
    principle: "Product/design review",
    functional: "Acceptance and integration test"
  })[type];
}

function atomicityFor(statement) {
  const conjunctions = (statement.match(/\b(and|or)\b/gi) || []).length;
  const listSeparators = (statement.match(/[;,]/g) || []).length;
  return conjunctions + listSeparators > 1 ? "needs_split_review" : "candidate_atomic";
}

const sections = [];
const candidates = [];
let section = { number: 0, title: "Preamble", line: 1 };
let headingPath = [];
let inFence = false;
let paragraph = [];
let paragraphStart = 0;

function addCandidate(text, line, form) {
  const statement = clean(text);
  if (!statement || statement.length < 3) return;
  candidates.push({ sectionNumber: section.number, sectionTitle: section.title, headingPath: [...headingPath], sourceLine: line, sourceForm: form, statement });
}

function flushParagraph() {
  if (!paragraph.length) return;
  const value = clean(paragraph.join(" "));
  if (section.number > 0) {
    const sentences = value.match(/[^.!?]+[.!?]?/g) || [value];
    for (const sentence of sentences) addCandidate(sentence, paragraphStart, normative.test(sentence) ? "normative_prose" : "contextual_prose");
  }
  paragraph = [];
}

for (let index = 0; index < lines.length; index += 1) {
  const raw = lines[index];
  const lineNumber = index + 1;
  if (/^```/.test(raw.trim())) { flushParagraph(); inFence = !inFence; continue; }
  if (inFence) continue;

  const numberedHeading = raw.match(/^#\s+(\d+)\.\s+(.+)$/);
  if (numberedHeading) {
    flushParagraph();
    section = { number: Number(numberedHeading[1]), title: clean(numberedHeading[2]), line: lineNumber };
    sections.push(section);
    headingPath = [section.title];
    continue;
  }
  const heading = raw.match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
    flushParagraph();
    const level = heading[1].length;
    headingPath = headingPath.slice(0, Math.max(1, level - 1));
    headingPath[level - 1] = clean(heading[2]);
    continue;
  }

  const bullet = raw.match(/^\s*[-*+]\s+(.+)$/);
  const numbered = raw.match(/^\s*\d+[.)]\s+(.+)$/);
  if (bullet || numbered) {
    flushParagraph();
    addCandidate((bullet || numbered)[1], lineNumber, bullet ? "bullet" : "numbered_item");
    continue;
  }

  if (/^\s*\|/.test(raw)) {
    flushParagraph();
    if (!/^\s*\|?\s*:?-+/.test(raw) && !/^\s*\|\s*(Capability|Layer|Service|Entity|Endpoint|Event|Screen|Metric)/i.test(raw)) {
      const cells = raw.split("|").map(clean).filter(Boolean);
      if (cells.length) addCandidate(cells.join(" — "), lineNumber, "table_row");
    }
    continue;
  }

  if (!raw.trim()) { flushParagraph(); continue; }
  if (/^\s*---+\s*$/.test(raw)) { flushParagraph(); continue; }
  if (!paragraph.length) paragraphStart = lineNumber;
  paragraph.push(raw.trim());
}
flushParagraph();

const stableKeys = candidates.map((candidate) => `${candidate.sectionNumber}|${candidate.sourceForm}|${candidate.statement}`);
const stableKeyTotals = new Map();
for (const key of stableKeys) stableKeyTotals.set(key, (stableKeyTotals.get(key) || 0) + 1);
const stableKeyOccurrences = new Map();
const requirements = candidates.map((candidate, candidateIndex) => {
  const stableKey = stableKeys[candidateIndex];
  const stableSuffix = createHash("sha256").update(stableKey).digest("hex").slice(0, 10).toUpperCase();
  const occurrence = (stableKeyOccurrences.get(stableKey) || 0) + 1;
  stableKeyOccurrences.set(stableKey, occurrence);
  const duplicateSuffix = stableKeyTotals.get(stableKey) > 1 ? `-${String(occurrence).padStart(2, "0")}` : "";
  const id = `MSR-${String(candidate.sectionNumber).padStart(3, "0")}-${stableSuffix}${duplicateSuffix}`;
  const type = typeFor(candidate.sectionNumber);
  const mapping = mappingById.get(id) || {};
  return {
    id,
    statement: candidate.statement,
    atomicStatement: mapping.atomicStatement || candidate.statement,
    type,
    horizon: horizonFor(candidate.sectionNumber),
    normativeStrength: strengthFor(candidate.statement),
    atomicityStatus: mapping.atomicityStatus || atomicityFor(candidate.statement),
    validationStatus: mapping.validationStatus || "unreviewed",
    reviewMethod: mapping.reviewMethod || (mapping.validationStatus === "validated" ? "curated_review" : "pending_review"),
    disposition: mapping.disposition || (mapping.validationStatus === "validated" && (mapping.storyIds || []).length ? "accepted" : "pending_review"),
    implementationPhase: mapping.implementationPhase || (mapping.validationStatus === "validated" ? "Phase 0" : "Unassigned"),
    verificationMethod: verificationFor(type),
    source: {
      file: "AI_Native_Subscription_Revenue_Platform_Master_Product_Specification.md",
      sectionNumber: candidate.sectionNumber,
      sectionTitle: candidate.sectionTitle,
      headingPath: candidate.headingPath,
      line: candidate.sourceLine,
      form: candidate.sourceForm,
      text: candidate.statement
    },
    mappings: {
      epicIds: mapping.epicIds || [],
      storyIds: mapping.storyIds || [],
      acceptanceCriteriaIds: mapping.acceptanceCriteriaIds || [],
      testIds: mapping.testIds || [],
      implementationEvidence: mapping.implementationEvidence || [],
      notes: mapping.notes || ""
    }
  };
});

const knownRequirementIds = new Set(requirements.map((requirement) => requirement.id));
const allMappings = [...phase0RequirementMappings, ...mappingsFile.mappings, ...normalizedMappings];
const orphanMappings = allMappings.filter((mapping) => !knownRequirementIds.has(mapping.requirementId)).map((mapping) => mapping.requirementId);
if (orphanMappings.length) throw new Error(`Mappings reference missing requirement IDs: ${orphanMappings.join(", ")}`);

const reviewed = requirements.filter((r) => r.validationStatus === "validated").length;
const accepted = requirements.filter((r) => r.validationStatus === "validated" && r.disposition === "accepted");
const mappedStories = accepted.filter((r) => r.mappings.storyIds.length > 0).length;
const mappedAcceptanceCriteria = accepted.filter((r) => r.mappings.acceptanceCriteriaIds.length > 0).length;
const mappedTests = accepted.filter((r) => r.mappings.testIds.length > 0).length;
const implemented = accepted.filter((r) => r.mappings.implementationEvidence.length > 0).length;
const curatedReviewed = requirements.filter((r) => r.reviewMethod === "curated_review").length;
const deterministicallyNormalized = requirements.filter((r) => r.reviewMethod === "deterministic_source_normalization").length;
const sectionNumbers = new Set(sections.map((item) => item.number));
const representedSections = new Set(requirements.map((item) => item.source.sectionNumber).filter((number) => sectionNumbers.has(number)));
const emptySections = [...sectionNumbers].filter((number) => !representedSections.has(number));
const fingerprint = createHash("sha256").update(source).digest("hex");

const register = {
  schemaVersion: 1,
  generatedAt: statSync(masterPath).mtime.toISOString(),
  source: { file: "AI_Native_Subscription_Revenue_Platform_Master_Product_Specification.md", sha256: fingerprint, lineCount: lines.length },
  extractionPolicy: {
    version: 1,
    status: normalizedMappings.length ? "candidate_register_deterministically_normalized" : "candidate_register_pending_semantic_review",
    warning: normalizedMappings.length
      ? "Every candidate has a deterministic disposition and accepted candidates have delivery mappings. Entries marked normalized_atomic_candidate remain transparent candidates for Product Owner refinement; no implementation evidence is inferred."
      : "Automated extraction establishes a conservative denominator. It does not prove semantic completeness until every candidate and source section is reviewed.",
    rules: ["All Markdown bullets and numbered items", "All table data rows", "Normative prose sentences", "Code fences excluded"]
  },
  sections,
  requirements
};
const coverage = {
  schemaVersion: 1,
  generatedAt: register.generatedAt,
  sourceSha256: fingerprint,
  denominator: requirements.length,
  sourceSections: sections.length,
  sectionsWithCandidates: representedSections.size,
  sectionsWithoutCandidates: emptySections,
  reviewed: { count: reviewed, percent: requirements.length ? Number((reviewed * 100 / requirements.length).toFixed(2)) : 0 },
  reviewMethod: { curated: curatedReviewed, deterministicNormalization: deterministicallyNormalized },
  accepted: { count: accepted.length, percentOfCandidates: requirements.length ? Number((accepted.length * 100 / requirements.length).toFixed(2)) : 0 },
  storyMapped: { count: mappedStories, denominator: accepted.length, percent: accepted.length ? Number((mappedStories * 100 / accepted.length).toFixed(2)) : 0 },
  acceptanceCriteriaMapped: { count: mappedAcceptanceCriteria, denominator: accepted.length, percent: accepted.length ? Number((mappedAcceptanceCriteria * 100 / accepted.length).toFixed(2)) : 0 },
  testMapped: { count: mappedTests, denominator: accepted.length, percent: accepted.length ? Number((mappedTests * 100 / accepted.length).toFixed(2)) : 0 },
  implementationEvidence: { count: implemented, denominator: accepted.length, percent: accepted.length ? Number((implemented * 100 / accepted.length).toFixed(2)) : 0 },
  atomicityNeedsReview: requirements.filter((r) => ["needs_split_review", "normalized_atomic_candidate"].includes(r.atomicityStatus)).length,
  backlogTraceabilityStatus: reviewed === requirements.length && mappedStories === accepted.length && mappedAcceptanceCriteria === accepted.length && mappedTests === accepted.length ? "complete" : "incomplete",
  implementationCoverageStatus: accepted.length > 0 && implemented === accepted.length ? "complete" : "incomplete",
  honestCoverageStatus: reviewed === requirements.length && mappedStories === accepted.length && mappedTests === accepted.length && implemented === accepted.length ? "complete" : "incomplete"
};

writeFileSync(registerPath, `${JSON.stringify(register, null, 2)}\n`, "utf8");
writeFileSync(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");
writeFileSync(browserDataPath, `/* Generated by tools/requirements/extract-master-requirements.mjs. Do not hand-edit. */\nglobalThis.SINTIUS_REQUIREMENT_REGISTER = ${JSON.stringify(register)};\nglobalThis.SINTIUS_REQUIREMENT_COVERAGE = ${JSON.stringify(coverage)};\n`, "utf8");
console.log(`Extracted ${requirements.length} requirement candidates from ${sections.length} numbered sections; ${emptySections.length} sections have no candidate.`);
console.log(`Coverage: reviewed ${reviewed}, accepted ${accepted.length}, story-mapped ${mappedStories}, test-mapped ${mappedTests}, implementation evidence ${implemented}.`);

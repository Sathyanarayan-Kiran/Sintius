# Claude Code implementation handover prompt

Copy everything below the divider into Claude Code while its working directory is the repository root.

**This document's status numbers and "next tranche" (section 8) are historical, from an earlier point in Phase 0; its rules (ground-truth precedence, generated-file rules, reporting format) are still binding.** For current status, use [`HANDOVER_PROMPT_CODEX.md`](HANDOVER_PROMPT_CODEX.md) — as of 2026-09-25, PRs #1–#10 are merged and the Phase 0 exit package (pipeline controls, a durable status overlay for specification-derived tests, `npm start`, `npm run demo:exit`) is implemented in PR 5, awaiting Product Owner confirmation of proposed deferrals and the merge decision.

---

You are continuing implementation of the Sintius AI-native Subscription and Revenue Platform in the existing workspace. Work as a production implementation agent: inspect before editing, preserve traceability, implement the next safe backlog tranche, run the required gates, and leave the repository in a reproducible state.

Do not restart discovery or regenerate a smaller backlog from memory. The repository already contains a complete master-specification requirement register and Jira-ready implementation backlog. Your job is to continue implementation against those artifacts without creating a false impression of delivery coverage.

## 1. Repository and runtime baseline

- Repository root: the directory containing `package.json` and `AI_Native_Subscription_Revenue_Platform_Master_Product_Specification.md`.
- Selected backend runtime: TypeScript on Node.js 24 LTS.
- Package mode: ESM (`"type": "module"`).
- Current code deliberately has no third-party runtime dependencies.
- Node 24 native erasable-TypeScript support executes the initial `.ts` tests directly.
- MVP launch scope: United States and USD.
- Starting topology: domain-modular application with independently scalable workers, not premature microservices.
- System of record: PostgreSQL.
- Reliable event delivery: transactional outbox/inbox and consumer deduplication.
- External synchronous contracts: REST/OpenAPI.
- Asynchronous contracts: versioned CloudEvents-style facts.
- Tenant isolation is mandatory at application and database layers and is release-blocking from the first tenant-owned table.

The runtime decision is resolved. Do not repeat SPIKE-01 or reopen TypeScript versus Kotlin versus Go unless the Product Owner explicitly requests it. The local Decision Ledger still contains an older seed-row phrase, but its implementation sync note and the completed SPIKE-01 proposal record the Product Owner's instruction to proceed with TypeScript on Node.js.

## 2. Ground-truth precedence

When sources appear to conflict, use this order and record any unresolved conflict rather than silently choosing:

1. `AI_Native_Subscription_Revenue_Platform_Master_Product_Specification.md` - original product ground truth and independent requirement denominator.
2. `docs/CANONICAL_SPEC_INDEX.md` - reconciliation and routing authority across the two specification suites.
3. `docs/decision-ledger.html` - local decision record, including implementation sync notes.
4. `docs/implementation/requirement-register.json` - generated source-candidate register.
5. `docs/implementation/normalized-backlog.json` - generated epic/story/acceptance/test delivery model.
6. `docs/pre-implementation/` and `docs/pre-engineering/` - detailed domain, architecture, API, UX, security and test specifications, routed through the canonical index.
7. Existing code and tests - evidence of what is implemented, never evidence that an undocumented requirement can be ignored.

If a generated artifact conflicts with the master specification, fix the generator or curated mapping and regenerate. Do not hand-edit the generated output.

## 3. Mandatory first reads

Read these files before modifying production code:

1. `README.md`
2. `docs/CANONICAL_SPEC_INDEX.md`
3. `docs/implementation/README.md`
4. `docs/implementation/phase-0-backlog.md`
5. `docs/pre-implementation/21-technical-implementation-plan.md`
6. `docs/pre-implementation/23-coding-standards.md`
7. `docs/pre-implementation/24-testing-strategy.md`
8. `docs/pre-engineering/SUB-0019_Test_Strategy_Financial_Correctness_Framework.md`
9. `docs/implementation/requirement-coverage.json`
10. The relevant epic and stories in `docs/implementation/normalized-backlog.json` for the tranche you will implement.
11. For P0-005 specifically: master specification sections 61-62, `docs/pre-implementation/13-api-specification.md` section 4, `docs/pre-implementation/15-security-architecture.md` section 5, `docs/pre-implementation/07-data-model-erd.md`, `docs/pre-engineering/SUB-0014_Security_Privacy_Compliance_Architecture.md` sections 3 and 16, and `docs/pre-engineering/SUB-0021_MVP_Delivery_Backlog.md` story US-E002-01.

Read domain-specific canonical sources before touching that domain. For example, pricing requires both pricing specifications; payments require the payment state machine, payment/collections specification, API contracts, event contracts, security architecture and relevant decisions.

## 4. Current traceability baseline

The current generated baseline is authoritative unless a source or mapping changes:

- Source candidates: 1,540 across all 106 numbered master-specification sections.
- Dispositioned candidates: 1,540/1,540.
- Accepted delivery requirements: 1,335.
- Parent/context records retained with rationale: 205.
- Canonical epics: 17.
- Total stories: 270.
  - Preserved canonical delivery stories: 103.
  - Source-derived gap stories: 167.
- Acceptance criteria: 1,567.
- Associated roadmap tests: 1,469.
- Accepted requirements with story links: 1,335/1,335.
- Accepted requirements with acceptance-criterion links: 1,335/1,335.
- Accepted requirements with test links: 1,335/1,335.
- Accepted requirements with implementation evidence: 0/1,335 at handover time.
- Backlog traceability status: complete.
- Implementation coverage status: incomplete.
- Honest overall coverage status: incomplete.

These distinctions are non-negotiable:

- A source candidate is not automatically a delivery requirement.
- A mapped requirement is not an implemented requirement.
- A planned test is not a passing automated test.
- The canonical roadmap source currently has seven tracked test records marked `passing` and three marked `partial`; the combined normalized catalogue still contains 1,469 planned test records.
- `npm test` currently executes 59 lower-level automated tests. These counts measure different things and must not be conflated.
- Never report `100% implemented`, `100% tested`, or equivalent based on backlog mapping percentages.

## 5. Jira and traceability outputs

The Jira package is under `docs/implementation/jira/`:

- `sintius-jira-issues.csv` - 17 epics and all 270 stories, including descriptions, acceptance criteria, requirements and test IDs.
- `sintius-requirement-traceability.csv` - one row for every one of the 1,540 source candidates.
- `sintius-test-catalogue.csv` - all 1,469 associated test records.
- `README.md` - Jira field mapping and import instructions.

Stable traceability chain:

`master source section/line -> MSR requirement ID -> disposition -> epic ID -> story ID -> acceptance-criterion ID -> test ID -> implementation evidence`

Preserve all stable IDs. Refining wording or regrouping work must not break the original `MSR-*`, `US-*`, `AC-*` or `TC-*` relationships without an explicit migration and validation update.

## 6. Generated files and editable sources

Do not hand-edit these generated artifacts:

- `docs/implementation/requirement-register.json`
- `docs/implementation/requirement-register-data.js`
- `docs/implementation/requirement-coverage.json`
- `docs/implementation/normalized-requirement-mappings.json`
- `docs/implementation/normalized-backlog.json`
- `docs/implementation/normalized-backlog-data.js`
- `docs/implementation/jira/sintius-jira-issues.csv`
- `docs/implementation/jira/sintius-requirement-traceability.csv`
- `docs/implementation/jira/sintius-test-catalogue.csv`

Their editable inputs and generators are:

- Master source: `AI_Native_Subscription_Revenue_Platform_Master_Product_Specification.md`
- Curated mapping overlay: `docs/implementation/requirement-mappings.json`
- Existing Phase 0 curated mapping source: `tools/requirements/phase0-requirement-mappings.mjs`
- Canonical 103-story catalogue and durable canonical status: `docs/implementation/implementation-roadmap-data.js`
- Requirement extractor: `tools/requirements/extract-master-requirements.mjs`
- Backlog/Jira generator: `tools/backlog/generate-jira-backlog.mjs`
- Normalization orchestrator: `tools/backlog/normalize-master-backlog.mjs`
- Coverage gate: `tools/requirements/check-coverage.mjs`
- Roadmap validator: `tools/validate-roadmap.mjs`
- HTML shells: `docs/implementation/implementation-roadmap.html` and `docs/implementation/requirement-register.html`

Run `npm.cmd run backlog:generate` after changing the master specification, curated mappings, canonical story catalogue, normalization policy or Jira generation logic.

The HTML roadmap stores interactive status changes in browser `localStorage`. That is not durable repository evidence. Update the canonical story source for durable canonical status changes. Source-derived stories currently default from the generator; before claiming one is implemented, create or extend a durable repository-controlled status/evidence overlay rather than relying only on browser state.

## 7. Current implementation state

The current implementation is still a Phase 0 foundation, but it is broader than the original handover. Verify every item in code before relying on it.

- `platform/problem-model` (`P0-002`, `US-BL-001-05`, roadmap progress 80%):
  - Frozen RFC 7807/9457-compatible problem-code catalogue.
  - Trusted trace/correlation identifier validation.
  - Transport-neutral error boundary.
  - Known errors use allow-listed external fields; unexpected errors become sanitized 500 responses while redacted internal evidence is retained.
  - A repository-scan test requires every literal `problem({code})` to be catalogued; adding a code requires updating `catalog.ts` and its golden contract test.
  - Remaining: concrete HTTP ingress adapter, error metrics/log dimensions and UI code-to-copy mapping.
- `platform/tenant-context` and `platform/event-envelope` (`P0-001`, `US-BL-001-01`, roadmap progress 85%):
  - Resolver-issued tenant and platform contexts, AsyncLocalStorage propagation, nested-context replacement guards, body tenant rejection, tenant-scoped cache keys and tenant-bound transaction ports.
  - CloudEvents-style envelope stamps tenant, actor, correlation and causation only from trusted scope and rejects tenant identity restated in payloads.
  - Authenticated credential ID, audience and scopes now propagate into contexts; nested work cannot replace them to escalate scope.
  - Remaining: real PostgreSQL/RLS transaction binding, worker/job composition and real cache adapter.
- `modules/identity-tenant` tenant lifecycle (`P0-003`, `US-BL-002-01`, roadmap progress 60%):
  - Pure lifecycle aggregate plus provision/activate/suspend/reactivate/close application handlers.
  - Authorize first, then one unit-of-work port writes tenant, default administrator role, initial administrator membership, audit record and outbox envelope.
  - In-memory rollback tests prove application semantics only. They are not PostgreSQL atomicity evidence.
  - Remaining: real PostgreSQL adapter/migrations, atomicity integration test, real authorizer and HTTP ingress.
- `modules/identity-tenant` authentication (`P0-004`):
  - `US-BL-002-02` is `in_progress`, 65%; both roadmap tests remain `partial`.
  - `US-BL-002-04` is `in_progress`, 65%; workload audience/scope enforcement remains `partial`, workload/interactive separation is `passing`.
  - Provider-neutral policy, credential-verifier and revocation ports implement OIDC/SAML/workload claim enforcement for mechanism, issuer, audience, expiry/not-before, MFA, revocation, tenant binding and workload operation down-scoping.
  - Real OIDC/JWKS and SAML certificate verification, signed-token or mTLS workload adapter, durable session/revocation persistence, issuance/rotation and authentication audit facts remain.
- `tools/architecture-lint` validates module manifests and owned-table declarations.
- `tests/all.test.ts` imports all seven test modules. The last verified `npm.cmd run check` passed all 59 tests.

Current durable canonical status lives in `docs/implementation/implementation-roadmap-data.js`. Do not use browser-local roadmap status as evidence.

The worktree contains the P0-004 implementation and generated roadmap updates as uncommitted changes. They are intentional current work, not disposable scratch files. Inspect `git status --short` and preserve them; do not reset, checkout or overwrite them.

At this handover, `npm.cmd run check` passes:

- Architecture manifests: valid, four owned tables across the identity-tenant module.
- Roadmap: 17 epics, 103 canonical stories, 167 source-derived stories and 1,469 planned tests.
- Requirements: 1,540/1,540 candidates dispositioned; 1,335 accepted requirements all story-, acceptance-criterion- and test-mapped; implementation evidence remains 0/1,335.
- Automated execution: 59/59 tests pass.

Re-run the gate yourself. Do not assume this handover remains current after the first command.

## 8. Next implementation tranche: P0-005 RBAC and maker-checker

> Status update: implemented at unit level (both canonical tests `partial`); see `HANDOVER_PROMPT_CODEX.md` sections 3-5 for what exists and what remains. The scope notes below are retained as the acceptance reference.

The PostgreSQL execution-mode decision and production identity-provider choices are still absent. The next decision-independent tranche is therefore `P0-005` / epic `SUB-E002` / story `US-BL-002-03` / backlog item `BL-002-03`.

Canonical test records:

- `TC-002-03-01` — role-permission allow/deny matrix (`security`, currently `not_run`).
- `TC-002-03-02` — self-approval rejection and second-party approval (`integration`, currently `not_run`).

Canonical acceptance criteria:

- `AC-BL-002-03-01` — permissions are tenant-scoped and deny by default.
- `AC-BL-002-03-02` — a proposer cannot approve their own governed request; an authorized second actor can approve it atomically.
- Requirement-derived criteria are listed on `US-BL-002-03` in `normalized-backlog.json`; do not copy or rename their IDs.

Linked master requirements:

- Role catalogue: `MSR-061-7A36036152`, `MSR-061-1B4B96A6E3`, `MSR-061-AD99726B55`, `MSR-061-10DF979CB3`, `MSR-061-FC23E1A2AC`, `MSR-061-5B5141CF8A`, `MSR-061-090E641078`, `MSR-061-63FDAF8F3E`, `MSR-061-C9828F9E74`, `MSR-061-5C468F3F8B`, `MSR-061-A7460DEF70`, `MSR-061-3232EC982D`.
- Tenant RBAC plus optional ABAC constraints: `MSR-061-2B41953787`.
- Configurable maker-checker and governed examples: `MSR-062-8989FE4287`, `MSR-062-BC82DFEC91`, `MSR-062-2876276E95`, `MSR-062-B080DE07A3`, `MSR-062-58A24733E1`.
- Pricing activation authorization: `MSR-100-C2940C4995`.

Implement a bounded, honest skeleton rather than pretending the entire 19-requirement story is complete:

1. Define a platform permission catalogue using the canonical permission strings already documented in `docs/pre-implementation/13-api-specification.md` section 4. Include the tenant-security permissions needed to manage roles/assignments. Do not invent broad wildcard grants.
2. Define tenant-scoped role definitions, immutable permission bindings and role assignments. The evaluator must:
   - derive tenant and actor exclusively from a resolver-issued `TenantContext`;
   - deny when no active assignment grants the exact permission;
   - deny cross-tenant assignments;
   - apply revocation on the next evaluation according to the current no-cache/session policy;
   - layer optional deterministic ABAC constraints only to narrow a grant;
   - fail closed when a constraint evaluator errors or an attribute is absent.
3. Provide the concrete RBAC authorizer needed by tenant-scoped commands. Keep platform-scoped tenant provisioning authorization separate; a tenant role must never imply platform-global permission.
4. Define a pure maker-checker policy and approval-request state model covering `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED` and `CANCELLED`, immutable decisions, version checks and terminal-state rejection.
5. Enforce step-up MFA for human approval, exact tenant/action/resource/version matching, required approver permission and separation of duties. A workload identity must not perform a human approval.
6. Add tests that fail without the implementation: allow/deny matrix, exact-permission behavior, cross-tenant denial, revoked assignment, ABAC narrowing/fail-closed, self-approval denial, unauthorized approver, valid second-party approval, stale version, expired/rejected request reuse and tenant mismatch.
7. Register any new problem codes and update the problem-catalog golden test. Import every new test file from `tests/all.test.ts`.
8. Update `README.md` and `implementation-roadmap-data.js` conservatively. Mark a roadmap test `passing` only if the whole named behavior is actually demonstrated. A pure aggregate plus in-memory test double normally justifies `partial`, not completed persistence/integration.
9. Run `npm.cmd run backlog:generate` after the roadmap source changes, then run `npm.cmd run check`.

Important ownership constraint: canonical domain sources assign tenant roles and `ApprovalPolicy` to Identity & Tenant, while immutable `ApprovalRequest` evidence belongs to Audit & Governance. Do not add `approval_request` to the identity-tenant table manifest merely for convenience. For a persistence-free skeleton, keep the approval store behind a boundary port and record real Audit & Governance persistence/atomic command integration as remaining. If creating a new module, give it an explicit `module.json`, correct table ownership, and communicate only through published contracts/ports.

The master specification names 12 personas but does not itself define a complete permission matrix for all 12. Use only grants supported by canonical detailed sources, leave unspecified grants denied, and keep those requirement-derived criteria partial unless a complete reviewed matrix is actually established. Do not turn illustrative role examples into unreviewed product policy.

## 9. Open decisions and hard stops

Resolved:

- Backend runtime: TypeScript on Node.js 24 LTS.
- Initial launch market: United States.

Still requires a proposal and explicit confirmation at the relevant gate:

- PostgreSQL local/CI execution mode: Docker Compose, testcontainers, or hosted instance. This blocks real persistence/RLS evidence for P0-001 and P0-003.
- Production OIDC/JWKS, SAML certificate and workload signed-token/mTLS adapter choices. These block completion of P0-004 but do not block P0-005 domain/application work with ports and test doubles.
- SPIKE-02 decimal/money library and boundary representation. JavaScript `number` is prohibited for monetary values.
- SPIKE-03 primary-key scheme: ULID versus UUIDv7.
- SPIKE-05 usage throughput, burst and retention profile.
- SPIKE-06 finance sign-off for rounding and proration. Working proposal is `HALF_UP` plus `ACTUAL_DAYS`, but it is not certified until confirmed.
- Stripe account model, Connect/non-Connect scope, supported US methods and operational boundaries before Stripe-specific payment implementation is finalized.
- Per-agent AI autonomy. Every AI capability remains L0/read-only/advisory until explicitly approved above that level.

Do not silently choose an unresolved value. You may implement provider-neutral ports or use an explicitly labelled working assumption where the canonical plan permits it, but the affected story cannot be reported complete until its decision gate is satisfied.

Do not begin pricing or financial arithmetic implementation before the decimal strategy has been selected and protected by types, lint/architecture rules, golden tests and property tests.

## 10. Non-negotiable engineering rules

- Tenant identity comes from a verified principal/context, never a request body.
- Every tenant-owned table must have a tenant key, repository enforcement, database RLS defense in depth and negative isolation tests.
- Domain modules must not import another module's domain or infrastructure internals.
- Financial values must never use binary floating point.
- Financially material commands require idempotency and an exact-replay/concurrent-duplicate test in the same change.
- Posted financial history is append-only; corrections use linked corrective facts.
- A domain mutation, audit fact and outbox event must commit atomically where applicable.
- Public API and event types come from source contracts and are not hand-edited copies.
- Pricing/rating/billing results require deterministic calculation traces and golden datasets.
- AI cannot write financial state directly, bypass normal authorization/approval or fabricate unsupported financial explanations.
- Secrets, tokens, raw payment credentials and prohibited sensitive values must not appear in logs, traces, events or audit diffs.
- Every expected error has a stable code; unexpected errors are sanitized externally and traceable internally.
- Accessibility, authorization, audit, observability, documentation and reconciliation are part of Definition of Done where applicable.

## 11. Implementation workflow for every tranche

1. Inspect the worktree and preserve unrelated user changes. Do not reset or overwrite them.
2. Run the baseline gate:

   ```powershell
   npm.cmd run check
   ```

3. Select a bounded story or coherent dependency tranche from Phase 0.
4. Record the exact IDs before coding:
   - Epic ID.
   - Story ID and canonical `BL-*` or `MSR-SECTION-*` reference.
   - All linked `MSR-*` requirements.
   - Applicable `AC-*` acceptance criteria.
   - Applicable `TC-*` tests.
5. Read the canonical domain/API/security/testing sources routed by `docs/CANONICAL_SPEC_INDEX.md`.
6. Implement the smallest cohesive vertical behavior, not only an interface or placeholder.
7. Add automated tests in the same change. Include negative, tenant-isolation, stale-version, redaction, idempotency or concurrency cases whenever applicable.
8. Run focused tests during development, then the full gate.
9. Update durable canonical story status and notes only to the level proven by code and tests.
10. Add repository-controlled implementation evidence for completed requirements. If the current mapping pipeline has no durable evidence overlay for a source-derived story, add and validate that overlay before claiming the requirement implemented; never edit generated mapping JSON directly.
11. Regenerate derived backlog/Jira artifacts only when their inputs changed:

   ```powershell
   npm.cmd run backlog:generate
   ```

12. Run the complete exit gate again:

   ```powershell
   npm.cmd run check
   ```

13. Report exactly what is implemented, what remains, which IDs moved, which tests ran, and whether any decision remains blocking.

## 12. Required commands

```powershell
# Complete validation: architecture, roadmap, requirement/Jira traceability and tests
npm.cmd run check

# Automated tests only
npm.cmd test

# Architecture boundary checks
npm.cmd run check:architecture

# Roadmap hierarchy/count validation
npm.cmd run check:roadmap

# Requirement, acceptance-criterion, test and Jira CSV validation
npm.cmd run check:requirements

# Regenerate register, normalized backlog and Jira artifacts
npm.cmd run backlog:generate
```

The requirement check parses the real quoted/multiline CSV files and validates Jira issue IDs, epic parents, row counts and accepted requirement links. Do not replace it with a shallower count-only check.

## 13. Completion and reporting rules

Do not say a story is implemented merely because:

- a type or interface exists;
- a generated acceptance criterion exists;
- a unit test for a pure function passes;
- the roadmap traceability percentage is 100%;
- the HTML page was edited in browser local storage;
- a provider port exists without a real adapter where the story requires integration.

For each completed or advanced story, report:

- Epic, story, requirement, acceptance-criterion and test IDs.
- Files changed.
- Observable behavior now implemented.
- Tests executed and their result.
- Implementation evidence added to the register or durable evidence overlay.
- Roadmap status/progress change and why that percentage is justified.
- Remaining acceptance criteria or integration work.
- Any new or unresolved decision.

Keep these headline states separate in every summary:

- Backlog traceability: currently complete.
- Implementation coverage: currently incomplete.
- Automated execution: report only what was actually run in this session.

## 14. Start now

Begin by:

1. Reading the mandatory files.
2. Running `npm.cmd run check`.
3. Comparing the live repository results with the counts and statuses in this handover.
4. Inspecting `US-BL-002-03`, all 19 linked requirements, all 21 acceptance criteria, both canonical test records, and the existing deny-by-default `PlatformAuthorizer` port.
5. Implementing the bounded P0-005 RBAC and maker-checker tranche described in section 8, with tests.
6. Updating durable status/evidence without modifying generated artifacts by hand.
7. Running the complete validation gate and giving an evidence-based handoff report.

If the baseline gate fails, diagnose and repair the baseline before adding new behavior. If an unresolved product or financial choice is genuinely required for the next safe step, stop at the decision boundary, produce a concrete options proposal, and request confirmation rather than inventing an answer.

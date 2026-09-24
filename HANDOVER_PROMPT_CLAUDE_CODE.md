# Claude Code implementation handover prompt

Copy everything below the divider into Claude Code while its working directory is the repository root.

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
- The roadmap currently has four tracked test records marked `passing`.
- `npm test` currently executes seven lower-level automated test assertions. These counts measure different things and must not be conflated.
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

Implemented code is intentionally narrow:

- `platform/problem-model/src/index.ts`
  - Canonical problem detail type.
  - Stable problem codes.
  - Optional correlation ID.
- `platform/tenant-context/src/index.ts`
  - Branded tenant and actor IDs.
  - Authenticated principal model.
  - Membership validation.
  - Rejection of tenant identity supplied in request bodies.
  - ACTIVE-tenant enforcement.
  - Immutable `AsyncLocalStorage` context propagation.
  - Fail-closed missing-context behavior.
- `modules/identity-tenant/domain/tenant.ts`
  - Tenant provisioning.
  - Explicit lifecycle transition table.
  - Optimistic version checks.
  - Terminal CLOSED state.
  - Versioned tenant domain events.
- `tools/architecture-lint/src/index.ts`
  - Initial bounded-context/table-ownership architecture validation.
- `tests/all.test.ts`
  - Aggregates the two current test modules.

Current canonical roadmap status:

- `US-BL-001-01` / `BL-001-01` trusted tenant context: `in_progress`, 65%.
  - Implemented: resolver, membership/ACTIVE checks, body override rejection and asynchronous context propagation.
  - Remaining: integration into transaction, cache and event-envelope boundaries.
- `US-BL-001-05` / `BL-001-05` canonical problems and trace identifiers: `in_progress`, 50%.
  - Implemented: canonical problem model.
  - Remaining: ingress/adapter mappings, sanitized unexpected-error behavior, correlation propagation and dedicated adapter tests.
- `US-BL-002-01` / `BL-002-01` tenant lifecycle: `in_progress`, 40%.
  - Implemented: pure lifecycle aggregate and unit tests.
  - Remaining: application command handler, persistence port/adapter, atomic provisioning of tenant/default role/admin/audit/outbox, and integration tests.
- All other canonical and source-derived stories are `not_started` unless the repository shows newer evidence.

At handover, `npm.cmd run check` passes:

- Architecture manifests valid.
- Roadmap hierarchy valid: 17 epics, 103 canonical stories and 167 source-derived stories.
- Requirement coverage gate valid: 1,540 candidates dispositioned and every accepted requirement mapped to story, acceptance criterion and test.
- Seven automated tests pass.

Re-run the gate yourself. Do not assume this handover remains current after the first command.

## 8. Recommended next implementation tranche

Continue Phase 0. Do not jump to broad feature work merely because the normalized backlog contains later-horizon stories.

Recommended order:

1. Finish `P0-002` / `US-BL-001-05` canonical problem and trace adapter behavior.
   - Define the application/transport boundary mapping for known `PlatformProblem` errors.
   - Map unexpected exceptions to a sanitized 500 problem without leaking internal values.
   - Preserve the correlation ID supplied by trusted request context.
   - Add contract/security tests for known mappings and unexpected-error redaction.
   - Do not introduce a web framework solely to simulate an adapter; use a small port or adapter abstraction until a concrete HTTP framework is intentionally selected.
2. Complete the remaining non-persistence portion of `P0-001` / `US-BL-001-01`.
   - Define how trusted tenant/correlation/causation context reaches command execution, cache namespaces and event envelopes.
   - Add tests proving tenant context cannot be overridden downstream.
3. Advance `P0-003` / `US-BL-002-01` through an application command handler and persistence port.
   - Preserve the pure aggregate.
   - Keep transaction management outside the domain model.
   - Do not claim atomic PostgreSQL provisioning complete until a real adapter and integration test prove tenant, default role, initial administrator, audit event and outbox event commit or roll back together.
4. Then proceed in the Phase 0 critical order from `docs/implementation/phase-0-backlog.md`: authentication/workload identity, RBAC/maker-checker, idempotency, outbox, RLS/repository isolation, audit and the vertical-slice proof.

Before starting each story, retrieve its complete acceptance criteria and linked requirement/test IDs from `docs/implementation/normalized-backlog.json`. The compact Phase 0 document is a delivery guide, not a replacement for the complete traceability record.

## 9. Open decisions and hard stops

Resolved:

- Backend runtime: TypeScript on Node.js 24 LTS.
- Initial launch market: United States.

Still requires a proposal and explicit confirmation at the relevant gate:

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
4. Inspecting `US-BL-001-05`, its linked requirements/acceptance criteria/tests, and the existing problem model.
5. Implementing the next safe `P0-002` tranche with tests.
6. Updating durable status/evidence without modifying generated artifacts by hand.
7. Running the complete validation gate and giving an evidence-based handoff report.

If the baseline gate fails, diagnose and repair the baseline before adding new behavior. If an unresolved product or financial choice is genuinely required for the next safe step, stop at the decision boundary, produce a concrete options proposal, and request confirmation rather than inventing an answer.

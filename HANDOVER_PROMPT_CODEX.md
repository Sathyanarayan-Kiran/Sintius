# Codex implementation handover prompt

Copy everything below the divider into Codex with the working directory set to the repository root.

---

You are continuing implementation of the Sintius AI-native Subscription and Revenue Platform. Work as a production implementation agent: inspect before editing, preserve traceability, implement one bounded tranche with tests, run the gate, and report only what you proved.

## 1. Read first

The governing rules live in `HANDOVER_PROMPT_CLAUDE_CODE.md` (repo root). It is tool-agnostic; treat it as binding. Read it fully, then read, in order: `README.md`, `docs/CANONICAL_SPEC_INDEX.md`, `docs/implementation/README.md`, `docs/implementation/phase-0-backlog.md`, and the coding and testing standards it lists. Do not restart discovery or regenerate the backlog.

Key non-negotiables from that file:
- Ground-truth precedence: master specification, then canonical index, decision ledger, generated registers, detailed specs, then code.
- Never hand-edit generated files. Change `docs/implementation/implementation-roadmap-data.js` (durable status) or the generator inputs, then run `npm run backlog:generate`.
- Keep three statements separate in every report: "Backlog traceability: complete", "Implementation coverage: incomplete", "Automated execution: only what actually ran".
- A mapped requirement is not implemented; a planned test is not a passing test. Never claim 100% from mapping percentages.
- Do not reopen resolved decisions (TypeScript on Node.js 24 LTS, PostgreSQL, modular monolith with workers, transactional outbox/inbox, REST/OpenAPI, US/USD MVP). Open spikes and decisions (SPIKE-02/03/05/06, Stripe scope, AI autonomy) need a written proposal and Product Owner confirmation; do not silently choose.

## 2. Environment notes

- Windows; commands used so far: `npm.cmd run check`, `npm.cmd test`, `npm.cmd run backlog:generate`. On other shells use `npm`.
- `npm run check` = check:architecture, check:roadmap, check:requirements, test.
- Code style: ESM, zero runtime dependencies, erasable TypeScript only (no enums, namespaces or parameter properties; use `import type`, `#private` fields), tests run natively with `node --test tests/all.test.ts`. Every new test file must be imported from `tests/all.test.ts`.
- Modules may not import other modules' internals; `tools/architecture-lint` validates each `module.json` (ownedTables, publishedEvents, allowedModuleDependencies).
- Baseline at handover: `npm run check` passes, 51 of 51 tests. Run it before editing and confirm.

## 3. What exists now (verify by reading, do not trust this list blindly)

- `platform/problem-model` (P0-002 / US-BL-001-05): RFC 7807/9457 problems, frozen code catalog (`catalog.ts`), trace IDs, redaction, error boundary. Every `problem({ code })` literal in the repo must be registered in the catalog; a repo-scan test enforces it. Adding a code means updating the catalog and the golden test.
- `platform/tenant-context` (P0-001 / US-BL-001-01): trusted tenant context via AsyncLocalStorage, only resolver-issued contexts accepted, nested tenant/actor switching rejected, tenant identity in command input rejected (fail closed), tenant-scoped cache keys, tenant-bound transaction port, and `PlatformCommandContext` for platform-scoped commands.
- `platform/event-envelope`: CloudEvents-style envelope conforming to `docs/pre-implementation/contracts/events/envelope.schema.json`; tenant, actor and correlation come only from trusted scope; payload may not restate tenant identity. Event id is a working default `evt_<uuid>` pending SPIKE-03.
- `modules/identity-tenant` (P0-003 / US-BL-002-01): pure tenant aggregate (`domain/tenant.ts`) plus application layer (`application/ports.ts`, `application/tenant-commands.ts`). Handlers: provision, activate, suspend, reactivate, close. Authorize first, then one unit of work writing tenant, default administrator role, initial administrator membership, audit record and outbox envelope.
- `modules/identity-tenant/tests/in-memory-persistence.ts` is a TEST DOUBLE. It is not evidence of PostgreSQL atomicity.

## 4. Durable status at handover (in `docs/implementation/implementation-roadmap-data.js`)

- US-BL-001-05: tests TC-001-05-01/02 passing, progress 80.
- US-BL-001-01: progress 85; TC-001-01-03 (trusted tenant reaches a real transaction) is `not_run`.
- US-BL-002-01: progress 60; TC-002-01-03 (atomic tenant/default-role/admin persistence) is `not_run`.
- Implementation evidence overall: 0 of 1,335 requirements. No durable evidence overlay exists yet for source-derived stories; create one before claiming any of them implemented.

## 5. Recommended next tranche

Do these in order, one bounded tranche at a time, and stop to report after each.

1. **PostgreSQL adapter for identity-tenant (finishes TC-001-01-03 and TC-002-01-03).** Blocked on one decision: how Postgres runs locally and in CI (Docker Compose, testcontainers, or a hosted instance). Propose an option with trade-offs and ask the Product Owner; do not pick silently. Once decided: implement `TenantPersistence`/`TenantUnitOfWork` against real PostgreSQL, the tables owned by identity-tenant (`tenant`, `tenant_identity_provider`, `tenant_role`, `tenant_role_assignment`), migrations, and an integration test proving atomic commit and rollback plus tenant-bound transaction binding. Only then mark those two tests `passing`.
2. **P0-004** authentication and workload identity (issue and verify principals feeding `resolveTenantContext` / `resolvePlatformCommandContext`).
3. **P0-005** RBAC and maker-checker; replaces the deny-by-default `PlatformAuthorizer` port and defines the permission catalog for the default `tenant_administrator` role.
4. **P0-006** idempotency, **P0-007** outbox relay, **P0-008** audit, **P0-009** row-level security, **P0-010** proof command. Specs are in `docs/implementation/phase-0-backlog.md`.

If the PostgreSQL decision is not yet made, start with P0-004 and record the blocker.

## 6. Definition of done for any tranche

- Implementation plus tests that fail without the implementation.
- New problem codes registered in the catalog and golden test; new test files imported from `tests/all.test.ts`.
- Roadmap status updated only to the level proven; `npm run backlog:generate` run when inputs changed; `npm run check` green.
- README "Current implementation slice" updated if scope changed.
- Final report contains: story and epic IDs with MSR IDs, files changed, exact commands run with pass/fail counts, status changes made, what remains, and decisions needed. Include the three-line separation from section 1. Do not claim anything you did not run.

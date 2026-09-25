# Codex implementation handover prompt

Copy everything below the divider into Codex. Set the working directory to the repository root (the folder that contains `package.json`).

State as of 2026-09-25. PRs #1–#10 are merged, and PR 5 (the Phase 0 exit package, section 6) is implemented, its proposed deferrals confirmed and its merge approved by the Product Owner. Phase 0 is exited except US-BL-017-03 (section 4).

---

You are continuing implementation of the **Sintius AI-native Subscription and Revenue Platform**. Work as a production implementation agent:

- inspect before you edit and preserve traceability;
- implement one bounded tranche at a time, with tests;
- run the full gate before you report;
- report only what you actually proved.

Phase 0 (the platform foundation) is exited: its exit package (section 6, PR 5) is implemented, its proposed deferrals confirmed and its merge approved by the Product Owner. US-BL-017-03 stays `in_progress` (section 4) pending a deployed environment to run it against; the identity-provider product choice does not block Phase 0. Next: D7 UUIDv7 migration, then Phase 1 (section 6).

## 1. Read first (in this order)

1. **This prompt.** Where it disagrees with an older handover, this prompt wins.
2. `HANDOVER_PROMPT_CLAUDE_CODE.md`, for:
   - the ground-truth precedence;
   - the traceability chain;
   - the generated-file rules;
   - the reporting format.

   Its status numbers are historical; its rules are binding.
3. `README.md`, which describes the current implementation slice one bullet per capability.
4. `docs/implementation/decision-proposals.md`. Decisions D1–D16 are all accepted.
5. `docs/implementation/phase-0-backlog.md`, which holds P0-001 to P0-010, with their implementation status and the exit criteria.
6. `docs/pre-implementation/23-coding-standards.md` and `24-testing-strategy.md`.
7. The domain sources for whatever you touch:
   - `13-api-specification.md` for the API, idempotency and permissions;
   - `14-event-taxonomy.md` for events;
   - `15-security-architecture.md` for authentication, authorization and audit;
   - `16-multi-tenancy-architecture.md` for RLS and support access;
   - `07-data-model-erd.md` for tables.

Do not restart discovery, and do not regenerate a smaller backlog.

**Non-negotiables**

- **Ground-truth precedence:** the master specification, then the canonical index, the decision ledger, the generated registers, the detailed specs, and finally the code.
- **Never hand-edit generated files.** Edit the inputs instead: `docs/implementation/implementation-roadmap-data.js` (story and test status), `docs/implementation/implementation-evidence.json` (requirement claims) or the generator scripts. Then run `npm run requirements:generate`, which regenerates the register, coverage, Jira CSVs and `normalized-backlog.json`.
- **Keep three statements separate in every report:**
  - "Backlog traceability: complete";
  - "Implementation coverage: incomplete (N of 1,335 with evidence)";
  - "Automated execution: only what actually ran".
- **A mapped requirement is not an implemented one.** Implementation evidence lives in `docs/implementation/implementation-evidence.json`; it stood at **18 of 1,335** at handover (up from 16: MSR-080-3B6F4B3FE4 OIDC/OAuth2 and MSR-080-477F636C27 MFA, each demonstrated by its own directly titled test via the new `docs/implementation/specification-test-status.json` overlay — SAML, MSR-080-A555453F8D, is not claimed). Claim a requirement only when all of these hold:
  - every test mapped to it is `passing` in the roadmap data;
  - each of those tests exists as an automated test whose title contains its TC ID;
  - each of those tests passed in the CI run.

  `npm run requirements:generate` and `npm run check:evidence` enforce this. Review each claim against the code, and write its scope honestly in `summary`.
- **Never mark a roadmap test `passing`** unless the whole named behaviour was demonstrated. A pure aggregate plus an in-memory double justifies `partial`, never `passing`.
- **Do not reopen resolved decisions:**
  - TypeScript on Node.js 24 LTS;
  - PostgreSQL 17;
  - modular monolith with workers;
  - transactional outbox and inbox;
  - REST/OpenAPI;
  - Fastify 5;
  - GitHub Actions CI;
  - US/USD for the MVP;
  - everything in D1–D16.

  Items still open (the IdP product, SPIKE-05 usage throughput, Stripe scope, AI autonomy) need a written proposal and Product Owner confirmation. Never choose silently.

## 2. Environment and repository

**Runtime and style**

- Windows with PowerShell. Use `npm.cmd` if script execution policy blocks `npm`.
- Node.js 24 is required (`engines: >=24 <25`). Node runs TypeScript directly; there is no build step.
- ESM with erasable TypeScript only: no enums, namespaces or parameter properties. Use `import type`, `#private` fields and `import.meta.dirname`.
- `npm run typecheck` runs pinned TypeScript 7 under strict settings (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`). Keep it at zero errors.
- Runtime dependencies are pinned exactly: `pg`, `fastify`, `jose` and the `@opentelemetry/*` packages. After adding any dependency or workspace `package.json`, run `npm install` and commit `package-lock.json`, because CI runs `npm ci`.

**Architecture lint** (`npm run check:architecture`)

- Each module declares `module.json` (`ownedTables`, `publishedEvents`, `allowedModuleDependencies`).
- Modules never import another module's internals. Cross-module reads are injected at the composition root, as `apps/api/src/composition/postgres.ts` does with the approval-policy reader.
- Fastify imports are allowed only under `apps/*`.
- `@opentelemetry` imports are allowed only in `platform/observability`.
- Float money arithmetic is rejected; use `platform/money`.

**Local database**

- `npm run db:up` starts PostgreSQL 17 in Docker Compose on `127.0.0.1:54329` and waits until it is healthy.
- `npm run db:migrate` applies checksum-protected, forward-only migrations discovered under `modules/*` and `platform/*`. Names are globally ordered.
- `npm run db:down` stops the container and keeps the named volume.
- Compose uses trust authentication, which is for local development only.
- Connection-string environment variables:
  - `SINTIUS_MIGRATION_DATABASE_URL` (`sintius_admin`, migrations and test seeding);
  - `SINTIUS_DATABASE_URL` (`sintius_app`);
  - `SINTIUS_DISPATCHER_DATABASE_URL` (`sintius_dispatcher`).

**Database roles**

- `sintius_admin`: migrations only; a superuser locally and in CI.
- `sintius_app`: NOBYPASSRLS; bound to one tenant per transaction via `set_config('app.tenant_id', …, true)`.
- `sintius_dispatcher`: NOBYPASSRLS outbox relay. Cross-tenant only on `outbox_event` and `event_delivery`; writes `audit_event` only for the tenant it binds.

**Migrations**

| Migration | Contents |
|---|---|
| 001 | tenant, identity-provider, role, assignment and approval-policy tables |
| 002 | idempotency |
| 003 | deferred FK |
| 004 | foundation proof |
| 005 | outbox, dispatch and inbox |
| 006 | event delivery (D14) |
| 007 | trace context (D15) |
| 008 | `approval_request` |
| 009 | approver requirements (D4) |
| 010 | `credential_revocation` |
| 011 | role-scoped permission limits |

**Tests and gate**

- `npm test` runs the unit suite. Every unit test file must be imported from `tests/all.test.ts`.
- `npm run test:postgres` runs the PostgreSQL suite. Its files are listed explicitly in `tools/test/run-suite.mjs` and run one at a time, because they share a database. Add each new database test file there.
- `npm run check` runs the whole local gate: typecheck, architecture, roadmap, requirement coverage, unit tests and the PostgreSQL suite.
- `npm run check:evidence` re-verifies evidence claims against the TAP reports. To run it locally, first run the suites with `SINTIUS_TEST_REPORT_DIR=reports`.
- **Baseline at handover:** 184 unit and 39 PostgreSQL tests, all passing (223 in total). Run `npm run check` before editing and confirm this baseline. `npm run check:evidence` and `npm run check:pipeline-controls` (both CI-only, requiring `SINTIUS_TEST_REPORT_DIR`) additionally re-verify implementation evidence and the Definition of Done / test strategy gates against the run's TAP reports.

**CI**

- `.github/workflows/ci.yml` defines the "Release gate" job (Node 24, PostgreSQL 17 service). It runs:
  1. `npm ci`
  2. typecheck
  3. architecture, roadmap and requirement checks
  4. unit tests
  5. migrations
  6. PostgreSQL tests
  7. `check:evidence`
  8. upload of the TAP reports as release-gate evidence
- A GitHub ruleset on `master` requires this check, so nothing merges red.

**Git**

- Remote `origin`: `https://github.com/Sathyanarayan-Kiran/Sintius.git`. The default branch is `master`.
- Work on a feature branch, for example `codex/<topic>`. Push it and open a PR, then merge after the Release gate passes and the Product Owner agrees.
- Commit or push only when the user asks.
- GitHub push protection scans for secrets. Never put a literal secret-shaped string (for example a Stripe-style `sk_test_...`) in source or tests, even a fake one; build it at runtime instead.
- A local branch `backup-before-secret-fix` holds a flagged string and **must never be pushed**.
- "LF will be replaced by CRLF" warnings are harmless.

## 3. What exists (verify by reading; do not trust this list blindly)

**platform/problem-model**
- RFC 9457 problems with a frozen code catalog (`src/catalog.ts`).
- Every `problem({ code })` literal must be registered in the catalog and in the golden test (`platform/problem-model/tests/problem-model.test.ts`); a repo-scan test enforces this.
- Also provides trace IDs, redaction and the error boundary.

**platform/tenant-context**
- Principals are issued only by authentication. Resolvers reject principal-shaped literals and re-check expiry against real time.
- The tenant context lives in AsyncLocalStorage and cannot be switched once set. A tenant identity inside command input is refused.
- Also provides tenant-scoped cache keys, an in-memory key-value store (D16) and `PlatformCommandContext`.
- **`runTenantJob`** (`src/job.ts`) gives scheduled work its trusted context:
  - it starts only at the root, never nested;
  - it requires a workload credential bound to exactly one active tenant;
  - the correlation ID is derived from the job run.

**platform/idempotency**
- Uses RFC 9562 UUID keys (D2).
- Authorizes before looking up a stored result.
- Commits the claim, the effect and the stored response in one transaction.
- PostgreSQL store with a race-safe primary key.

**platform/outbox**
- Transactional outbox (`append.ts`).
- Dispatcher that leases stream heads with `FOR UPDATE SKIP LOCKED`.
- Per-consumer delivery queue with LISTEN/NOTIFY (D14): `PostgresEventPublisher` and `createDeliveryWorker`.
- Idempotent PostgreSQL inbox.
- Audited dead-letter skip and requeue by an operator. A dead letter blocks only its own stream (D1).
- Trace context is stored beside each entry (D15).

**platform/audit**
- Immutable, hash-stamped events recorded only from trusted context.
- Allow-list redaction.
- A permissioned reader whose reads are themselves audited (in-memory only).
- `infrastructure/postgres/writer.ts` (`appendAuditEvent`) is the single SQL writer.

**platform/observability**
- The only OpenTelemetry surface, with PII-safe attributes.
- Metrics:
  - `sintius.http.problems`
  - `sintius.idempotency.requests`
  - `sintius.audit.write_failures`
  - `sintius.queue.outcomes`
  - `sintius.authentication.outcomes`
  - queue gauges

**platform/money**
- BigInt fixed-point `Decimal` (38 digits, scale 18) and minor-unit `Money`.
- HALF_UP rounding, ACTUAL_DAYS proration and largest-remainder allocation (D5, D6).
- `decimal.js` is a test oracle only.

**modules/identity-tenant**
- Tenant aggregate and idempotent lifecycle commands (provision, activate, suspend, reactivate, close) on PostgreSQL.
- Authentication (`application/authentication.ts`) has three entry points:
  - `authenticateInteractive` (tenant users);
  - `authenticateWorkload`;
  - `authenticatePlatformOperator` (D11).

  Every attempt emits an `AuthenticationFact` and a metric with a reason class, never the token.
- `infrastructure/jose/jwt-verifier.ts` (D8):
  - asymmetric algorithms only;
  - issuer, audience, exp, nbf, token-age and jti checks, plus an optional `typ`;
  - `remoteKeySet` caches the JWKS and refetches on an unknown `kid`, which is how key rotation is handled;
  - SAML is federated through the IdP.

  Tests use `tests/jwt-support.ts` to mint real signed tokens.
- `domain/platform-access.ts` and `application/platform-authorization.ts` (D11):
  - platform operators use the `sintius-platform` audience, always with MFA and never with tenant memberships;
  - their roles are `platform_tenant_provisioner` and `platform_tenant_lifecycle_operator`;
  - the permissions are `platform:tenant:provision` and `platform:tenant:lifecycle`.
- `infrastructure/postgres/credential-status.ts` checks the `credential_revocation` list on every request. The list is keyed by issuer and token ID and is read-only for the application; nothing writes it yet.
- RBAC:
  - deny-by-default catalog (`domain/authorization.ts`) and fail-closed ABAC narrowing;
  - live grant lookup (`PostgresPermissionGrantStore`), so revocation applies on the next check;
  - role administration on PostgreSQL (`security-persistence.ts`), which locks the role row;
  - last-administrator guard (D3).

**modules/audit-governance**
- Maker-checker approvals: separation of duties, distinct approvers, exact target and version matching, and compare-and-set.
- Named approver requirements (D4), credited from the approver's live grants.
- `approval_request` is append-only evidence, enforced by column-limited grants and a trigger.

**modules/foundation-proof**
- The test-only P0-010 proof command.

**apps/api**
- Fastify ingress (`src/http/server.ts`):
  - correlation and causation IDs on every request and response;
  - problem+json for every error;
  - strict request schemas;
  - `Idempotency-Key` header;
  - If-Match and ETag on lifecycle routes;
  - `X-Active-Tenant` to choose among a user's signed memberships.
- Routes are `config: { platform: true }` (platform-operator credentials only) or tenant routes; the two never accept each other's credentials.
- Composition root: `src/composition/postgres.ts`.
- `src/main.ts` (`npm start`): the runnable entry point. Uses `remoteKeySet` against a configured JWKS URL when `SINTIUS_TENANT_JWKS_URL`/`SINTIUS_PLATFORM_JWKS_URL` are set, else falls back to `src/local-development/identity.ts` — a fresh, in-memory, clearly labelled LOCAL DEVELOPMENT ONLY key set, never imported when a real provider is configured. `src/local-development/exit-demonstration.ts` (`npm run demo:exit`) runs the Phase 0 exit scenario against a migrated database using the same composition root.

**Tenant-isolation release gate** (`tests/integration/tenant-isolation.test.ts`, support in `tests/integration/support/tenant-isolation.ts`)
- It reads the live database catalog, so new tables are covered automatically.
- It fails if a table lacks forced RLS or a tenant-bound policy, or if grants differ from `PRIVILEGE_MANIFEST`.
- An A/B attack matrix runs every table as `sintius_app` and `sintius_dispatcher`.
- An injected-regression test proves the gate fails when it should.
- **When you add a table, grant or relay policy, update the manifests and add a fixture in `TENANT_TABLE_FIXTURES`.** That update is the deliberate review point.

## 4. Durable status (`docs/implementation/implementation-roadmap-data.js`)

**Phase 0 stories**

| Story | Status | Progress | Tests | Remaining |
|---|---|---|---|---|
| US-BL-001-01 tenant context | **implemented** | 100 | 3/3 passing | A Redis adapter only when multi-instance coherence is needed (optional) |
| US-BL-001-02 idempotency | **implemented** | 100 | 3/3 passing | Deterministic failed-final responses, retention source and cleanup job (deferred to Phase 6, PO-confirmed 2026-09-25) |
| US-BL-001-03 outbox | **implemented** | 100 | 2/2 passing | Continuous runtime loop with lease renewal, schema validation, gap detection, retention (deferred to Phase 1, PO-confirmed 2026-09-25) |
| US-BL-001-04 RLS | **implemented** | 100 | 2/2 passing | Alerting on RLS and missing-context denials (deferred to Phase 6, PO-confirmed 2026-09-25) |
| US-BL-001-05 problems and trace | **implemented** | 100 | 2/2 passing | UI copy (deferred to the first UI story, D16) |
| US-BL-002-01 tenant lifecycle | **implemented** | 100 | 3/3 passing | None for Phase 0. TC-002-01-01/02 were claimed `passing` with no test titled with their ID until PR 5 retitled `modules/identity-tenant/tests/tenant.test.ts`'s two domain tests to close the gap the new US-MSR-103-DOD gate found. |
| US-BL-002-02 administrator authentication | **implemented** | 100 | 2/2 passing | IdP product choice, revocation feed or command, admin-web login flow (waits on the IdP product choice, item 2 — does not block Phase 0) |
| US-BL-002-03 RBAC and maker-checker | **implemented** | 100 | 2/2 passing | Approval expiry sweeper, ApprovalPolicy management commands, ingress routes (deferred to Phase 1, PO-confirmed 2026-09-25) |
| US-BL-002-04 workload identity | **implemented** | 100 | 2/2 passing | Issuance and rotation at the IdP, mTLS later (waits on the IdP product choice, item 2 — does not block Phase 0) |
| US-BL-017-01 audit | **implemented** | 100 | 2/2 passing | PostgreSQL audit reader and `audit:read` route (deferred to Phase 1), hash-chain decision and retention (deferred to Phase 6) — PO-confirmed 2026-09-25. Carries a reviewed `reconciliationRationale`: this story is the audit-event write path, not a financial reconciliation function, so §103's reconciliation clause does not apply to it. |
| US-BL-017-03 release blocking on isolation | in_progress | 85 | 2/2 passing | Run against deployed roles once an environment exists — not part of the confirmed deferral list; needs its own explicit call once a deployed environment exists |
| US-MSR-103-DOD Definition of Done | **implemented** | 100 | 2/2 passing | None for Phase 0 — `check-pipeline-controls.mjs` (PR 5) |
| US-MSR-099-TEST-STRATEGY | **implemented** | 100 | 2/2 passing | None for Phase 0 — `check-pipeline-controls.mjs` (PR 5) |

**Requirements claimable as of PR 5**

- `MSR-058-C69192855F`, `MSR-058-2CCE1DD0DC`, `MSR-100-D1A3F8F46A`, `MSR-060-D685CE4383` and 12 others predate PR 5 (16 total).
- `MSR-080-3B6F4B3FE4` (OIDC/OAuth2) and `MSR-080-477F636C27` (MFA) are new in PR 5: each is demonstrated by its own directly titled test (`TC-MSR-080-3B6F4B3FE4`, `TC-MSR-080-477F636C27` in `modules/identity-tenant/tests/jwt-authentication.test.ts`), claimed honestly through `docs/implementation/specification-test-status.json` (`tools/requirements/specification-test-status.ts`), which `tools/requirements/implementation-evidence.ts` now merges into its roadmap-test-status lookup so specification-derived tests (not only the 103 canonical stories) can carry evidence. **18 of 1,335** total.
- `MSR-080-A555453F8D` (SAML SSO) is federated through the IdP and is not demonstrable in-repo. It is not claimed and its overlay status stays `not_run`.

## 5. Open items and choices awaiting the Product Owner

1. **D9 persona matrix.** Done: reviewed by the PO on 2026-09-25 (`docs/implementation/persona-permission-matrix.md`).
2. **Identity-provider product.** Candidates are Entra ID, Okta, Auth0, Cognito or Keycloak. It must support OIDC, MFA (emitting `amr` = `mfa`), SAML federation and client credentials. This does not block Phase 0.
3. **Phase 0 deferrals — confirmed by the Product Owner, 2026-09-25:**
   - to Phase 1: the continuous dispatcher runtime (US-BL-001-03), the approval expiry sweeper and policy commands (US-BL-002-03), and the PostgreSQL audit reader (US-BL-017-01);
   - to Phase 6: retention and cleanup jobs including idempotency's deterministic failed-final responses (US-BL-001-02), Redis, audit hash-chaining and retention (US-BL-017-01), the move to Kafka, and alerting on RLS and missing-database-context denials (US-BL-001-04), which was implemented but never explicitly placed in a deferral bucket;
   - US-BL-002-02 (IdP product choice, a revocation feed or command, and the admin-web login flow) and US-BL-002-04 (credential issuance/rotation at the IdP, mTLS) both wait on the identity-provider product choice (item 2) rather than a Phase target; their remaining scope defers to whichever phase follows that choice.
   All the stories above are now marked `implemented`, per `docs/implementation/phase-0-exit-report.md`. US-BL-017-03 was not part of this confirmation and stays `in_progress` (see section 4).
4. **Outbox sequence grant.** `sintius_app` holds `SELECT, USAGE` on `outbox_event_entry_id_seq` (from migration 005), which it does not need. It is recorded in the privilege manifest for now; revoking it takes a one-line migration if the PO agrees.
5. **D7 (UUIDv7 primary keys).** Accepted, not yet implemented. It is cheapest before Phase 1 adds billing tables, so do it right after Phase 0 exit.

## 6. What to do next (the Phase 0 exit plan; PRs 1–5 are done)

**PR 4 (done): D9 persona permission matrix.** See `modules/identity-tenant/domain/persona-matrix.ts` and `docs/implementation/persona-permission-matrix.md`. When a later story adds a permission, add its persona grants there with a basis and sources, regenerate the document table from `renderPersonaMatrix()`, and get the Product Owner's decision on anything inferred or proposed.

**PR 5 (done): exit package.** `tools/requirements/story-dod.ts` and `tools/requirements/test-strategy.ts` are the US-MSR-103-DOD and US-MSR-099-TEST-STRATEGY pipeline controls, run in CI by `npm run check:pipeline-controls` (`check-pipeline-controls.mjs`) against this run's TAP reports, the same way `check:evidence` verifies implementation evidence. `docs/implementation/specification-test-status.json` is the durable status overlay for specification-derived test IDs. `npm start` (`apps/api/src/main.ts`) composes the API on PostgreSQL with a configured identity provider or a clearly labelled local-development-only key set (`apps/api/src/local-development/identity.ts`); `npm run demo:exit` (`apps/api/src/local-development/exit-demonstration.ts`) runs the scripted exit demonstration. `docs/implementation/golden/money-proration-allocation.json` and `platform/money/tests/golden-dataset.test.ts` are the golden-dataset determinism/provenance check. The Product Owner confirmed the proposed deferrals (section 5 item 3) and approved the merge in-session on 2026-09-25; twelve of the thirteen Phase 0 stories are now `implemented` (all but US-BL-017-03, section 4).

**After Phase 0 (needs the Product Owner's confirmation of section 5 item 3 first):** D7 UUIDv7 migration, then Phase 1 billing domains, per `docs/pre-implementation/21-technical-implementation-plan.md`.

## 7. Definition of done for any tranche

- **Tests prove the change.** Include tests that fail without the implementation, and confirm that by mutation: break the guard and watch the test fail. Say so if you could not confirm it.
- **New artifacts are registered:**
  - new problem codes in the catalog and golden test;
  - new unit test files in `tests/all.test.ts`;
  - new PostgreSQL test files in `tools/test/run-suite.mjs`;
  - new tables and events in `module.json`;
  - new tables and grants in the isolation-gate manifests.
- **Status reflects only what is proven.** Update the roadmap status only to the level you proved. Run `npm run requirements:generate` when its inputs changed. `npm run check` is green, and `npm ci` succeeds when dependencies changed.
- **Docs are current.** Update the README implementation slice, `phase-0-backlog.md` and this prompt when the state changes.
- **Before any commit:**
  - run `git status` and review what is staged;
  - scan for secret-shaped strings;
  - keep model or tool identifiers out of commits and PRs.
- **Final report** contains:
  - story and epic IDs with MSR IDs;
  - files changed;
  - the exact commands run, with pass and fail counts;
  - roadmap status changes;
  - what remains;
  - decisions needed;
  - the three-statement separation from section 1.

  Do not claim anything you did not run.

# Codex implementation handover prompt

Copy everything below the divider into Codex. Set the working directory to the repository root (the folder that contains `package.json`).

State as of 2026-09-25, `master` at the merge of PR #8. PRs #1–#8 are merged.

---

You are continuing implementation of the **Sintius AI-native Subscription and Revenue Platform**. Work as a production implementation agent:

- inspect before you edit and preserve traceability;
- implement one bounded tranche at a time, with tests;
- run the full gate before you report;
- report only what you actually proved.

Phase 0 (the platform foundation) is close to exit. Most of what remains is listed in section 6, and two items need the Product Owner.

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
- **A mapped requirement is not an implemented one.** Implementation evidence lives in `docs/implementation/implementation-evidence.json`; it stood at **15 of 1,335** at handover. Claim a requirement only when all of these hold:
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

**Tests and gate**

- `npm test` runs the unit suite. Every unit test file must be imported from `tests/all.test.ts`.
- `npm run test:postgres` runs the PostgreSQL suite. Its files are listed explicitly in `tools/test/run-suite.mjs` and run one at a time, because they share a database. Add each new database test file there.
- `npm run check` runs the whole local gate: typecheck, architecture, roadmap, requirement coverage, unit tests and the PostgreSQL suite.
- `npm run check:evidence` re-verifies evidence claims against the TAP reports. To run it locally, first run the suites with `SINTIUS_TEST_REPORT_DIR=reports`.
- **Baseline at handover:** 173 unit and 38 PostgreSQL tests, all passing (211 in total). Run `npm run check` before editing and confirm this baseline.

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

**Tenant-isolation release gate** (`tests/integration/tenant-isolation.test.ts`, support in `tests/integration/support/tenant-isolation.ts`)
- It reads the live database catalog, so new tables are covered automatically.
- It fails if a table lacks forced RLS or a tenant-bound policy, or if grants differ from `PRIVILEGE_MANIFEST`.
- An A/B attack matrix runs every table as `sintius_app` and `sintius_dispatcher`.
- An injected-regression test proves the gate fails when it should.
- **When you add a table, grant or relay policy, update the manifests and add a fixture in `TENANT_TABLE_FIXTURES`.** That update is the deliberate review point.

## 4. Durable status (`docs/implementation/implementation-roadmap-data.js`)

**Phase 0 stories**

| Story | Progress | Tests | Remaining |
|---|---|---|---|
| US-BL-001-01 tenant context | 98 | 3/3 passing | A Redis adapter only when multi-instance coherence is needed |
| US-BL-001-02 idempotency | 92 | 3/3 passing | Deterministic failed-final responses, retention source and cleanup job |
| US-BL-001-03 outbox | 90 | 2/2 passing | Continuous runtime loop with lease renewal, schema validation, gap detection, retention |
| US-BL-001-04 RLS | 90 | 2/2 passing | Alerting on RLS and missing-context denials |
| US-BL-001-05 problems and trace | 95 | 2/2 passing | UI copy (deferred to the first UI story, D16) |
| US-BL-002-01 tenant lifecycle | 98 | 3/3 passing | None for Phase 0 |
| US-BL-002-02 administrator authentication | 90 | 2/2 passing | IdP product choice, revocation feed or command, admin-web login flow |
| US-BL-002-03 RBAC and maker-checker | 70 | 1/2 (TC-002-03-01 partial) | **D9 persona matrix**, approval expiry sweeper, ApprovalPolicy management commands, ingress routes |
| US-BL-002-04 workload identity | 85 | 2/2 passing | Issuance and rotation at the IdP, mTLS later |
| US-BL-017-01 audit | 75 | 2/2 passing | PostgreSQL audit reader and `audit:read` route, hash-chain decision, retention |
| US-BL-017-03 release blocking on isolation | 85 | 2/2 passing | Run against deployed roles once an environment exists |
| US-MSR-103-DOD Definition of Done | 0 | 0/2 | Pipeline control (PR 5) |
| US-MSR-099-TEST-STRATEGY | 0 | 0/2 | Pipeline control (PR 5) |

**Requirements not yet claimable**

- The identity requirements `MSR-080-3B6F4B3FE4` (OIDC/OAuth2) and `MSR-080-477F636C27` (MFA) are demonstrated by code and tests.
- They cannot be claimed yet, because they map to specification-derived stories (US-MSR-080-01) whose test IDs have no status in the roadmap data. `tools/requirements/implementation-evidence.mjs` reads statuses only from the 103 canonical stories.
- `MSR-080-A555453F8D` (SAML SSO) is federated through the IdP and is not demonstrable in-repo. Do not claim it.

## 5. Open items and choices awaiting the Product Owner

1. **D9 persona matrix.** Awaiting the draft and the PO review; see section 6.
2. **Identity-provider product.** Candidates are Entra ID, Okta, Auth0, Cognito or Keycloak. It must support OIDC, MFA (emitting `amr` = `mfa`), SAML federation and client credentials. This does not block Phase 0.
3. **Proposed Phase 0 deferrals, not yet explicitly confirmed:**
   - to Phase 1: the continuous dispatcher runtime, the approval expiry sweeper and policy commands, and the PostgreSQL audit reader;
   - to Phase 6: retention and cleanup jobs, Redis, audit hash-chaining, and the move to Kafka.
4. **Outbox sequence grant.** `sintius_app` holds `SELECT, USAGE` on `outbox_event_entry_id_seq` (from migration 005), which it does not need. It is recorded in the privilege manifest for now; revoking it takes a one-line migration if the PO agrees.
5. **D7 (UUIDv7 primary keys).** Accepted, not yet implemented. It is cheapest before Phase 1 adds billing tables, so do it right after Phase 0 exit.

## 6. What to do next (the Phase 0 exit plan; PRs 1–3 are done)

Work in order, one PR each, and stop to report after each.

**PR 4: D9 persona permission matrix** (US-BL-002-03, TC-002-03-01)

1. Master spec §61 lists 12 personas but no grants. Draft `docs/implementation/persona-permission-matrix.md` (or JSON plus a rendered table): personas × `PERMISSION_CATALOG` entries.
2. Mark each cell either *spec-derived*, citing its source (API spec §4, the UX information architecture, SUB-0014 or similar), or *proposed*.
3. Only spec-derived grants may ship by default. Proposed cells stay denied until the Product Owner approves them.
4. **Stop and ask the Product Owner to review before encoding it.**
5. After approval, encode the default role templates and add an automated allow/deny matrix test titled `TC-002-03-01 …` that covers every persona and permission. Then mark TC-002-03-01 `passing`.

**PR 5: exit package**

1. **Pipeline controls.**
   - US-MSR-103-DOD: the pipeline rejects a story marked `implemented` unless all of its tests are `passing` and passed in CI. Extend `tools/requirements/check-evidence.mjs` or add a sibling check.
   - US-MSR-099-TEST-STRATEGY: require each applicable suite class to be present, and add a golden-dataset determinism check (for example over `platform/money` proration and allocation).
   - Title the tests with their TC IDs.
2. **Status for specification-derived tests.** Add a durable status overlay for their test IDs, in the roadmap data or a new input file validated by the generator, so requirements such as MSR-080 OIDC and MFA can be claimed honestly.
3. **Runnable preview.**
   - Add an `npm start` entry point composing the API on PostgreSQL. Use `jose` with a configured JWKS URL, or a clearly labelled local-development key set.
   - Add a scripted exit demonstration: provision a tenant as a platform operator, sign in, run a command twice with one idempotency key, show exactly one record, audit event and outbox event, and show tenant B seeing nothing.
4. **Close the phase.** Mark each Phase 0 story `implemented` only where every test is passing and nothing Phase-0-scoped remains. Write a short exit report for the Product Owner.

**After Phase 0:** D7 UUIDv7 migration, then Phase 1 billing domains, per `docs/pre-implementation/21-technical-implementation-plan.md`.

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

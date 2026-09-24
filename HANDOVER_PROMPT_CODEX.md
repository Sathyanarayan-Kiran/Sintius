# Codex implementation handover prompt

Copy everything below the divider into Codex with the working directory set to the repository root (the folder containing `package.json`).

---

You are continuing implementation of the **Sintius AI-native Subscription and Revenue Platform**. Work as a production implementation agent: inspect before editing, preserve traceability, implement one bounded tranche at a time with tests, run the gate, and report only what you proved. Phase 0 unit-level foundations are done; what remains is mostly persistence, ingress and decisions that need the Product Owner.

## 1. Read first (in this order)

1. `HANDOVER_PROMPT_CLAUDE_CODE.md` (repo root). It is tool-agnostic and binding: ground-truth precedence, traceability chain, generated-file rules, reporting format.
2. `README.md`, `docs/CANONICAL_SPEC_INDEX.md`, `docs/implementation/README.md`, `docs/implementation/phase-0-backlog.md`, `docs/pre-implementation/23-coding-standards.md`, `docs/pre-implementation/24-testing-strategy.md`.
3. The domain sources for whatever you touch (for example `docs/pre-implementation/14-event-taxonomy.md` for events, `15-security-architecture.md` for audit and authorization, `16-multi-tenancy-architecture.md` for RLS, `13-api-specification.md` for API and idempotency, `07-data-model-erd.md` for tables).

Do not restart discovery or regenerate a smaller backlog.

**Non-negotiables**
- Ground-truth precedence: master specification, canonical index, decision ledger, generated registers, detailed specs, then code.
- Never hand-edit generated files. Edit `docs/implementation/implementation-roadmap-data.js` (durable status) or the generator inputs, then run `npm run backlog:generate`.
- Keep three statements separate in every report: "Backlog traceability: complete", "Implementation coverage: incomplete", "Automated execution: only what actually ran".
- A mapped requirement is not implemented. A planned test is not a passing test. Never claim 100% from mapping percentages. Implementation evidence is 0 of 1,335 requirements; no durable evidence overlay exists yet for source-derived stories.
- Do not reopen resolved decisions: TypeScript on Node.js 24 LTS, PostgreSQL, modular monolith with workers, transactional outbox/inbox, REST/OpenAPI, US/USD MVP.
- Open decisions and spikes (SPIKE-02 decimal/money, SPIKE-03 ID scheme, SPIKE-05 usage throughput, SPIKE-06 rounding, Stripe scope, AI autonomy and identity-provider choices) need a written proposal and Product Owner confirmation. Do not silently choose. Local PostgreSQL execution is resolved as Docker Compose with PostgreSQL 17.
- Never mark a roadmap test `passing` unless the whole named behavior was demonstrated. A pure aggregate plus an in-memory double justifies `partial`, not `passing`.

## 2. Environment and repository

- Windows. Use `npm.cmd run check`, `npm.cmd test`, `npm.cmd run check:postgres`, `npm.cmd run backlog:generate` (use `npm` on other shells). `check` = architecture, roadmap, requirement coverage, unit tests and PostgreSQL integration tests.
- Code style: ESM and erasable TypeScript only (no enums, namespaces, parameter properties; use `import type`, `#private` fields, `import.meta.dirname`). Node runs TypeScript directly. Runtime dependency `pg` is pinned for PostgreSQL. Unit tests are imported from `tests/all.test.ts`; database integration tests stay in the explicit `test:postgres` suite so `npm test` remains usable without Docker.
- **There is no type checker.** `tsc` is not installed and Node only strips types, so type errors are not caught by `npm run check`. Propose a TypeScript dev dependency to the Product Owner rather than adding it silently.
- Modules must not import other modules' internals. `tools/architecture-lint` validates each `modules/*/module.json` (ownedTables, publishedEvents, allowedModuleDependencies). Shared code lives in `platform/`.
- Git: branch `master`, remote `origin` = `https://github.com/Sathyanarayan-Kiran/Sintius.git`. Latest commit `64d1794`. Commit and push only when the user asks.
- GitHub push protection scans for secret patterns. Do not put literal secret-shaped strings (for example `sk_test_...`) in source or tests, even fake or documented ones; build them at runtime (`"sk_" + "test_..."`). History was rewritten once to remove one; a local branch `backup-before-secret-fix` still holds the flagged string and must never be pushed.
- Git prints many "LF will be replaced by CRLF" warnings on this machine; they are harmless.
- Local database: Docker Compose runs PostgreSQL 17 on `127.0.0.1:54329`; `db:up` waits for health, `db:migrate` applies checksum-protected forward-only migrations, and `db:down` retains the named volume. Compose trust authentication is strictly local-development configuration.
- Baseline: `npm run check` passes with **119 unit tests plus 4 PostgreSQL integration tests (123 total)**. Run it before editing and confirm.

## 3. What exists (verify by reading; do not trust this list blindly)

Most platform ports below are unit-tested against **in-memory test doubles**. The identity-tenant lifecycle is the exception: it has a real PostgreSQL adapter and integration evidence for transactions, forced RLS, rollback and concurrent compare-and-set. Do not generalize that evidence to idempotency, dispatcher/inbox, approval or audit-reader adapters that do not yet exist.

### platform/problem-model (P0-002 / US-BL-001-05, epic SUB-E001)
RFC 7807/9457 problems with a frozen, contract-tested code catalog (`src/catalog.ts`), trace IDs, redaction (`redactSensitiveText`), and an error boundary. **Every `problem({ code })` literal must be registered in the catalog and the golden test in `tests/problem-model.test.ts`**; a repo-scan test enforces this. Tests TC-001-05-01/02 are `passing`.

### platform/tenant-context (P0-001 / US-BL-001-01)
Trusted principal and tenant context boundaries: authentication issues WeakSet-backed principals after credential verification; tenant and platform resolvers reject principal-shaped object literals and recheck credential expiry before issuing a context. Tenant contexts use AsyncLocalStorage; only resolver-issued contexts are accepted; nested tenant, actor, kind, assurance, credential, audience or scope switching is rejected; tenant identity in command input is rejected fail-closed (depth-limited); tenant-scoped cache keys and a tenant-bound transaction port are present. `PlatformCommandContext` covers commands for which no tenant exists yet, such as provisioning. Both contexts carry `assurance`, `credentialId`, `audiences` and `scopes`.

### platform/event-envelope
CloudEvents-style envelope conforming to `docs/pre-implementation/contracts/events/envelope.schema.json`. Tenant, actor, correlation and causation come only from a trusted `EventScope`; payload may not restate tenant identity. Event id default `evt_<uuid>` pending SPIKE-03.

### platform/idempotency (P0-006 / US-BL-001-02)
Deterministic canonical hashing, `IdempotencyStore` atomic-claim contract, and `createIdempotentExecutor`: validates key (16 to 128 URL-safe chars) and scope, rejects tenant identity in payload, **authorizes before any lookup**, claim then work then complete in one transaction, replay returns the stored response, different payload gives 409, in-flight gives `request_in_progress`, default retention 7 days. Module unit-of-work types must expose `idempotency: IdempotencyStore`. **The tenant lifecycle commands are not yet wrapped in it.**

### platform/outbox (P0-007 / US-BL-001-03)
`OutboxWriter`, `OutboxStore` (lease contract: at most one lease per aggregate stream, head-of-line blocking), `EventPublisher`, `InboxStore`; `createOutboxDispatcher` (ordered delivery, exponential backoff 5s doubling to 15 min, redacted errors, dead-lettering including crash-looping events, lease-loss handling); `createIdempotentConsumer` (dedup per consumer and tenant, rolled back with the handler); `createDeadLetterOperations` (operator requeue or skip).
**Dead-letter policy (a design choice of mine; confirm with the Product Owner):** a dead-lettered event blocks later events of the same aggregate (order over liveness); the dispatcher never skips by itself; an authorized operator must requeue or skip with a mandatory reason; skip keeps the envelope as evidence and unblocks the stream; resolution needs `outbox:dead_letter:resolve` and is audited against the affected tenant in the same transaction. `OutboxStats.blockedStreams` and `oldestDeadLetterAgeSeconds` are the alert signals. Modules still use their own structurally-compatible outbox-writer types rather than importing `OutboxWriter`.

### platform/audit (P0-008 / US-BL-017-01)
`AuditEvent` is deep-frozen and stamped only from trusted context, carries a SHA-256 `evidenceHash` (`verifyAuditEvent`). `createAuditPolicy` is a deny-by-default per-target allow-list (secret-like field names cannot be allow-listed); `toSafeSnapshot` redacts. `createAuditRecorder` (`recordForCurrentContext`, `recordForPlatformCommand`): a failed append propagates so the transaction rolls back and `onWriteFailure` alerts. `createAuditReader`: permissioned (`authorize` callback), tenant-scoped, paged (limit max 500), and every read is itself audited. Modules export their audit field lists (`TENANT_AUDIT_FIELDS`, `ROLE_AUDIT_FIELDS`, `APPROVAL_AUDIT_FIELDS`, `OUTBOX_AUDIT_FIELDS`); the app root composes them into one policy. No hash chaining (decision open).

### modules/identity-tenant
- P0-003 / US-BL-002-01: pure tenant aggregate (`domain/tenant.ts`) and commands (`application/tenant-commands.ts`): provision, activate, suspend, reactivate, close. Authorize first (deny-by-default `PlatformAuthorizer` port), then one unit of work writing tenant, default `tenant_administrator` role, initial administrator membership, audit event and outbox envelope. Reasons required for suspend and close. `infrastructure/postgres/tenant-persistence.ts` is the real adapter; the migration enables and forces tenant RLS and grants the application role only INSERT on audit/outbox. The PostgreSQL suite proves commit, rollback, tenant A/B isolation and lifecycle CAS concurrency.
- P0-004 / US-BL-002-02 and US-BL-002-04 (written by you earlier): provider-neutral authentication (`application/authentication*.ts`): OIDC/SAML and workload policy; enforces mechanism, issuer, audience, lifetime, MFA, revocation, tenant binding, workload scopes, and workload/interactive separation. Uses a verifier test double; **no production cryptographic adapter, session store or key discovery exists.**
- P0-005 / US-BL-002-03: `domain/authorization.ts` (frozen permission catalog from `13-api-specification.md` section 4 plus tenant, approval and dead-letter permissions; deny-by-default `effectivePermissions`; fail-closed ABAC `constraintsSatisfied` that only narrows), `application/authorization.ts` (`createTenantAuthorizer` with live role lookup so revocation applies on the next command; workload principals need the permission as an explicit scope; `createRoleAdministration` requires `tenant:role:assign` and blocks changing your own roles, which is my addition beyond the spec). Default administrator role holds only `tenant:role:manage` and `tenant:role:assign`.

### modules/audit-governance
Owns `approval_request` (Audit & Governance, per the canonical sources); `approval_policy` stays with identity-tenant and is read through a port. `domain/approval.ts`: PENDING, APPROVED, REJECTED, EXPIRED, CANCELLED; separation of duties per policy; distinct approvers; exact action/resource/version matching; version compare-and-set; cancel (maker only); expire (time-driven). `application/approval-commands.ts`: propose, decide, cancel. Deciding needs `approval:request:decide`, an interactive principal and MFA. Decision, audit event and outbox event commit in one unit of work.

## 4. Durable status (in `docs/implementation/implementation-roadmap-data.js`)

| Story | Epic | Progress | Tests | Main remaining work |
|---|---|---|---|---|
| US-BL-001-05 (P0-002) | SUB-E001 | 80 | 2 `passing` | HTTP ingress adapter, ingress correlation propagation, metrics, UI copy |
| US-BL-001-01 (P0-001) | SUB-E001 | 90 | TC-001-01-03 `partial` | PostgreSQL/RLS binding is proven; worker/job context and real cache adapter remain |
| US-BL-001-02 (P0-006) | SUB-E001 | 50 | 3 `partial` | PostgreSQL unique-index adapter and migration, HTTP header and Retry-After, failed-final storage, retention source, cleanup job, metrics |
| US-BL-001-03 (P0-007) | SUB-E001 | 50 | 2 `partial` | outbox table/atomic insert proven; PostgreSQL leasing/inbox adapter, broker, schema validation, runtime, gap detection, metrics and retention remain |
| US-BL-001-04 (P0-009) | SUB-E001 | 25 | 2 `partial` | seven foundation tables use forced RLS; extend to all tenant tables and automate the complete A/B CRUD matrix |
| US-BL-002-01 (P0-003) | SUB-E002 | 85 | 3 `passing` | idempotency wrapper, reviewed platform RBAC, HTTP ingress |
| US-BL-002-02 (P0-004) | SUB-E002 | 70 | 2 `partial` | real OIDC/SAML signature and key discovery, durable sessions, security audit facts |
| US-BL-002-04 (P0-004) | SUB-E002 | 70 | 1 `partial`, 1 `passing` | signed-token or mTLS adapter, issuance and rotation |
| US-BL-002-03 (P0-005) | SUB-E002 | 50 | 2 `partial` | PostgreSQL adapters and RLS, ingress permission declaration, ApprovalPolicy management, expiry sweeper, platform-role scoping, replace `PlatformAuthorizer` port, metrics |
| US-BL-017-01 (P0-008) | SUB-E017 | 55 | 2 `partial` | audit table/INSERT-only grant and lifecycle atomicity proven; explicit privilege test, reader adapter, retention, ingress, wider adoption and operational gates remain |

Do not mark all of US-MSR-080-01 implemented: it also covers authorization, encryption, key management, secrets and rate limiting outside this work. The authentication slice traces to `MSR-080-3B6F4B3FE4` (OIDC/OAuth2), `MSR-080-A555453F8D` (SAML) and `MSR-080-477F636C27` (MFA).

## 5. Known gaps and design choices to review

Gaps found in review (fix or raise them):
1. The tenant lifecycle commands are not idempotent-wrapped. Identity-tenant now uses `platform/outbox`'s shared `OutboxWriter`.
2. The `PlatformAuthorizer` for provisioning and lifecycle is only a deny-by-default port; platform roles are not modeled.
3. Only three modules' commands audit through the shared recorder plus dead-letter resolution; every future material command must too.
4. Audit-write-failure paging, the metrics named in the backlog, and the log/trace secret-scan release gate are not built.

Design choices I made that the Product Owner has not confirmed: dead-letter blocks its own stream (section 3); the Idempotency-Key format is lenient (16 to 128 URL-safe characters) whereas the API spec says client-generated UUID; a role administrator cannot change their own assignments; generic approval permissions (`approval:request:propose`, `approval:request:decide`) rather than per-action ones; ABAC constraints are data-driven (`eq`, `in`, `lt`, `lte`, `gt`, `gte`); audit has an evidence hash but no chain.

## 6. What to do next

Do these in order, one bounded tranche at a time, and stop to report after each.

**A. Decision-independent work**
1. Wrap the tenant lifecycle commands in `createIdempotentExecutor`; the shared `OutboxWriter` migration is already complete.
2. Consumer-side `aggregate_version` gap detection helper for use after a dead-letter skip.
3. Propose (do not silently add) a type-check step, and propose a permission or role matrix review for the 12 personas.
4. An HTTP ingress adapter design note for `apps/api` (correlation and causation IDs, `Idempotency-Key`, `Retry-After`, problem+json). Build it only if the Product Owner approves the framework choice; the repo has no web framework yet.

**B. PostgreSQL tranche (Docker Compose decision resolved)**
1. **Complete for tenant lifecycle:** migration and adapter for identity-tenant, transaction-local tenant binding, forced RLS, repository filters, commit/rollback and CAS concurrency evidence. TC-002-01-03 is `passing`; TC-001-01-03 is conservatively `partial` until the real cache and worker/job paths are integrated.
2. Next add adapters for idempotency (unique index and a real concurrent-race test), outbox (SKIP LOCKED leasing), audit (no UPDATE or DELETE grant, tested), then approvals.
3. Extend **P0-009** (`BL-001-04`, `BL-017-03`) across every tenant-owned table and add the full tenant A/B CRUD matrix. Current proof covers the seven tables in the first migration, but the roadmap story is broader.
4. Build **P0-010**, the Phase 0 proof command: establish trusted authenticated context, execute an idempotent mutation twice with one key, and prove one mutation, one audit event and one outbox event committed atomically.

**C. Blocked on identity-provider choices**
Production OIDC/JWKS, SAML certificate and workload signed-token or mTLS adapters, durable session and revocation storage, authentication audit facts. Propose options; do not select vendors or libraries silently.

## 7. Definition of done for any tranche

- Implementation plus tests that fail without the implementation (say so if you could not confirm this).
- New problem codes registered in the catalog and golden test; new test files imported from `tests/all.test.ts`; new module tables and events declared in `module.json`.
- Roadmap status updated only to the level proven; `npm run backlog:generate` run when inputs changed; `npm run check` green.
- README "Current implementation slice" updated if scope changed; this prompt updated if the state changed.
- Before any commit: `git status`, review what is staged, scan for secret-shaped strings.
- Final report contains: story and epic IDs with MSR IDs, files changed, exact commands run with pass/fail counts, roadmap status changes, what remains, decisions needed, and the three-line separation from section 1. Do not claim anything you did not run.

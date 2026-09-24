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
- Baseline at handover: `npm run check` passes, 105 of 105 tests. Run it before editing and confirm.

## 3. What exists now (verify by reading, do not trust this list blindly)

- `platform/problem-model` (P0-002 / US-BL-001-05): RFC 7807/9457 problems, frozen code catalog (`catalog.ts`), trace IDs, redaction, error boundary. Every `problem({ code })` literal in the repo must be registered in the catalog; a repo-scan test enforces it. Adding a code means updating the catalog and the golden test.
- `platform/tenant-context` (P0-001 / US-BL-001-01): trusted tenant context via AsyncLocalStorage, only resolver-issued contexts accepted, nested tenant/actor switching rejected, tenant identity in command input rejected (fail closed), tenant-scoped cache keys, tenant-bound transaction port, and `PlatformCommandContext` for platform-scoped commands.
- `platform/event-envelope`: CloudEvents-style envelope conforming to `docs/pre-implementation/contracts/events/envelope.schema.json`; tenant, actor and correlation come only from trusted scope; payload may not restate tenant identity. Event id is a working default `evt_<uuid>` pending SPIKE-03.
- `modules/identity-tenant` (P0-003 / US-BL-002-01): pure tenant aggregate (`domain/tenant.ts`) plus application layer (`application/ports.ts`, `application/tenant-commands.ts`). Handlers: provision, activate, suspend, reactivate, close. Authorize first, then one unit of work writing tenant, default administrator role, initial administrator membership, audit record and outbox envelope.
- `modules/identity-tenant` authentication slice (P0-004 / US-BL-002-02 and US-BL-002-04): provider-neutral verifier, policy and revocation ports plus interactive OIDC/SAML and workload authentication policy. It enforces mechanism, issuer, audience, expiry/not-before, MFA, revocation, tenant binding, workload operation scopes and separation from interactive sessions. Authenticated credential/audience/scope data propagates into tenant and platform contexts, and nested context replacement cannot change it. Tests use a verifier test double; no production cryptographic/provider adapter or durable session store exists.
- P0-005 / US-BL-002-03, split by ownership. `modules/identity-tenant`: `domain/authorization.ts` (frozen permission catalog, deny-by-default `effectivePermissions`, fail-closed ABAC `constraintsSatisfied`), `application/authorization.ts` (`createTenantAuthorizer` with live role lookup so revocation applies on the next command; workload principals need explicit scopes; ABAC only narrows; `createRoleAdministration` requiring `tenant:role:assign`, no self-change), ports in `authorization-ports.ts`. `modules/audit-governance` (owns `approval_request`; `approval_policy` stays with identity-tenant and is read through a port): `domain/approval.ts` (PENDING/APPROVED/REJECTED/EXPIRED/CANCELLED, separation of duties, distinct approvers, exact action/resource/version match, version CAS, cancel, expire) and `application/approval-commands.ts` (propose/decide/cancel; deciding needs an interactive principal with MFA; atomic decision + audit + outbox). `TenantContext` and `PlatformCommandContext` now carry `assurance`. Test doubles: `identity-tenant/tests/in-memory-security.ts`, `audit-governance/tests/in-memory-approvals.ts`.
- `platform/idempotency` (P0-006 / US-BL-001-02): `canonical.ts` (deterministic hashing), `ports.ts` (`IdempotencyStore` atomic-claim contract, maintenance and persistence ports), `executor.ts` (`createIdempotentExecutor`: validates key and scope, rejects tenant identity in payload, authorizes BEFORE lookup, claim then work then complete in one transaction, replay/409/in-progress mapping). Module unit-of-work types must expose an `idempotency: IdempotencyStore`. `tests/in-memory-idempotency.ts` is a TEST DOUBLE that models per-key serialization.
- `platform/outbox` (P0-007 / US-BL-001-03): `ports.ts` (`OutboxWriter`, `OutboxStore` lease contract, `EventPublisher`, `InboxStore`), `dispatcher.ts` (`createOutboxDispatcher`, `defaultRetryDelaySeconds`), `inbox.ts` (`createIdempotentConsumer`). `tests/in-memory-outbox.ts` is a TEST DOUBLE. The existing modules still write to their own local outbox-writer types; they are structurally compatible with `OutboxWriter` but not yet wired to it.
- `modules/identity-tenant/tests/in-memory-persistence.ts` is a TEST DOUBLE. It is not evidence of PostgreSQL atomicity.

## 4. Durable status at handover (in `docs/implementation/implementation-roadmap-data.js`)

- US-BL-001-05: tests TC-001-05-01/02 passing, progress 80.
- US-BL-001-01: progress 85; TC-001-01-03 (trusted tenant reaches a real transaction) is `not_run`.
- US-BL-002-01: progress 60; TC-002-01-03 (atomic tenant/default-role/admin persistence) is `not_run`.
- US-BL-002-02: progress 65; both roadmap tests are `partial`. Provider-neutral claim enforcement is tested, but real OIDC/SAML signature/key discovery, durable sessions and security audit facts remain.
- US-BL-002-04: progress 65; workload audience/scope enforcement is `partial`, while workload/interactive identity separation is `passing`. A production signed-token or mTLS adapter, issuance and rotation remain.
- The authentication slice traces through US-MSR-080-01 to `MSR-080-3B6F4B3FE4` (OIDC/OAuth2), `MSR-080-A555453F8D` (SAML) and `MSR-080-477F636C27` (MFA). Do not mark all of US-MSR-080-01 implemented: it also contains authorization, encryption, key management, secret-management and rate-limiting requirements outside this tranche.
- Implementation evidence overall: 0 of 1,335 requirements. No durable evidence overlay exists yet for source-derived stories; create one before claiming any of them implemented.

- US-BL-002-03: progress 50; both roadmap tests `partial` (in-memory doubles only; the allow/deny matrix covers a fixture, not a reviewed 12-persona matrix). Remaining: PostgreSQL adapters and RLS, ingress permission declaration, ApprovalPolicy management, approval expiry sweeper, platform-role scoping and replacing the `PlatformAuthorizer` port, metrics.

### Known gaps found in review

- `resolveTenantContext` / `resolvePlatformCommandContext` accept any structurally valid `AuthenticatedPrincipal`; nothing proves it came from `createAuthenticator`. Consider issuing principals via a WeakSet-backed constructor (as done for contexts) before wiring HTTP ingress.
- `AuthenticatedPrincipal.expiresAt` is carried but not enforced at context resolution.

- US-BL-001-02: progress 50; all three roadmap tests `partial`. Remaining: PostgreSQL unique-index adapter and migration, HTTP ingress (header, Retry-After), failed-final storage, per-tenant retention source, cleanup job, metrics. The tenant lifecycle commands are not yet wrapped in the executor.

- US-BL-001-03: progress 45; both roadmap tests `partial`. Dead-letter policy (decided): a dead-lettered event blocks later events of the same aggregate, the dispatcher never skips by itself, and `createDeadLetterOperations` lets an authorized operator requeue or skip with a mandatory reason and operator id (skip keeps the envelope, unblocks the stream, and is recorded on the entry). `OutboxStats.blockedStreams` and `oldestDeadLetterAgeSeconds` are the alert signals. Remaining: a permission-catalog entry and audit linkage for dead-letter resolution (P0-005/P0-008), consumer-side `aggregate_version` gap detection after a skip, PostgreSQL adapter (SKIP LOCKED), broker adapter (undecided), schema-registry validation, consumer DLQ, dispatcher runtime and lease renewal, dispatcher RLS role, metrics export, retention.

## 5. Recommended next tranche

Do these in order, one bounded tranche at a time, and stop to report after each.

1. **PostgreSQL adapter for identity-tenant (finishes TC-001-01-03 and TC-002-01-03).** Blocked on one decision: how Postgres runs locally and in CI (Docker Compose, testcontainers, or a hosted instance). Propose an option with trade-offs and ask the Product Owner; do not pick silently. Once decided: implement `TenantPersistence`/`TenantUnitOfWork` against real PostgreSQL, the tables owned by identity-tenant (`tenant`, `tenant_identity_provider`, `tenant_role`, `tenant_role_assignment`), migrations, and an integration test proving atomic commit and rollback plus tenant-bound transaction binding. Only then mark those two tests `passing`.
2. **Finish P0-004 production adapters.** This requires explicit provider/runtime choices for OIDC/JWKS, SAML certificates and workload signed-token or mTLS verification; do not silently select vendors or libraries. Add durable session/revocation persistence and authentication audit facts before changing the two partial roadmap tests to passing.
3. ~~P0-005~~ done at unit level; production adapters ride with item 1.
4. ~~P0-006~~ done at unit level. ~~P0-007~~ done at unit level. **P0-008** audit (next decision-independent tranche), **P0-008** audit, **P0-009** row-level security, **P0-010** proof command. Specs are in `docs/implementation/phase-0-backlog.md`.

If the PostgreSQL and production identity-provider decisions are not yet made, start with P0-008 and record both blockers.

## 6. Definition of done for any tranche

- Implementation plus tests that fail without the implementation.
- New problem codes registered in the catalog and golden test; new test files imported from `tests/all.test.ts`.
- Roadmap status updated only to the level proven; `npm run backlog:generate` run when inputs changed; `npm run check` green.
- README "Current implementation slice" updated if scope changed.
- Final report contains: story and epic IDs with MSR IDs, files changed, exact commands run with pass/fail counts, status changes made, what remains, and decisions needed. Include the three-line separation from section 1. Do not claim anything you did not run.

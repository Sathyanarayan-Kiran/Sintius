# Phase 0 implementation backlog

**Status:** Implementation-ready  
**Runtime:** TypeScript on Node.js 24 LTS  
**Source:** `SUB-0021`, pre-implementation deliverables 19-24, and the confirmed runtime decision dated 2026-09-23

## Delivery order and gate

The critical path is `P0-001 -> P0-002 -> P0-003 -> P0-004 -> P0-005 -> P0-006 -> P0-007 -> P0-008 -> P0-009 -> P0-010`. A story is complete only when all fields below are satisfied and its tests run in CI. The Phase 0 exit demonstration provisions a tenant, establishes trusted authenticated context, executes a no-op command twice with one idempotency key, and proves one mutation, one audit event, and one outbox event committed atomically.

## P0-001 — Trusted tenant-context propagation (`BL-001-01`)

- **Persona:** Platform engineer.
- **Intent:** Resolve tenant identity from authenticated claims and propagate it across one request/job without trusting payload data.
- **Business value:** Prevents cross-tenant access and gives every downstream control one authoritative tenant key.
- **Preconditions:** Authenticated principal contains explicit tenant memberships; correlation ID exists at ingress.
- **Acceptance criteria:** Given a member and selected tenant, resolution succeeds; given a non-member, it returns `403 tenant_access_denied`; given a body-supplied tenant ID, it returns `400 untrusted_tenant_context`; asynchronous work preserves the same immutable context.
- **API impact:** Ingress adapter creates context before routing; tenant IDs in request bodies are never authoritative.
- **Data impact:** None in this slice.
- **Events:** Context supplies `tenant_id`, `correlation_id`, and `causation_id` to emitted envelopes.
- **Permissions:** Membership is checked before module authorization.
- **UI behavior:** Forbidden tenant selection shows a generic access error and no tenant metadata.
- **Observability:** Structured logs include tenant/correlation IDs but no token or claim body.
- **Technical tasks:** Branded IDs; resolver; `AsyncLocalStorage` carrier; boundary tests.
- **Test scenarios:** Member success, non-member denial, body override rejection, nested async propagation, missing-context failure.

## P0-002 — Canonical problem and trace model (`BL-001-05`)

- **Persona:** API consumer and operator.
- **Intent:** Receive stable machine-readable errors tied to an end-to-end trace.
- **Business value:** Makes failures supportable without leaking tenant or security data.
- **Preconditions:** P0-001 supplies correlation and causation IDs.
- **Acceptance criteria:** Every rejected command yields RFC-7807-compatible fields plus stable `code` and `correlation_id`; unknown exceptions map to a non-sensitive 500 problem.
- **API impact:** All error responses use `application/problem+json`.
- **Data impact:** None.
- **Events:** Failure telemetry carries correlation/causation IDs; domain events are not emitted for rejected commands.
- **Permissions:** Authorization failures reveal neither resource existence nor another tenant ID.
- **UI behavior:** UI maps known codes to actionable copy and displays the correlation ID.
- **Observability:** Error code, route, status, and correlation ID are metrics/log dimensions.
- **Technical tasks:** Problem type, factories, adapter mapping, redaction tests.
- **Test scenarios:** Known validation/auth/conflict errors and sanitized unexpected error.

## P0-003 — Tenant lifecycle (`BL-002-01`)

- **Persona:** Platform administrator.
- **Intent:** Provision and manage a tenant through `PROVISIONING -> ACTIVE -> SUSPENDED -> CLOSED` under explicit transition rules.
- **Business value:** Establishes a safe account boundary before commercial data exists.
- **Preconditions:** Unique tenant ID and legal/display name are supplied.
- **Acceptance criteria:** Valid transitions succeed and increment version; invalid or stale-version transitions fail; `CLOSED` is terminal; suspended/closed tenants cannot establish an interactive context.
- **API impact:** Future `POST /tenants` and lifecycle command endpoints consume the application handlers defined here.
- **Data impact:** `tenant` aggregate with state, version, and timestamps.
- **Events:** `tenant.provisioned.v1`, `tenant.activated.v1`, `tenant.suspended.v1`, `tenant.closed.v1`.
- **Permissions:** Provisioning is platform-admin only; lifecycle changes require separate administrative permission.
- **UI behavior:** Current state and permitted next actions are explicit.
- **Observability:** Transition success/rejection counts by from/to state.
- **Technical tasks:** Pure aggregate, transition table, optimistic version contract, domain tests.
- **Test scenarios:** Every allowed edge, every forbidden edge, closed-terminal invariant, stale version.

## P0-004 — Authentication and workload identity skeleton (`BL-002-02`, `BL-002-04`)

- **Persona:** Tenant user and platform workload.
- **Intent:** Convert verified OIDC/SAML or workload credentials into one principal model.
- **Business value:** Removes authentication-provider details from domain modules.
- **Preconditions:** Provider metadata and key rotation policy are configured.
- **Acceptance criteria:** Issuer, audience, signature, expiry, subject, and tenant memberships are verified; MFA-required policy rejects insufficient assurance; workload principals cannot open interactive sessions.
- **API impact:** Auth middleware supplies the principal consumed by P0-001.
- **Data impact:** Provider configuration and revocable session/workload identity records.
- **Events:** Security audit facts for login success/failure and credential lifecycle.
- **Permissions:** Authentication grants identity only; authorization remains P0-005.
- **UI behavior:** Redirect/callback and session-expiry states are accessible and non-disclosing.
- **Observability:** Login failure reason class, provider, latency, and trace ID; no tokens logged.
- **Technical tasks:** Provider-neutral ports, claims mapper, assurance policy, test doubles.
- **Test scenarios:** Valid/expired/wrong-audience tokens, MFA insufficiency, workload/interactive separation.

## P0-005 — RBAC and maker-checker skeleton (`BL-002-03`)

- **Persona:** Tenant administrator and Finance Controller.
- **Intent:** Assign roles and enforce permissions plus two-person approval where policy requires it.
- **Business value:** Enforces least privilege and separation of duties before financial workflows arrive.
- **Preconditions:** Trusted tenant context and authenticated principal exist.
- **Acceptance criteria:** Permission checks are tenant-scoped and deny by default; a proposer cannot approve their own request; revoked roles take effect according to session policy.
- **API impact:** Application commands declare required permissions and optional approval policy.
- **Data impact:** Role, permission, assignment, approval policy, and approval request records.
- **Events:** Role/assignment and approval decision audit facts.
- **Permissions:** Only tenant security admins manage assignments; platform roles are separately scoped.
- **UI behavior:** Unauthorized controls are absent and server checks remain authoritative.
- **Observability:** Denials and approval latency are measured without sensitive resource leakage.
- **Technical tasks:** Permission catalog, evaluator, maker-checker policy/aggregate, architecture rule.
- **Test scenarios:** Allow/deny matrix, cross-tenant denial, self-approval rejection, revoked role.

## P0-006 — Idempotency-record infrastructure (`BL-001-02`)

- **Persona:** Platform engineer.
- **Intent:** Make retries of material commands return the original result without repeating effects.
- **Business value:** Prevents duplicate invoices, charges, refunds, and journals.
- **Preconditions:** Tenant context and transaction boundary exist; request has canonical payload hash.
- **Acceptance criteria:** Same tenant/key/hash replays the stored response; same tenant/key with another hash returns 409; concurrent duplicates produce one effect; keys are isolated by tenant and command.
- **API impact:** `Idempotency-Key` is mandatory on classified endpoints.
- **Data impact:** Tenant-scoped `idempotency_record` with command, hash, status, response, and expiry.
- **Events:** The protected command's event is persisted exactly once.
- **Permissions:** Replay does not bypass current tenant membership and command authorization.
- **UI behavior:** Clients generate keys and transparently retry; conflicts surface as actionable errors.
- **Observability:** Replay, conflict, pending-age, and contention metrics.
- **Technical tasks:** Store port, transaction-aware executor, canonical hashing, cleanup policy.
- **Test scenarios:** Success replay, failed transaction retry, payload conflict, concurrent race, cross-tenant same key.

## P0-007 — Transactional outbox and dispatcher (`BL-001-03`)

- **Persona:** Integration engineer.
- **Intent:** Publish committed domain facts durably without dual-write loss.
- **Business value:** Makes downstream billing and integrations reconstructable and reliable.
- **Preconditions:** Module transaction and versioned event schema exist.
- **Acceptance criteria:** Mutation and outbox row commit together; rollback leaves neither; dispatcher retries safely; consumers deduplicate by event ID; ordering is preserved per aggregate.
- **API impact:** None externally; internal event envelope contract is mandatory.
- **Data impact:** Tenant-scoped append-only outbox plus dispatcher lease/attempt metadata.
- **Events:** CloudEvents-compatible envelope with schema version, tenant, aggregate, correlation and causation IDs.
- **Permissions:** Only module writers append; dispatcher reads through a dedicated workload identity.
- **UI behavior:** None.
- **Observability:** Oldest unpublished age, attempts, dead-letter count, and publish latency.
- **Technical tasks:** Outbox port, SQL adapter, leasing dispatcher, inbox/dedup contract.
- **Test scenarios:** Commit/rollback atomicity, crash-after-publish replay, poison event, per-aggregate order.

## P0-008 — Append-only audit path (`BL-017-01`)

- **Persona:** Auditor and security operator.
- **Intent:** Reconstruct who did what, when, in which tenant, and through which approval/trace.
- **Business value:** Provides evidentiary accountability for financial and administrative actions.
- **Preconditions:** Auth/tenant context and transaction boundary exist.
- **Acceptance criteria:** Material commands append an immutable audit event in the same transaction; updates/deletes are rejected; before/after representations are allow-listed and redacted.
- **API impact:** Command metadata carries actor, reason, correlation, causation, and optional approval ID.
- **Data impact:** Append-only tenant-scoped `audit_event`; retention remains configurable pending jurisdiction decision.
- **Events:** Audit records are internal facts and are not substituted for domain events.
- **Permissions:** Audit reads require dedicated permission; writes occur only through the command path.
- **UI behavior:** Timeline is deferred; records remain query-ready.
- **Observability:** Audit-write failures block the command and page operators.
- **Technical tasks:** Audit model/writer, redaction policy, database immutability controls.
- **Test scenarios:** Atomic commit/rollback, mutation rejection, secret redaction, tenant isolation.

## P0-009 — RLS and mandatory repository filters (`BL-001-04`, `BL-017-03`)

- **Persona:** Security engineer.
- **Intent:** Enforce tenant isolation independently in application repositories and PostgreSQL RLS.
- **Business value:** Turns a coding mistake into a denied query rather than a breach.
- **Preconditions:** First tenant-owned migration exists and connection setup can set local tenant context.
- **Acceptance criteria:** Every tenant table has `tenant_id`, enabled/forced RLS, and tenant index strategy; repositories require trusted context; missing/wrong context returns no cross-tenant data; bypass roles are absent from application credentials.
- **API impact:** No client-visible change except non-disclosing 403/404 behavior.
- **Data impact:** RLS policies and tenant-scoped uniqueness/FK conventions.
- **Events:** Isolation denials produce security telemetry, not domain events.
- **Permissions:** Database role grants are least-privilege and migration roles are separate.
- **UI behavior:** No cross-tenant identifiers or existence hints are displayed.
- **Observability:** RLS/repository denials and missing-context failures are alerted.
- **Technical tasks:** Migration template, session-variable adapter, repository base, architecture linter, negative matrix.
- **Test scenarios:** Tenant A/B read/write/update/delete matrix, missing context, forged payload, worker context, privileged-role regression.

## P0-010 — Phase 0 proof command and release gate

- **Implementation status:** In progress. PostgreSQL evidence now proves concurrent idempotent tenant provisioning commits exactly one tenant/default-role/administrator, audit event, outbox event and stored response, with changed-payload conflict and rollback coverage. The dedicated active-tenant proof record/event, dispatcher replay, end-to-end trace and CI evidence capture below remain.
- **Persona:** Delivery lead.
- **Intent:** Demonstrate all foundation controls together on one harmless command.
- **Business value:** Proves the platform invariants before financially material domain work starts.
- **Preconditions:** P0-001 through P0-009 are integrated against PostgreSQL.
- **Acceptance criteria:** A synthetic active tenant and user execute the command twice with one key; responses are identical; exactly one mutation, one outbox event, and one audit event exist; another tenant cannot observe or replay it.
- **API impact:** Internal test-only or admin proof endpoint, excluded from production routing unless retained as a health diagnostic.
- **Data impact:** Minimal tenant-owned proof record plus idempotency/outbox/audit rows.
- **Events:** `foundation.proof_recorded.v1` using the canonical envelope.
- **Permissions:** Dedicated non-default permission; no anonymous access.
- **UI behavior:** None required.
- **Observability:** One trace spans ingress, transaction, replay, audit, and dispatch.
- **Technical tasks:** Composition root, Postgres integration harness, CI release gate, evidence capture.
- **Test scenarios:** Happy path, exact replay, changed-payload conflict, rollback injection, tenant A/B matrix, dispatcher retry.

## Explicit Phase 0 deferrals

`BL-002-05` break-glass support, `BL-017-02` audit timeline UI, and `BL-017-04` audit export remain MVP work but are not required by the Phase 0 exit criteria. They enter Phase 6 hardening unless an earlier operational need promotes them. This does not defer the underlying audit write path or security telemetry.

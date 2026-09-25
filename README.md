# Sintius subscription revenue platform

This repository is the TypeScript/Node.js 24 LTS implementation of the canonical specifications under `docs/`.

## Current implementation slice

- Trusted authenticated-principal issuance, credential-expiry revalidation, tenant-context resolution and asynchronous propagation.
- Canonical problem details: a registered, contract-tested error catalog, validated trace identifiers, and a transport-neutral boundary that returns `application/problem+json` data and turns unexpected errors into a sanitized 500 with redacted internal evidence.
- Tenant lifecycle aggregate and application handlers with explicit transition rules, optimistic version checks, and a real PostgreSQL adapter. Integration tests prove atomic tenant/default-role/administrator/audit/outbox commit, rollback, forced-RLS isolation and concurrent compare-and-set behavior.
- Provider-neutral authentication validates OIDC, SAML and short-lived workload claims for mechanism, issuer, audience, lifetime, revocation and MFA, and down-scopes workload access to an explicit tenant and operation set. Cryptographic verification remains behind a port until production identity-provider/JWKS, SAML certificate, signed-token or mTLS adapters are selected.
- Tenant-scoped RBAC (permission catalog, deny-by-default evaluator, fail-closed ABAC narrowing, role assignment) in Identity & Tenant and a maker-checker approval aggregate in Audit & Governance (separation of duties, MFA step-up, exact target matching). Role administration and approvals run on PostgreSQL: roles are locked during changes, approval requests are append-only evidence (column-limited updates plus a trigger), the last tenant administrator cannot be removed (D3), and policies can require named approver permissions such as Product and Finance (D4).
- PostgreSQL-backed idempotency combines canonical request hashing, authorization-before-lookup, atomic claim/replay and the protected command in one transaction. Every tenant provisioning/lifecycle entry point requires command metadata carrying the key. Integration tests prove exact replay, rollback, payload conflict, cross-tenant isolation, a 12-request adapter race and one complete tenant/audit/outbox/result commit under concurrent provisioning; HTTP wiring remains.
- The Phase 0 active-tenant proof command owns an RLS-protected proof record and publishes `foundation.proof_recorded.v1`. Concurrent PostgreSQL retries prove one mutation/audit/outbox/stored response, correlation propagation and tenant-B read/replay isolation. A PostgreSQL release-gate test composes real tenant provisioning, RBAC read from the role tables (including revocation), the proof, a retried dispatch and a deduplicated redelivery. HTTP ingress, an end-to-end trace and the CI release gate remain.
- Transactional outbox and inbox: ports, a leasing dispatcher with per-aggregate ordering, backoff and dead-lettering, and an idempotent consumer. Producers append to the PostgreSQL outbox table atomically. A PostgreSQL dispatcher store (`FOR UPDATE SKIP LOCKED` on stream heads, dedicated `sintius_dispatcher` role), audited dead-letter resolution and a forced-RLS inbox are integration-tested, including concurrent workers and concurrent redeliveries. The interim transport (decision D14, within ADR-009) is a PostgreSQL consumer queue: the dispatcher fans each event out to its subscribed consumers, and each consumer has its own ordered, dead-letter-isolated delivery queue with LISTEN/NOTIFY wake-ups. A continuous runtime loop remains outstanding.
- Append-only audit: immutable, tamper-evident events stamped from trusted context, allow-list redaction, a permissioned reader whose reads are audited, and adoption by tenant, role, approval and dead-letter commands. Writes use the RLS-protected PostgreSQL table with an INSERT-only application grant, and an integration test proves UPDATE, DELETE and TRUNCATE are denied to the application and dispatcher roles; a database reader remains outstanding.
- Tenant-isolation release gate (P0-009): `tests/integration/tenant-isolation.test.ts` reads the database catalog, so every table is covered as soon as it is migrated. It audits forced RLS, tenant-bound policies, a reviewed privilege manifest, role powers, views and SECURITY DEFINER functions, then attacks every table as the application and dispatcher roles from tenant A and tenant B (read, insert, update, re-tenanting and delete, and every operation with no tenant bound), with positive controls. An injected-regression test proves the gate fails. A new table, grant or relay policy must be added to the manifests in `tests/integration/support/tenant-isolation.ts`, which is the review point. Scheduled work gets the same trusted context through `runTenantJob` (a workload credential bound to one active tenant, a run-derived correlation ID, never nested inside a request).
- Authentication with real signed tokens (decisions D8, D11): `modules/identity-tenant/infrastructure/jose/jwt-verifier.ts` verifies OIDC and workload JWTs with `jose` against the provider's JWKS (asymmetric algorithms only, key rotation by refetch on an unknown `kid`, token-age limit; SAML is federated through the IdP). Platform operators authenticate on the separate `sintius-platform` audience with MFA, no tenant memberships and reviewed platform roles, and `/v1/platform/*` routes accept only their credentials; `createPlatformAuthorizer` replaces the allow-list placeholder. Revocation is read from the durable `credential_revocation` table on every request, and every attempt produces a redacted security fact and the `sintius.authentication.outcomes` metric.
- Persona permission matrix (decision D9, reviewed by the Product Owner on 2026-09-25): `modules/identity-tenant/domain/persona-matrix.ts` maps the 12 personas of master spec §61 to the permission catalog, citing a source or a PO decision for each grant; `docs/implementation/persona-permission-matrix.md` is rendered from it. Role-scoped limits (`tenant_role.permission_limits`) narrow only their own role, for example the Billing Administrator refunding up to USD 10,000. Every new tenant receives a default pricing-activation approval policy (Product + Finance).
- Fastify HTTP ingress (`apps/api`): bearer authentication through the provider-neutral authentication service, tenant derived only from the principal (`X-Active-Tenant` selects among signed memberships), `X-Correlation-Id`/`X-Causation-Id` propagation into context, audit and events, `Idempotency-Key`, `If-Match`/`ETag`, `Retry-After`, strict body schemas and RFC 9457 problem+json for every failure. Routes: tenant provisioning/lifecycle and the test-only proof command. A PostgreSQL HTTP test proves one ingress correlation ID reaches the record, the audit row and the published event.
- `platform/money`: the SPIKE-02 money foundation, proven by hand-computed golden cases (USD/INR, JPY, KWD) and seeded property suites cross-checked against an independent decimal oracle.
- Implementation evidence: `docs/implementation/implementation-evidence.json` records which accepted requirements are implemented. A claim is accepted only if every mapped test is marked passing, exists as an automated test, and (in CI) passed in that run.
- CI (decision D13): `.github/workflows/ci.yml` runs the full gate on Node 24 with a PostgreSQL 17 service and uploads TAP reports and requirement coverage as release-gate evidence.
- Observability (decision D15): `platform/observability` is the only OpenTelemetry surface for application code. It provides PII-safe spans with shape-checked, redacted attributes, W3C trace context stored beside outbox entries and deliveries, and the Phase 0 metrics (problems by code, idempotency outcomes, queue outcomes and gauges, audit write failures). One trace runs from the HTTP request through the command, audit, dispatch, delivery and consumer. `npm run observability:up` starts a local Grafana stack (OTLP on 127.0.0.1:4318, Grafana on 127.0.0.1:3000).
- Architecture manifest validation for bounded-context ownership.

Node 24's native erasable-TypeScript support runs the code and tests directly; there is no build step. `npm run typecheck` runs the pinned TypeScript compiler (`tsc --noEmit`, strict) and is the first step of `npm run check`. Runtime dependencies are pinned: `pg` for PostgreSQL and `fastify` for HTTP.

## Commands

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run check:evidence   # CI: re-verifies implementation evidence against test reports
npm.cmd run check:postgres
npm.cmd run check:architecture
npm.cmd run check
```

`check:postgres` starts the local PostgreSQL 17 container on `127.0.0.1:54329`, applies forward-only migrations (from `modules/*` and `platform/*`) and runs the database integration suite (`test:postgres`, one file at a time because the files share one database). The Compose configuration uses trust authentication only for loopback-bound local development; it is not a production credential model. Use `npm.cmd run db:down` to stop the container while retaining its named development volume.

## Guardrails

- Tenant identity comes from verified principals, never request bodies.
- Domain modules do not import another module's domain or infrastructure.
- Financial commands must add an idempotent replay test when introduced.
- Money uses `platform/money` (decision D5): exact BigInt fixed-point `Decimal` (38 digits, scale 18) and minor-unit `Money`, with HALF_UP rounding, ACTUAL_DAYS proration and largest-remainder allocation (D6). The architecture lint rejects float rounding/parsing and money-named `number` fields. `decimal.js` is a dev-only test oracle.
- Event and API types are generated from source contracts and are never hand-edited.

See [Phase 0 implementation backlog](docs/implementation/phase-0-backlog.md) for delivery scope and acceptance criteria.

For a new Claude Code implementation session, use the current [Claude Code handover prompt](HANDOVER_PROMPT_CLAUDE_CODE.md).

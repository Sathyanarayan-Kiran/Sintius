# Sintius subscription revenue platform

This repository is the TypeScript/Node.js 24 LTS implementation of the canonical specifications under `docs/`.

## Current implementation slice

- Trusted authenticated-principal issuance, credential-expiry revalidation, tenant-context resolution and asynchronous propagation.
- Canonical problem details: a registered, contract-tested error catalog, validated trace identifiers, and a transport-neutral boundary that returns `application/problem+json` data and turns unexpected errors into a sanitized 500 with redacted internal evidence.
- Tenant lifecycle aggregate and application handlers with explicit transition rules, optimistic version checks, and a real PostgreSQL adapter. Integration tests prove atomic tenant/default-role/administrator/audit/outbox commit, rollback, forced-RLS isolation and concurrent compare-and-set behavior.
- Provider-neutral authentication validates OIDC, SAML and short-lived workload claims for mechanism, issuer, audience, lifetime, revocation and MFA, and down-scopes workload access to an explicit tenant and operation set. Cryptographic verification remains behind a port until production identity-provider/JWKS, SAML certificate, signed-token or mTLS adapters are selected.
- Tenant-scoped RBAC (permission catalog, deny-by-default evaluator, fail-closed ABAC narrowing, role assignment) in Identity & Tenant and a maker-checker approval aggregate in Audit & Governance (separation of duties, MFA step-up, exact target matching). A PostgreSQL grant store backs the live permission lookup; role administration and approvals still use in-memory doubles only.
- PostgreSQL-backed idempotency combines canonical request hashing, authorization-before-lookup, atomic claim/replay and the protected command in one transaction. Every tenant provisioning/lifecycle entry point requires command metadata carrying the key. Integration tests prove exact replay, rollback, payload conflict, cross-tenant isolation, a 12-request adapter race and one complete tenant/audit/outbox/result commit under concurrent provisioning; HTTP wiring remains.
- The Phase 0 active-tenant proof command owns an RLS-protected proof record and publishes `foundation.proof_recorded.v1`. Concurrent PostgreSQL retries prove one mutation/audit/outbox/stored response, correlation propagation and tenant-B read/replay isolation. A PostgreSQL release-gate test composes real tenant provisioning, RBAC read from the role tables (including revocation), the proof, a retried dispatch and a deduplicated redelivery. HTTP ingress, an end-to-end trace and the CI release gate remain.
- Transactional outbox and inbox: ports, a leasing dispatcher with per-aggregate ordering, backoff and dead-lettering, and an idempotent consumer. Producers append to the PostgreSQL outbox table atomically. A PostgreSQL dispatcher store (`FOR UPDATE SKIP LOCKED` on stream heads, dedicated `sintius_dispatcher` role), audited dead-letter resolution and a forced-RLS inbox are integration-tested, including concurrent workers and concurrent redeliveries. The broker choice and a dispatcher runtime loop remain outstanding.
- Append-only audit: immutable, tamper-evident events stamped from trusted context, allow-list redaction, a permissioned reader whose reads are audited, and adoption by tenant, role, approval and dead-letter commands. Writes use the RLS-protected PostgreSQL table with an INSERT-only application grant, and an integration test proves UPDATE, DELETE and TRUNCATE are denied to the application and dispatcher roles; a database reader remains outstanding.
- Architecture manifest validation for bounded-context ownership.

Node 24's native erasable-TypeScript support runs the code and tests directly. PostgreSQL access uses the pinned `pg` runtime dependency; no application framework or build toolchain has been selected yet.

## Commands

```powershell
npm.cmd test
npm.cmd run check:postgres
npm.cmd run check:architecture
npm.cmd run check
```

`check:postgres` starts the local PostgreSQL 17 container on `127.0.0.1:54329`, applies forward-only migrations (from `modules/*` and `platform/*`) and runs the database integration suite (`test:postgres`, one file at a time because the files share one database). The Compose configuration uses trust authentication only for loopback-bound local development; it is not a production credential model. Use `npm.cmd run db:down` to stop the container while retaining its named development volume.

## Guardrails

- Tenant identity comes from verified principals, never request bodies.
- Domain modules do not import another module's domain or infrastructure.
- Financial commands must add an idempotent replay test when introduced.
- Money will use the SPIKE-02-selected fixed-point/decimal implementation; JavaScript `number` is prohibited for monetary values.
- Event and API types are generated from source contracts and are never hand-edited.

See [Phase 0 implementation backlog](docs/implementation/phase-0-backlog.md) for delivery scope and acceptance criteria.

For a new Claude Code implementation session, use the current [Claude Code handover prompt](HANDOVER_PROMPT_CLAUDE_CODE.md).

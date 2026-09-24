# Sintius subscription revenue platform

This repository is the TypeScript/Node.js 24 LTS implementation of the canonical specifications under `docs/`.

## Current implementation slice

- Trusted authenticated-principal issuance, credential-expiry revalidation, tenant-context resolution and asynchronous propagation.
- Canonical problem details: a registered, contract-tested error catalog, validated trace identifiers, and a transport-neutral boundary that returns `application/problem+json` data and turns unexpected errors into a sanitized 500 with redacted internal evidence.
- Tenant lifecycle aggregate and application handlers with explicit transition rules, optimistic version checks, and a real PostgreSQL adapter. Integration tests prove atomic tenant/default-role/administrator/audit/outbox commit, rollback, forced-RLS isolation and concurrent compare-and-set behavior.
- Provider-neutral authentication validates OIDC, SAML and short-lived workload claims for mechanism, issuer, audience, lifetime, revocation and MFA, and down-scopes workload access to an explicit tenant and operation set. Cryptographic verification remains behind a port until production identity-provider/JWKS, SAML certificate, signed-token or mTLS adapters are selected.
- Tenant-scoped RBAC (permission catalog, deny-by-default evaluator, fail-closed ABAC narrowing, role assignment) in Identity & Tenant and a maker-checker approval aggregate in Audit & Governance (separation of duties, MFA step-up, exact target matching). Both sit behind ports and are tested with in-memory doubles only; there is no PostgreSQL adapter yet.
- PostgreSQL-backed idempotency combines canonical request hashing, authorization-before-lookup, atomic claim/replay and the protected command in one transaction. Integration tests prove exact replay, rollback, payload conflict, cross-tenant isolation and one durable effect under a 12-request race; concrete HTTP and lifecycle-command wiring remains.
- Transactional outbox and inbox: ports, a leasing dispatcher with per-aggregate ordering, backoff and dead-lettering, and an idempotent consumer. Tenant lifecycle writes use the PostgreSQL outbox table atomically; leasing/inbox persistence and the broker choice remain outstanding.
- Append-only audit: immutable, tamper-evident events stamped from trusted context, allow-list redaction, a permissioned reader whose reads are audited, and adoption by tenant, role, approval and dead-letter commands. Tenant lifecycle writes use the RLS-protected PostgreSQL table with an INSERT-only application grant; an explicit privilege-denial test and database reader remain outstanding.
- Architecture manifest validation for bounded-context ownership.

Node 24's native erasable-TypeScript support runs the code and tests directly. PostgreSQL access uses the pinned `pg` runtime dependency; no application framework or build toolchain has been selected yet.

## Commands

```powershell
npm.cmd test
npm.cmd run check:postgres
npm.cmd run check:architecture
npm.cmd run check
```

`check:postgres` starts the local PostgreSQL 17 container on `127.0.0.1:54329`, applies forward-only migrations and runs the database integration suite. The Compose configuration uses trust authentication only for loopback-bound local development; it is not a production credential model. Use `npm.cmd run db:down` to stop the container while retaining its named development volume.

## Guardrails

- Tenant identity comes from verified principals, never request bodies.
- Domain modules do not import another module's domain or infrastructure.
- Financial commands must add an idempotent replay test when introduced.
- Money will use the SPIKE-02-selected fixed-point/decimal implementation; JavaScript `number` is prohibited for monetary values.
- Event and API types are generated from source contracts and are never hand-edited.

See [Phase 0 implementation backlog](docs/implementation/phase-0-backlog.md) for delivery scope and acceptance criteria.

For a new Claude Code implementation session, use the current [Claude Code handover prompt](HANDOVER_PROMPT_CLAUDE_CODE.md).

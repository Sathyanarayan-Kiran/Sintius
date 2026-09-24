# Sintius subscription revenue platform

This repository is the TypeScript/Node.js 24 LTS implementation of the canonical specifications under `docs/`.

## Current implementation slice

- Trusted tenant-context resolution and asynchronous propagation.
- Canonical problem details: a registered, contract-tested error catalog, validated trace identifiers, and a transport-neutral boundary that returns `application/problem+json` data and turns unexpected errors into a sanitized 500 with redacted internal evidence.
- Tenant lifecycle aggregate and application handlers with explicit transition rules, optimistic version checks, and atomic unit-of-work ports. A real PostgreSQL adapter and atomicity integration test remain outstanding.
- Provider-neutral authentication validates OIDC, SAML and short-lived workload claims for mechanism, issuer, audience, lifetime, revocation and MFA, and down-scopes workload access to an explicit tenant and operation set. Cryptographic verification remains behind a port until production identity-provider/JWKS, SAML certificate, signed-token or mTLS adapters are selected.
- Tenant-scoped RBAC (permission catalog, deny-by-default evaluator, fail-closed ABAC narrowing, role assignment) in Identity & Tenant and a maker-checker approval aggregate in Audit & Governance (separation of duties, MFA step-up, exact target matching). Both sit behind ports and are tested with in-memory doubles only; there is no PostgreSQL adapter yet.
- Idempotent command execution: canonical request hashing, a transaction-aware executor and a store port (atomic claim, replay, payload-conflict 409, retention). Tested with an in-memory double only; the PostgreSQL adapter and concurrency proof remain outstanding.
- Transactional outbox and inbox: ports, a leasing dispatcher with per-aggregate ordering, backoff and dead-lettering, and an idempotent consumer. In-memory double only; the PostgreSQL adapter and broker choice remain outstanding.
- Append-only audit: an immutable, tamper-evident audit event stamped from trusted context, allow-list redaction, a permissioned reader whose reads are audited, and adoption by the tenant, role, approval and dead-letter commands. In-memory double only; database immutability controls remain outstanding.
- Architecture manifest validation for bounded-context ownership.

The implementation deliberately starts without third-party runtime dependencies. Node 24's native erasable-TypeScript support runs the initial tests directly; the build toolchain and framework are selected only when a concrete adapter needs them.

## Commands

```powershell
npm.cmd test
npm.cmd run check:architecture
npm.cmd run check
```

## Guardrails

- Tenant identity comes from verified principals, never request bodies.
- Domain modules do not import another module's domain or infrastructure.
- Financial commands must add an idempotent replay test when introduced.
- Money will use the SPIKE-02-selected fixed-point/decimal implementation; JavaScript `number` is prohibited for monetary values.
- Event and API types are generated from source contracts and are never hand-edited.

See [Phase 0 implementation backlog](docs/implementation/phase-0-backlog.md) for delivery scope and acceptance criteria.

For a new Claude Code implementation session, use the current [Claude Code handover prompt](HANDOVER_PROMPT_CLAUDE_CODE.md).

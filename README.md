# Sintius subscription revenue platform

This repository is the TypeScript/Node.js 24 LTS implementation of the canonical specifications under `docs/`.

## Current implementation slice

- Trusted tenant-context resolution and asynchronous propagation.
- Canonical problem details: a registered, contract-tested error catalog, validated trace identifiers, and a transport-neutral boundary that returns `application/problem+json` data and turns unexpected errors into a sanitized 500 with redacted internal evidence.
- Pure tenant lifecycle aggregate with explicit transition rules and optimistic version checks.
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

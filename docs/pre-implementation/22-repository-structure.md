# Repository structure

**Version:** 0.1
**Status:** Proposed baseline; primary layout assumes the TypeScript/Node outcome of SPIKE-01 (deliverable 21 §2), with the Kotlin alternative noted where it would differ
**Related:** [Logical architecture](05-logical-architecture.md) (ADR-LA-001), [Technical implementation plan](21-technical-implementation-plan.md), [Coding standards](23-coding-standards.md)

## 1. Purpose and principles

1. **One repository, module-enforced boundaries** — matches ADR-LA-001 (modular monolith plus independently scalable workers). A single monorepo keeps transactional-boundary reasoning simple during MVP while the directory/dependency structure below enforces the same context isolation microservices would, so extraction later (deliverable 05 §8) is a deployment change, not a rewrite.
2. **Generated contracts are never hand-edited.** OpenAPI (deliverable 13) and event JSON Schemas (deliverable 14) are the source of truth; server stubs, client SDKs, and TypeScript types are generated artifacts, checked into a clearly marked generated path or excluded from version control and regenerated in CI — never manually patched.
3. **A bounded context's tables are reachable only through its own module.** This is enforced by both filesystem convention (§3) and an automated architecture-boundary check (§8), not by convention alone (ADR-LA-001 "architecture tests forbid cross-module table access").
4. **The structure is runtime-outcome-tolerant.** If SPIKE-01 selects Kotlin instead of TypeScript/Node, the same module/layer/context boundaries apply under a Gradle multi-module layout (§9); nothing about the bounded-context decomposition itself changes.

## 2. Top-level layout

```
/                                   repository root
├── apps/
│   ├── admin-web/                  Admin web application (React + Next.js + TypeScript)
│   ├── portal-web/                 Customer Portal application
│   ├── api/                        Public BFF / API service (deliverable 13 surface)
│   └── developer-console/          API docs, sandbox, webhook tester (master prompt §83)
├── services/                       Independently deployable/scalable workers (ADR-LA-001)
│   ├── usage-ingress/
│   ├── rating-worker/
│   ├── billing-worker/
│   ├── payment-worker/
│   ├── collections-worker/
│   ├── notification-worker/
│   ├── outbox-dispatcher/
│   └── projector/                  Search / RLG / analytics projectors
├── modules/                        Domain bounded contexts (deliverable 03 §3), one per directory
│   ├── identity-tenant/
│   ├── customer/
│   ├── catalog/
│   ├── pricing/
│   ├── subscription/
│   ├── metering/
│   ├── rating/
│   ├── billing/
│   ├── receivables/
│   ├── payments/
│   ├── collections/
│   ├── communications/
│   ├── audit-governance/
│   ├── reporting-graph/
│   └── integration/
├── platform/                       Shared, domain-agnostic packages (§6)
│   ├── money/
│   ├── tenant-context/
│   ├── idempotency/
│   ├── outbox-client/
│   ├── auth/
│   ├── problem-model/
│   └── observability/
├── contracts/                      Source-of-truth API and event contracts (mirrors deliverables 13–14)
│   ├── openapi/
│   ├── events/
│   └── generated/                  Codegen output (gitignored or clearly marked, never hand-edited)
├── ai-gateway/                     AI gateway service (deliverable 15 §10, ADR-LA-009)
├── infra/                          Deployment code (deliverable 25)
│   ├── terraform/ (or equivalent IaC)
│   ├── kubernetes/ (or equivalent, if/when justified)
│   └── ci/
├── tools/                          Codegen scripts, architecture-boundary linter, migration tooling
├── docs/
│   └── pre-implementation/         This design record (deliverables 00–25)
├── package.json / pnpm-workspace.yaml (or turbo.json)
└── README.md
```

## 3. Domain module internal layout

Every directory under `modules/<context>/` follows the same internal layering, mirroring the request/event processing model in deliverable 05 §4:

```
modules/pricing/
├── domain/            Aggregates, value objects, state machines, pure business rules
│   ├── entities/
│   ├── value-objects/       Money, Quantity, EffectivePeriod, CalculationTrace, ...
│   └── events/               Domain event payload types (mirrors contracts/events)
├── application/        Command handlers, query handlers — orchestrates domain + infra
│   ├── commands/             ActivateRateCard, ValidatePricing, ...
│   └── queries/
├── infra/              Repository implementations, outbox writers — the only layer touching the DB
│   ├── postgres/
│   └── migrations/           Owned exclusively by this module (deliverable 07 §10)
├── api/                 Route/controller bindings to the generated OpenAPI server stubs
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── golden/               Golden datasets (deliverable 12 §23) — pricing-specific
│   └── property/
└── module.json          Declares owned tables, published events, and permitted dependencies
```

- **`domain/`** never imports `infra/` or any other module's `domain/` directly — cross-context references go through published IDs and contracts (deliverable 03 §1.4), not shared mutable objects.
- **`infra/postgres/`** is the *only* place SQL/ORM code touching this module's tables exists; no other module's `infra/` may reference `pricing`'s tables (§8 enforces this).
- **`module.json`** is a machine-readable manifest (owned tables, published event types, allowed inbound dependencies) that the architecture-boundary tool (§8) reads to validate imports and generate a dependency diagram.

## 4. Apps

- **`apps/admin-web`** and **`apps/portal-web`** are separate Next.js applications (deliverable 17 §1 — two distinct experiences sharing a design language, not one app with a mode flag), each consuming the generated API client from `contracts/generated/` and a shared UI component library (§6, if promoted from `platform/` or a dedicated `packages/design-system/`).
- **`apps/api`** hosts the public BFF (deliverable 05 §2 `BFF`), composing calls into `modules/*/application` command/query handlers; it contains no domain logic itself, only request shaping, auth-context resolution (deliverable 15 §4.1), and response composition.
- **`apps/developer-console`** serves published OpenAPI/event docs, a sandbox environment pointer, and the webhook tester (master prompt §83) — read-only relative to production domain state.

## 5. Services (independently scalable workers)

Each `services/*` directory is a thin deployable wrapper that imports the relevant `modules/*/application` handlers and `platform/outbox-client` — it contains no domain logic of its own, only scheduling, batching, and infrastructure concerns (queue polling, checkpointing). This keeps the extraction promise from ADR-LA-001 concrete: promoting `usage-ingress` to its own scaling unit (deliverable 05 §8 first extraction candidate) never means duplicating business logic, because the logic already lives in `modules/metering`, not in the service directory.

## 6. Platform (shared, domain-agnostic packages)

| Package | Responsibility |
|---|---|
| `platform/money` | Fixed-precision decimal/money types, currency-aware arithmetic (deliverable 12 §13, deliverable 23 §"Money") |
| `platform/tenant-context` | Trusted tenant-context resolution and propagation (deliverable 16 §1) — the single implementation every module's `application/` layer depends on |
| `platform/idempotency` | Idempotency-record read/write helpers (deliverable 13 §8) |
| `platform/outbox-client` | Outbox write helper used inside the same transaction as any domain mutation (ADR-LA-003) |
| `platform/auth` | RBAC/ABAC permission-check helpers, maker-checker evaluation (deliverable 15 §5) |
| `platform/problem-model` | Canonical error/problem response construction (deliverable 13 §11) |
| `platform/observability` | Correlation/causation ID propagation, structured logging, tracing helpers (deliverable 05 §9) |

No `platform/*` package contains tenant data access or domain rules — it is infrastructure every module composes, never a hidden back door between modules.

## 7. Contracts and generated-code handling

```
contracts/
├── openapi/
│   └── mvp-vertical-slice.yaml         source of truth (deliverable 13)
├── events/
│   ├── envelope.schema.json
│   └── <type>.v<N>.schema.json          source of truth (deliverable 14)
└── generated/
    ├── api-client-ts/                   generated from openapi/, consumed by apps/*-web
    ├── api-server-types-ts/             generated request/response types, consumed by apps/api and modules/*/api
    └── event-types-ts/                  generated from events/, consumed by modules/*/domain/events
```

- CI runs codegen on every change under `contracts/` and fails the build if generated output would differ from the committed/expected artifact (or, if generated files are gitignored, regenerates them as a build step — the team picks one policy and applies it uniformly, but never allows manual edits to drift from the schema).
- A schema change that would be a breaking change per deliverable 13 §5 / deliverable 14 §4 fails a dedicated compatibility-check CI job before merge.

## 8. Architecture-boundary enforcement tooling

`tools/architecture-lint/` runs in CI and enforces, reading each `module.json`:

1. No module's `infra/` layer references another module's database tables (static analysis of SQL/ORM query targets against each module's declared owned-tables list) — the concrete implementation of ADR-LA-001's "architecture tests forbid cross-module table access."
2. No module's `domain/` imports another module's `domain/` or `infra/` directly; cross-module references must go through a published command/query interface or an event type in `contracts/events/`.
3. No `apps/*` or `services/*` contains business rules — a lint rule flags domain-shaped logic (e.g., a proration calculation) appearing outside `modules/*/domain/`.
4. Every new migration under `modules/*/infra/migrations/` is attributed to exactly one module and cannot alter another module's tables.

A failing architecture-lint run blocks merge, identically to a failing test suite.

## 9. Kotlin alternative (if SPIKE-01 selects it)

The bounded-context decomposition, module/layer separation, and enforcement principles (§1, §3, §8) are unchanged. The concrete layout becomes a Gradle multi-module project: `modules/pricing` becomes a Gradle module with `domain`, `application`, `infra`, and `api` source sets or sub-modules; `platform/*` packages become shared Gradle library modules; `contracts/generated/` output becomes generated Kotlin server stubs/DTOs instead of TypeScript; `apps/admin-web`/`apps/portal-web` remain TypeScript/Next.js regardless of backend runtime (deliverable 05 §10 frontend baseline is independent of the backend spike). The architecture-lint tool (§8) is reimplemented against Gradle's module dependency graph (e.g., via a Gradle plugin or ArchUnit-equivalent) rather than a JS import-graph analyzer, enforcing the identical rules.

## 10. Versioning and branching conventions

- Trunk-based development with short-lived feature branches; `main` is always releasable per the deliverable 19 definition of done.
- Database migrations follow the expand/migrate/contract sequencing from deliverable 07 §10 and are reviewed with the same rigor as any financially material code change.
- Every module version-tags its published contract surface (API operations it implements, event types it emits) so a consumer can pin to a known-compatible module version during the transition windows defined in deliverables 13 §5 and 14 §4.
- Release branches (if used for a regulated/regional variant) are short-lived and reconciled back to trunk promptly; long-lived divergent branches are avoided given the single-tenant-per-deployment risk of drift (deliverable 16 §9).

## 11. Acceptance criteria

1. Every bounded context in deliverable 03 §3 has exactly one corresponding `modules/*` directory; no context is split across two directories or two contexts share one directory.
2. `tools/architecture-lint` runs in CI and fails a synthetic violation (cross-module table access, domain logic in an app/service directory) in a demonstration test.
3. No file under `contracts/generated/` is ever the target of a direct source-controlled edit (verified by a CI check comparing generated output to a fresh codegen run).
4. A new bounded context can be added by creating one new `modules/*` directory and a `module.json` entry, without modifying the internal layout convention of any existing module.
5. The repository structure supports extracting any `services/*` worker to an independent deployable without moving or duplicating domain logic, verified by the `usage-ingress` extraction being a configuration/deployment change only (deliverable 05 §8 first candidate).

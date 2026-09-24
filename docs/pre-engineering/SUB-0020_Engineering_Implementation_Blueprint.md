# SUB-0020 — Engineering Implementation Blueprint

**Document ID:** SUB-0020
**Title:** Engineering Implementation Blueprint
**Version:** 0.1 (Draft)
**Status:** Draft
**Owner:** Principal Software Architect
**Reviewers:** Technical Program Manager, Site Reliability Architect, Security Architect, QA/Test Architect
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23
**Dependencies:** [SUB-0011](SUB-0011_System_Architecture.md)–[SUB-0019](SUB-0019_Test_Strategy_Financial_Correctness_Framework.md)
**Related Documents:** SUB-0021 MVP Delivery Backlog (planned)

## 1. Technology choices and rationale

| Layer | Baseline choice | Rationale |
|---|---|---|
| Frontend | React, Next.js, TypeScript | Mature ecosystem, SSR support for the Admin/Portal split (SUB-0015), strong accessibility tooling |
| Backend runtime | TypeScript/Node, Kotlin/Java, or Go — decided after a decimal-precision/throughput/team-capability spike | No default is assumed here; SUB-0007's fixed-precision arithmetic requirement (never binary floating point) is the primary selection criterion, followed by batch-rating throughput and team skill |
| Database | PostgreSQL | ACID guarantees for money movement (SUB-0011 ADR-011), mature constraint/indexing support, avoids a second data platform for the ledger (ADR-012) |
| Cache | Redis | Non-authoritative acceleration only (rate limits, short leases); a cache failure never causes incorrect financial behavior (SUB-0011 §8) |
| Event streaming | Transactional outbox now; Kafka-compatible transport once volume warrants it (SUB-0011 ADR-009) | Matches measured-need deferral; consumers built idempotent from day one so the transport migration is invisible |
| Workflow | Database-backed durable jobs now; Temporal-style engine when volume/complexity justify it (SUB-0011 ADR-010) | Avoids operating a new platform before flows stabilize |
| Search | PostgreSQL-native at MVP; OpenSearch when scale/relevance evidence requires it (SUB-0011 ADR-014) | Deferred-infrastructure pattern applied consistently |
| Observability | OpenTelemetry | Vendor-neutral tracing/metrics/logs with correlation/causation propagation (SUB-0011 §12) |
| Deployment | Docker; Kubernetes only when operational scale justifies it | Avoids premature orchestration complexity; matches the deferred-infrastructure pattern applied to compute as well as data |

Every "deferred until justified" choice above has its trigger condition stated in the owning ADR (SUB-0011 §9) — this is not indecision, it is a deliberate, documented sequencing choice consistent with SUB-0000 PRIN-03/PRIN-04.

## 2. Repository structure

```
/
├── apps/
│   ├── admin-web/                  Admin web application
│   ├── portal-web/                 Subscriber Portal
│   ├── api/                        Public BFF / API service (SUB-0013 surface)
│   └── developer-console/          API docs, sandbox, webhook tester
├── services/                       Independently deployable/scalable workers
│   ├── usage-ingress/
│   ├── rating-worker/
│   ├── billing-worker/
│   ├── payment-worker/
│   ├── collections-worker/
│   ├── notification-worker/
│   ├── outbox-dispatcher/
│   └── projector/                  Search / RLG / analytics projectors
├── modules/                        Domain bounded contexts (SUB-0004 §2), one per directory
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
│   ├── revenue-accounting/
│   ├── communications/
│   ├── audit-governance/
│   └── integration/
├── platform/                       Shared, domain-agnostic packages (§4)
├── contracts/                      Source-of-truth API and event contracts
│   ├── openapi/
│   ├── events/
│   └── generated/                  Codegen output — never hand-edited
├── ai-gateway/                     AI gateway service (SUB-0016)
├── infra/                          Deployment code (§13)
└── docs/                           This document suite
```

## 3. Module boundaries and dependency rules

Every directory under `modules/<context>/` follows the same internal layering:

```
modules/pricing/
├── domain/            Aggregates, value objects, state machines, pure business rules
├── application/       Command/query handlers — orchestrates domain + infra
├── infra/             Repository implementations, outbox writers — the only layer touching the DB
├── api/               Route/controller bindings to generated OpenAPI server stubs
├── tests/             unit/, integration/, golden/, property/
└── module.json        Declares owned tables, published events, permitted dependencies
```

**Dependency rules (enforced by an architecture-lint CI tool, not convention alone):**
1. `domain/` never imports `infra/` or another module's `domain/` directly — cross-context references go through published IDs and contracts (SUB-0004 §1.4).
2. No module's `infra/` may reference another module's database tables (SUB-0011 ADR-008's boundary enforcement).
3. No `apps/*` or `services/*` contains business rules — domain-shaped logic (e.g., a proration calculation) must live in `modules/*/domain/`.
4. Every new migration is attributed to exactly one module and cannot alter another module's tables.

## 4. Shared platform packages

| Package | Responsibility |
|---|---|
| `platform/money` | Fixed-precision decimal/money types (SUB-0007 §13) |
| `platform/tenant-context` | Trusted tenant-context resolution (SUB-0014 §2) |
| `platform/idempotency` | Idempotency-record read/write helpers (SUB-0011 ADR-016) |
| `platform/outbox-client` | Outbox write helper used inside the same transaction as any domain mutation |
| `platform/auth` | RBAC/ABAC permission checks, maker-checker evaluation (SUB-0014 §3, §10) |
| `platform/problem-model` | Canonical error/problem response construction (SUB-0013 §8) |
| `platform/observability` | Correlation/causation propagation, structured logging, tracing helpers |

## 5. Coding standards (summary; full rules per topic)

| Topic | Rule |
|---|---|
| Money | Never binary floating point; `platform/money` types only; rounding happens exactly where SUB-0007 §13 specifies, never an ad hoc extra step |
| Time | Every instant stored/transmitted as UTC; `requested_at`/`effective_at`/`recorded_at` are distinct fields, never collapsed; no clock access inside deterministic pricing logic |
| Tenant context | Never read `tenant_id` from a request body below the API entry layer; every repository query includes the tenant filter structurally, not as an ad hoc clause a developer might forget |
| Idempotency | Every financially material command handler requires an idempotency key; the idempotency check and domain effect commit in the same transaction |
| Events | An event is written only inside the same transaction as its state change, using `platform/outbox-client`; no payload includes a `SECURITY_SECRET`-classified field |
| Errors | Every API error uses `platform/problem-model`; a rejected command creates no partial financial effect; `404` for "not found" and "not authorized" use the identical shape |
| Logs | Every log line is structured, includes `tenant_id`/`correlation_id`, and never includes a raw `RESTRICTED_FINANCIAL`/`SECURITY_SECRET` value |
| Migrations | Owned by exactly one module; expand/migrate/contract sequencing; a financially material migration ships with a paired reconciliation script |
| Accessibility | Every new interactive component ships with keyboard operability and a screen-reader label in the same change; a color-only status indicator is rejected in review |

A pull request touching financially material code is not approvable without a reviewer confirming: no floating point in the diff's money paths, tenant context sourced only from `platform/tenant-context`, idempotency key handling with a replay test, the domain-event write in the same transaction as the state change, safe error handling, no raw financial/secret value in a new log statement, and (if a migration is included) expand/migrate/contract sequencing with a reconciliation script where financially material.

## 6. Configuration and environment strategy

- Environments: Development, Test, UAT, Production (master prompt §76-equivalent configuration-promotion concept, reserved as an Enterprise-horizon capability per SUB-0003 §2; MVP uses standard environment promotion without full configuration-package versioning).
- Configuration is environment-specific for infrastructure endpoints only; domain/business configuration (rate cards, workflows) is tenant data, not environment configuration, and follows its own effective-dated versioning (SUB-0007 §11).
- No `SECURITY_SECRET`-classified value ever appears in environment-variable dumps committed to source or in application configuration files (SUB-0014 §6).

## 7. Secrets handling

Reuses SUB-0014 §6 in full: every secret type lives in a secrets manager, referenced by ID; application services authenticate via workload identity retrieving short-lived credentials; rotation is scheduled plus immediate on suspected compromise.

## 8. Development workflow, branching, CI/CD

- Trunk-based development with short-lived feature branches; `main` is always releasable per the module's definition of done (SUB-0021 §7).
- Every pull request runs: unit tests, integration tests for touched modules, contract tests for touched API/event surfaces, architecture-lint, accessibility automated checks for touched screens, and the cross-cutting financial-code review checklist (§5) where applicable.
- Release candidates additionally run: full contract suite, golden dataset, property-based tests, tenant isolation matrix (zero exceptions), payment simulator, reconciliation tests (SUB-0019 §5).
- Progressive delivery (canary/rolling) for the BFF and workers, with automatic rollback on error-rate/latency regression; `billing-worker` and `payment-worker` additionally require a manual approval gate before full rollout, given their blast radius (mirrors SUB-0011's financial-consistency emphasis).

## 9. Database migrations

Reuses SUB-0012 §10 in full: forward-only, expand/migrate/contract sequencing; restartable, tenant-bounded, checksummed backfills; populate-and-validate staging for new `NOT NULL` constraints; a compatibility window for enum/status changes; financial migrations require source/target control totals, count/hash reconciliation, dry runs, and signed cutover evidence.

## 10. API generation and event schemas

- The OpenAPI document (`contracts/openapi/`, SUB-0013) is the source of truth; generated server stubs and client SDKs (`contracts/generated/`) are never hand-edited — CI regenerates and fails the build if committed generated output would differ, or regenerates as a build step, per a uniformly applied team policy.
- Event JSON Schemas (`contracts/events/`, SUB-0013 §11) follow the same source-of-truth discipline; a schema change that would break a currently-registered consumer contract test fails CI before merge.

## 11. Feature flags

- Every new financially material capability (a new pricing model type, a new collection policy, an AI autonomy-level increase) is gated by a feature flag enabling per-tenant activation and instant deactivation without a redeploy if a defect is found in production.
- Flags governing financial behavior are themselves audited on flip (who, when, which tenant) — a flag change is a material mutation under SUB-0014 §11's audit-logging requirement.

## 12. Testing conventions, logging, metrics, tracing

- Testing conventions follow SUB-0019 in full; every module's `tests/` directory mirrors the taxonomy in SUB-0019 §2 (unit/integration/golden/property at minimum).
- Logging, metrics, and tracing use `platform/observability` uniformly (§4); no module implements its own ad hoc logging/tracing wrapper.
- Business telemetry (accepted/quarantined usage, rating lag, bill-run progress, invoice finalization rate, payment conversion, outbox lag, notification delivery, ledger reconciliation status) is instrumented from the first implementation of each capability, not added retroactively.

## 13. Deployment

- Zones: Edge, Application, Restricted Data, Provider (external) — per SUB-0011 §2.
- MVP deploys via a managed container platform meeting the multi-zone requirement (SUB-0018 §4); Kubernetes is adopted only once operational scale justifies it (§1).
- RPO ≤ 5 minutes, RTO ≤ 60 minutes (SUB-0018 §4), verified by a quarterly-minimum restore drill covering both full-cluster and single-tenant logical restore with isolation-preservation verification.
- Rollback: application rollback via the same progressive-delivery mechanism; migration rollback only for migrations declared reversible; a financial mistake found post-deployment is corrected through domain adjustment/reversal mechanisms, never a database rollback that would discard newer legitimate transactions.

## 14. Acceptance criteria

1. Every module directory follows the internal layering in §3, verified by architecture-lint.
2. No generated contract file (§10) is ever the target of a direct source-controlled edit.
3. Every financially material command handler has a corresponding idempotent-replay test before merge (ties to SUB-0019 §7).
4. A new bounded context can be added by creating one new `modules/*` directory and a `module.json` entry, without modifying any existing module's internal layout convention.
5. Every deployment of `billing-worker`/`payment-worker` passes through the manual approval gate (§8) before reaching full traffic.
6. A rollback runbook has been rehearsed at least once before the first production launch handling live payment data.

## Decisions Requiring Product Owner Approval

| ID | Decision needed | Status |
|---|---|---|
| DEC-044 | Final backend runtime selection (TypeScript/Node, Kotlin/Java, or Go) after the precision/throughput/team-capability spike | Open |
| DEC-045 | Managed container platform vs. self-operated Kubernetes decision threshold | Open |

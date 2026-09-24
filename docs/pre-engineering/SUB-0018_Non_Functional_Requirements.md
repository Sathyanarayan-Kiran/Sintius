# SUB-0018 — Non-Functional Requirements

**Document ID:** SUB-0018
**Title:** Non-Functional Requirements
**Version:** 0.1 (Draft)
**Status:** Draft
**Owner:** Site Reliability Architect
**Reviewers:** Principal Software Architect, Security Architect, QA/Test Architect, Enterprise Product Manager
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23
**Dependencies:** [SUB-0001](SUB-0001_Product_Requirements_Document.md), [SUB-0011 System Architecture](SUB-0011_System_Architecture.md)
**Related Documents:** SUB-0019 Test Strategy & Financial Correctness Framework (planned), SUB-0020 Engineering Implementation Blueprint (planned)

## 1. Availability

| Capability tier | MVP target | Enterprise target |
|---|---|---|
| Financial write path (invoice finalize, payment post, allocation) | 99.9% | 99.99% where commercially appropriate (Decision DEC-006) |
| Usage ingestion | 99.9% | 99.95%+ |
| Admin/Portal read paths | 99.5% | 99.9% |
| AI gateway (advisory) | Best-effort; a gateway outage falls back to deterministic behavior (SUB-0009 §3.2, SUB-0016 §3) and never blocks a financial operation | Same |

No single point of failure in the financial write path; multi-zone deployment for the Application and Data zones (SUB-0011 §2).

## 2. Scalability and throughput

| Dimension | MVP assumption | Scaling approach |
|---|---|---|
| Usage events | Benchmarked target set via a dedicated throughput spike before schema freeze (Decision, §9); architecture is horizontally scalable regardless of the initial number (SUB-0011 §4, `usage-ingress` worker) | Independent worker scaling (SUB-0011 §11 extraction triggers) |
| Concurrent billing runs | One active run per tenant at MVP; cross-tenant runs execute in parallel with per-tenant fairness (SUB-0011 §12) | Worker pool scaling |
| Invoice volume | Sized to the MVP commercial wedge (mid-market B2B SaaS, SUB-0003); a specific number is a launch-planning input, not assumed here | Partitioned tables (SUB-0012 §7), horizontally scalable billing workers |
| Large enterprise tenant | A single tenant's subscription/usage/invoice volume must not degrade another tenant's SLOs (noisy-neighbor controls, SUB-0011 ADR-013) | Per-tenant quota and fairness controls; dedicated deployment path for extreme cases (SUB-0011 ADR-013) |

## 3. Performance and latency

| Operation class | Target |
|---|---|
| Standard synchronous API (excluding external providers) | p95 < 500 ms |
| Common UI interaction | < 2 seconds |
| Search | < 1 second where practical (PostgreSQL-native at MVP, SUB-0011 ADR-014) |
| Critical financial API (invoice finalize, payment attempt) | Same p95 < 500 ms target for the platform's own processing; external provider latency is excluded and surfaced separately |
| Async job (billing run, bulk export) | No fixed latency target; progress/control totals are exposed and the job is restartable (SUB-0011 §12) |

## 4. RPO, RTO, backup, disaster recovery

| Target | MVP value |
|---|---|
| RPO | ≤ 5 minutes, via continuous WAL archiving / point-in-time recovery |
| RTO | ≤ 60 minutes, via standby promotion runbook, tested on a regular drill cadence |
| Backup verification | Quarterly minimum full-cluster and single-tenant logical restore drill, verified for tenant-isolation preservation post-restore (mirrors SUB-0014 §4 isolation controls applied to restore) |
| Disaster recovery | Multi-zone deployment for MVP; multi-region DR is an Enterprise-horizon capability tied to the regional-deployment decision (Decision, §9) |

## 5. Security

Fully specified in SUB-0014; this document's obligation is to state that every availability/performance target above assumes the security controls in SUB-0014 remain in force — a performance optimization is never permitted to weaken tenant isolation, encryption, or audit completeness.

## 6. Maintainability

- Module boundaries enforced by architecture-lint tooling (SUB-0011 §9 ADR-008) keep any single change's blast radius bounded to its owning bounded context.
- Database migrations follow expand/migrate/contract sequencing (SUB-0012 §10) so schema evolution never requires coordinated downtime across modules.
- Every financially material code path has a corresponding golden/property test (SUB-0019, planned) so a regression is caught before release, not after.

## 7. Observability

- OpenTelemetry-based tracing, metrics, and structured logs with correlation/causation propagation across API, jobs, provider calls, and outbox facts (SUB-0011 §12).
- Business telemetry (accepted/quarantined usage, rating lag, bill-run progress, invoice finalization rate, payment conversion, outbox lag, notification delivery, ledger reconciliation status) is dashboarded alongside technical RED/USE metrics.
- Every batch process exposes progress and control totals; every alert has a named on-call owner before launch.

## 8. Accessibility

- WCAG 2.2 AA is the release bar for both the Admin experience and the Subscriber Portal (SUB-0015 §6).
- Automated accessibility testing (axe-core or equivalent) runs on every changed screen; a new AA violation blocks merge absent an explicit, time-bound, tracked exception (SUB-0019, planned).

## 9. Localization

- English is the initial operating language (SUB-0001 ASM-04); the data and template model is localization-ready — currency, date, and number formatting are locale-aware from MVP even though translated UI strings are not an MVP acceptance criterion.
- Every customer-facing template (invoices, notifications) supports a locale field from MVP so later translation does not require a data-model change.

## 10. Data residency

- `Tenant.data_residency_region` is reserved from MVP schema (SUB-0012 §4.1) even though MVP operates a single region.
- Regional deployment (US, EU, India, APAC) is an Enterprise-horizon capability; the trigger is the first tenant with a hard residency requirement (Decision, §9, mirrors SUB-0011 §11 extraction-trigger discipline applied to geography).

## 11. Cost efficiency

- No infrastructure component is adopted ahead of measured need (SUB-0011 §9 ADR-014/ADR-015 deferral pattern) — search, analytics, and workflow-engine technology choices are deliberately deferred to avoid paying for scale the platform does not yet have.
- Noisy-neighbor controls (SUB-0011 ADR-013, §2 above) protect cost efficiency by preventing one tenant's inefficient usage pattern from forcing platform-wide over-provisioning.
- Cost per financially processed transaction (invoice finalized, payment processed) is tracked as an operational metric from MVP, informing when a deferred infrastructure investment (dedicated search, analytics store, workflow engine) becomes justified.

## 12. Usage event, invoice-volume, and large-enterprise-tenant assumptions

These are explicitly **assumptions requiring validation**, not committed targets, pending Decision DEC-004-equivalent throughput spikes (§9):

| Assumption | Status |
|---|---|
| MVP usage event throughput (events/minute, burst profile) | Requires a dedicated benchmark spike before schema/partitioning freeze (SUB-0012 §7) |
| Invoice volume per billing run | Requires launch-tenant-profile input before capacity planning is finalized |
| Large enterprise tenant subscription/usage-dimension cardinality | Requires at least one reference large-tenant profile before the noisy-neighbor controls (§2) are tuned |
| Event retention window | Tied to the financial/audit retention floor (SUB-0012 §7); operational (non-financial) retention may be shorter and is a separate, explicit decision |

Master-prompt example targets (critical financial APIs 99.99%, standard API p95 < 500 ms, UI common actions < 2 sec, search < 1 sec where practical) are adopted as stated in §1–§3 above, with the 99.99% figure explicitly scoped to the Enterprise horizon per Decision DEC-006 rather than assumed as an MVP commitment.

## 13. Acceptance criteria

1. Every NFR category in §1–§11 has a stated MVP target or an explicit "requires validation" status — no silent omission.
2. RPO/RTO targets are demonstrated by a passing restore drill, not only configured (SUB-0019, planned).
3. No performance or cost-efficiency target is achieved by weakening a control specified in SUB-0014.
4. Every assumption in §12 has an owner and a validation method before it is treated as a committed capacity target.
5. Accessibility automated tests run in CI for every screen in SUB-0015 and block merge on a new AA violation.

## Decisions Requiring Product Owner Approval

| ID | Decision needed | Status |
|---|---|---|
| DEC-039 | Service-specific availability targets by capability tier, including whether/when 99.99% is committed (extends DEC-006) | Open |
| DEC-040 | MVP usage throughput, burst profile, and retention SLO after a dedicated benchmark spike (extends DEC-004) | Open |
| DEC-041 | Reference large-enterprise-tenant profile for noisy-neighbor tuning | Open |

# SUB-TRACEABILITY_MATRIX — Requirements Traceability Matrix

**Document ID:** SUB-TRACEABILITY_MATRIX
**Title:** Requirements Traceability Matrix
**Version:** 0.1 (Draft)
**Status:** Living document — all columns populated as of Gate 4; still living for post-baseline changes
**Owner:** Technical Program Manager
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23 (through Gate 4: SUB-0019–SUB-0021 — all columns populated)
**Related Documents:** [SUB-0001](SUB-0001_Product_Requirements_Document.md), [SUB-0004](SUB-0004_Domain_Model.md), [SUB-0005](SUB-0005_State_Machine_Specification.md), [SUB-GLOSSARY](SUB-GLOSSARY.md)

Chain: **BR ID → FR ID → Domain Entity → State Machine → API → Event → UI Screen → Security Control → User Story → Test Case.** No requirement may remain orphaned (unmapped to at least a Domain Entity) once SUB-0004 exists. `—` means "not applicable to this BR," not "not yet authored." Where SUB-0021 §2–§18 does not yet contain a fully fleshed representative story for a BR (only a feature-level reference), the User Story column says so explicitly rather than fabricating a story ID — full decomposition of every remaining feature into stories is the standing method in SUB-0021 §19, not a one-time act.

| BR ID | FR ID(s) | Domain Entity | State Machine | API | Event | UI Screen | Security Control | User Story | Test Case |
|---|---|---|---|---|---|---|---|---|---|
| BR-001 | FR-050, FR-051, FR-052, FR-053 | RateCard, PriceRule | — (no state machine; versioned lifecycle, SUB-0007 §11) | `/prices` rate-card endpoints (SUB-0013 §9) | — (pricing activation is internal-only; not in the SUB-0013 §11 public 12-event catalog) | Pricing Studio (SUB-0015 §3.5) | Maker-checker on activation (SUB-0014 §10) | US-E005-01 (SUB-0021 §6) | SUB-0007 §14 Golden Examples 3–6; SUB-0019 §2.6 property test |
| BR-002 | FR-020, FR-021 | UsageEvent, Payment, PaymentAttempt | Payment, Payment Attempt (SUB-0005 §4–§5) | `/usage-events`, `/payments` (SUB-0013 §9) | `usage.received.v1`, `usage.rated.v1`, `payment.attempted.v1` (SUB-0013 §11) | Usage Explorer, Payment Detail (SUB-0015 §3.6, §3.8) | Idempotency architecture (SUB-0011 ADR-016, SUB-0014 §9) | US-E001-01, US-E011-01 (SUB-0021 §2, §12) | SUB-0019 §2.3 duplicate-request contract test; §2.12 concurrency test |
| BR-003 | FR-052, FR-090 | Charge, RatedEvent, Invoice, InvoiceLine | Invoice (SUB-0005 §3) | `/invoices` (SUB-0013 §9) | `invoice.generated.v1`, `invoice.finalized.v1` (SUB-0013 §11) | Invoice Detail (SUB-0015 §3.7) | — | US-E008-01 (SUB-0021 §9) | SUB-0019 §2.7 golden dataset |
| BR-004 | FR-001 | Tenant | Tenant (SUB-0004 §5.1) | Cross-cutting: tenant derivation rule (SUB-0013 §3) | Cross-cutting: mandatory `tenant_id` on every envelope (SUB-0013 §11 envelope) | — (not a single screen) | Tenant isolation, RLS defense in depth (SUB-0014 §4) | Feature-level only (SUB-E001/E002, SUB-0021 §2–§3); no single dedicated story — cross-cutting requirement | SUB-0019 §6 tenant isolation matrix |
| BR-005 | FR-081, FR-082 | Invoice, CreditNote, JournalEntry | Invoice, Credit Note (SUB-0005 §3, §10) | `/invoices` credit-note/write-off endpoints (SUB-0013 §9) | `invoice.finalized.v1` (SUB-0013 §11; no dedicated public credit-note event in the 12-event catalog) | Invoice Detail (SUB-0015 §3.7) | Maker-checker on write-off (SUB-0014 §10) | Feature-level only (SUB-E008 F4, SUB-0021 §9); story pending SUB-0021 §19 decomposition | SUB-0019 §2.10 reconciliation test |
| BR-006 | FR-150, FR-151 | CollectionCase, RiskAssessment (implicit) | Collection Case (SUB-0005 §7) | `/collections` endpoints (SUB-0013 §9) | — (Collections events are internal-only per SUB-0013 §11.1 public/internal separation rule) | Collections Command Center (SUB-0015 §3.9) | Collections Agent grounding/data-scope controls (SUB-0016 §3.2) | US-E012-01 (SUB-0021 §13) | SUB-0009 §8 AC 6, AC 8 |
| BR-007 | FR-190, FR-191, FR-200 | Subscription, Invoice, PaymentMethod | Subscription (SUB-0005 §2) | `/subscriptions`, `/payment-methods` (SUB-0013 §9) | `subscription.changed.v1` (SUB-0013 §11) | Subscriber Portal (SUB-0015 §3.11) | Portal session tenant/account scoping (SUB-0014 §2) | US-E010-01, US-E006-01 (SUB-0021 §7, §11) | SUB-0015 §6 AC 5 no-dark-pattern UX audit |
| BR-008 | FR-004, FR-053 | ApprovalRequest (implicit; User/Role) | — (approval workflow, SUB-0014 §10) | Cross-cutting approval gate on every governed command (SUB-0013 §3) | — (approval decisions are internal, not a public event) | Approval-pending banner, shared across screens (SUB-0015 §4) | Maker-checker, separation of duties (SUB-0014 §10) | US-E002-01 (SUB-0021 §3) | SUB-0019 §2.15 self-approval rejection test |
| BR-009 | — (governed in SUB-0016) | AuditEvent | — | — (AI gateway is internal; no direct public endpoint) | — (AI interaction evidence is internal audit data, SUB-0016 §5) | Customer 360 AI panel (SUB-0015 §3.2) | Full SUB-0016 governance + AI threat controls (SUB-0014 §12) | US-E015-01 (SUB-0021 §16) | SUB-0016 §7 AC 3 grounding/fabrication test |
| BR-010 | — (cross-cutting) | — (applies to all entities) | — | Every endpoint in SUB-0013 §9 (API parity is the requirement itself) | — | — | Feature-level only; cross-cutting requirement verified per-endpoint, not a single story | SUB-0019 §2.3–§2.4 contract/API tests |
| BR-011 | — (cross-cutting) | — (applies to all aggregates) | — | — | Every event in SUB-0013 §11 (event-driven interoperability is the requirement itself) | — | Event tenant/classification controls (SUB-0014 §4 events row) | Feature-level only; cross-cutting requirement verified per-event | SUB-0019 §2.5 event testing |
| BR-012 | FR-050 | ProductVersion, RateCard, Subscription | Subscription (SUB-0005 §2) | `/products`, `/plans`, `/prices`, `/subscriptions` (SUB-0013 §9) | `subscription.created.v1`, `subscription.changed.v1` (SUB-0013 §11) | Catalog, Pricing Studio (SUB-0015 §3.4–§3.5) | — | US-E004-01, US-E005-01 (SUB-0021 §5, §6) | SUB-0019 §4 Golden Scenario G1 |
| BR-013 | — (governed in SUB-0006) | All RLG node types (SUB-0006 §3) | — | RLG query patterns (SUB-0006 §7; formal REST binding deferred to detailed design) | — | Revenue Lifecycle Graph / Transaction Explorer (SUB-0015 §3.12) | RLG node/attribute-level authorization, no existence leakage (SUB-0014 §4 RLG row) | Feature-level only; story pending SUB-0021 §19 decomposition | SUB-0006 §13 acceptance criteria |
| BR-014 | FR-003 | AuditEvent | — | Audit export (permissioned, logged; SUB-0014 §11) | — | Customer 360 Timeline tab, audit views (SUB-0015 §3.2, §5) | Audit-log INSERT-only privilege, no update/delete grant (SUB-0014 §11) | US-E017-01 (SUB-0021 §18) | SUB-0019 §2.2 audit-completeness integration test |
| BR-015 | — (cross-cutting) | — (full vertical slice) | All (SUB-0005) | All of SUB-0013 §9 | All of SUB-0013 §11 | All of SUB-0015 §3 | All of SUB-0014 | All epics (SUB-0021 §2–§18) | SUB-0019 §4 Golden Scenario G1 (end-to-end acceptance) |

## Coverage check

| Gate | Required columns populated | Status |
|---|---|---|
| Gate 1 (SUB-0000–SUB-0006) | BR ID, FR ID, Domain Entity, State Machine | Complete — no orphaned BR/FR as of this update |
| Gate 2 (SUB-0007–SUB-0010) | Deepens detail behind FR-050–053 (BR-001), FR-020–021 (BR-002), FR-052/090 (BR-003), FR-081/082 (BR-005), FR-140/141/150/151 (BR-006/BR-007) with full pricing/billing/payments/accounting specification | Complete — no new orphaned BR/FR; no new top-level FR ranges introduced, existing ranges detailed |
| Gate 3 (SUB-0011–SUB-0018) | API, Event, UI Screen, Security Control | Complete — all 15 BRs carry an explicit value or a justified `—` in every column through Security Control |
| Gate 4 (SUB-0019–SUB-0021) | User Story, Test Case | **Complete** — every BR carries a User Story reference (either a specific `US-<EPIC>-NN` ID or an explicit "feature-level only, story pending decomposition" note) and a Test Case reference |

## Change log

| Date | Change |
|---|---|
| 2026-09-23 | Initial population from SUB-0000–SUB-0006 (Gate 1). All 15 BRs from SUB-0001 mapped to at least a Domain Entity; no orphans. |
| 2026-09-23 | Gate 2 (SUB-0007–SUB-0010) complete; FR detail deepened for pricing, billing, payments, and accounting requirement areas. No structural change to the matrix's mapped rows. |
| 2026-09-23 | Gate 3 (SUB-0011–SUB-0018) complete; API, Event, UI Screen, and Security Control columns populated for all 15 BRs, resolving every `Pending SUB-0013`/`SUB-0014`/`SUB-0015`/`SUB-0016` placeholder. |
| 2026-09-23 | Gate 4 (SUB-0019–SUB-0021) complete; User Story and Test Case columns populated for all 15 BRs. Matrix is now fully populated end to end with no orphaned requirement and no remaining `Pending` placeholder. |

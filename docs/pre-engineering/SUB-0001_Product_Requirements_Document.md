# SUB-0001 — Product Requirements Document

**Document ID:** SUB-0001
**Title:** Product Requirements Document
**Version:** 0.1 (Draft)
**Status:** Draft
**Owner:** Enterprise Product Manager
**Reviewers:** CPO, Finance, Architecture, Security, UX
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23
**Dependencies:** [SUB-0000 Product Manifesto](SUB-0000_Product_Manifesto.md)
**Related Documents:** [SUB-0002 Competitive Capability Matrix](SUB-0002_Competitive_Capability_Matrix.md), [SUB-0003 MVP Scope & Release Strategy](SUB-0003_MVP_Scope_Release_Strategy.md), SUB-0018 Non-Functional Requirements (planned), [SUB-GLOSSARY](SUB-GLOSSARY.md)

## 1. Executive summary

The platform is a multi-tenant Subscription, Billing, Payments, Collections, Revenue, and Monetization system. It moves a commercial agreement through subscription, usage, billing, invoicing, collection, reconciliation, and revenue recognition while preserving end-to-end traceability (the Revenue Lifecycle Graph, SUB-0006). This document defines the complete requirement set; SUB-0003 selects which requirements are satisfied in the MVP versus later releases.

## 2. Problem statement

Reuses SUB-0000 §4 core business problems as the authoritative statement; this PRD converts them into requirements rather than restating them.

## 3. Vision

Reuses SUB-0000 §2 verbatim: the operating system for recurring commercial relationships.

## 4. Goals

| ID | Goal | Outcome measure |
|---|---|---|
| GOAL-01 | Launch monetization without engineering deployments | A pricing manager configures and activates a supported price model without code (FR-050–FR-058). |
| GOAL-02 | Produce correct, explainable bills | Every invoice line resolves to a price version and calculation trace (FR-080–FR-090). |
| GOAL-03 | Prevent duplicate or lost financial effects | Idempotency and durable usage acceptance hold under retry and failure (FR-020–FR-025, SUB-0019). |
| GOAL-04 | Improve payment success through prevention | Operators and subscribers see risk and next action before and after failure (FR-140–FR-155). |
| GOAL-05 | Build subscriber trust | A subscriber can inspect amount, due date, usage basis, and payment state from one portal (FR-190–FR-200). |
| GOAL-06 | Preserve enterprise evolution | MVP boundaries permit later contracts, entitlements, multi-currency, revenue recognition, and marketplace support without replacing canonical identifiers (SUB-0003). |
| GOAL-07 | Govern AI as a bounded participant | AI recommendations and actions are grounded, explainable, policy-bounded, and audited (SUB-0016). |

## 5. Non-goals

- General-ledger close or full corporate accounting consolidation (the platform exports to ERP; SUB-0017).
- Acting as merchant of record or payment processor (the platform orchestrates provider-neutral payment abstractions; SUB-0009).
- Statutory tax determination/filing content (the platform stores tax evidence and integrates with tax providers; SUB-0009, SUB-0017).
- Unrestricted AI autonomy over financial state at any point (SUB-0016 defines the ceiling as policy-bounded L3, never unconditional).
- Full enterprise CPQ/negotiated-contract authoring in the MVP horizon (SUB-0003).

## 6. Personas

| Persona | Primary job to be done |
|---|---|
| Billing Administrator | Run accurate billing operations: preview/finalize invoices, issue corrections, resolve failures. |
| Pricing Manager | Launch controlled monetization changes quickly and safely. |
| Revenue Accountant | Ensure revenue recognition and ledger postings are correct and auditable. |
| Collections Analyst | Recover and prevent delinquency using explainable, policy-bounded recommendations. |
| Finance Controller | Protect financial integrity: approve sensitive actions, reconcile, audit. |
| Customer Support Agent | Explain and resolve billing/payment questions quickly using Customer 360. |
| Sales | Configure quotes/offers within approved commercial boundaries (SUB-0003 defers full CPQ). |
| Product Manager | Own catalog/entitlement decisions and monitor adoption. |
| Developer | Integrate the platform via API, SDKs, webhooks, and sandbox. |
| Auditor | Verify who changed what, when, and why across financial history. |
| Executive | Understand recurring revenue, risk, and collection performance. |
| Subscriber | Understand and control what they owe, why, and how to pay or change their subscription. |
| Partner/Seller | Operate as a seller within a marketplace model (Enterprise horizon, SUB-0003). |

## 7. Jobs to be done (representative)

| Persona | Job |
|---|---|
| Pricing Manager | "When I need to launch a new usage-based price, I want to configure and simulate it visually, so I can activate it without waiting on an engineering release." |
| Collections Analyst | "When an account's payment risk rises, I want a ranked, explainable next action, so I can intervene before the invoice becomes overdue." |
| Subscriber | "When my bill is higher than expected, I want a plain-language, fact-grounded explanation, so I can trust the charge without contacting support." |
| Finance Controller | "When a large credit is requested, I want a maker-checker approval gate, so no single actor can unilaterally reduce receivables above a threshold." |
| Developer | "When I integrate usage billing, I want an idempotent batch API and a sandbox, so I can build and test without risking duplicate charges." |

## 8. User journeys (representative, expanded in SUB-0021)

1. **Configure and sell:** Pricing Manager authors a rate card → validates → simulates against a cohort → submits for approval → Finance Controller approves → version activates → Sales/API creates a subscription against the active version.
2. **Meter to invoice:** A product submits usage events → platform deduplicates/validates → rating aggregates and prices deterministically → billing run assembles a draft invoice → an operator previews and finalizes → invoice posts with a legal number and immutable lines.
3. **Collect and recover:** Platform forecasts upcoming amount and risk → recommends a policy-bounded next action → payment is attempted at due time → provider callback updates canonical state → success allocates cash and closes collection work; failure starts dunning.
4. **Explain and self-serve:** Subscriber opens a bill → expands a line into usage/rate/allowance/discount/tax facts → asks "why is this higher than last month" and receives a fact-grounded explanation → pays or changes their subscription with a disclosed financial-impact preview.

## 9. Core functional capabilities

Reuses the master prompt's required capability list in full; each capability's requirement detail is developed in its dedicated specification document, cross-referenced below.

| Capability | Primary specification |
|---|---|
| Tenant management | SUB-0011, SUB-0014 |
| Customer/account | SUB-0004 |
| Product catalog | SUB-0004, SUB-0007 |
| Pricing | SUB-0007 |
| Contracts | SUB-0004, SUB-0005 |
| Subscriptions | SUB-0004, SUB-0005 |
| Entitlements | SUB-0004 |
| Metering | SUB-0007 |
| Rating | SUB-0007 |
| Billing | SUB-0008 |
| Invoicing | SUB-0008 |
| Tax | SUB-0008, SUB-0017 |
| Payments | SUB-0009 |
| Payment orchestration | SUB-0009 |
| Collections | SUB-0009 |
| Credits | SUB-0008, SUB-0010 |
| Refunds | SUB-0009 |
| Disputes | SUB-0005, SUB-0009 |
| Revenue recognition | SUB-0010 |
| Reconciliation | SUB-0010 |
| Accounting | SUB-0010 |
| Analytics | SUB-0015 (UX), SUB-0018 (targets) |
| AI | SUB-0016 |
| Workflows | SUB-0013 (events), SUB-0015 (Workflow Builder) |
| Rules | SUB-0013, SUB-0015 |
| Integrations | SUB-0017 |
| Reporting | SUB-0015 |
| Customer portal | SUB-0015 |

## 10. Business requirements

| ID | Requirement |
|---|---|
| BR-001 | The platform MUST allow a Pricing Manager to configure, validate, simulate, and activate a supported pricing model without a code deployment. |
| BR-002 | The platform MUST guarantee that a retried financial command produces exactly one business effect. |
| BR-003 | The platform MUST make every billable amount explainable from persisted calculation evidence, not regenerated or AI-inferred prose alone. |
| BR-004 | The platform MUST prevent one tenant from reading, changing, or inferring another tenant's data under any code path. |
| BR-005 | The platform MUST never silently mutate a posted invoice, a posted ledger entry, or an activated price version; corrections use explicit adjustment, credit, reversal, or superseding version. |
| BR-006 | The platform MUST assess and communicate payment risk and a recommended next action before a due date, not only after failure. |
| BR-007 | The platform MUST allow a subscriber to view, understand, and act on their subscriptions, usage, bills, and payments without contacting support for routine needs. |
| BR-008 | The platform MUST require maker-checker approval for financially sensitive actions above configurable thresholds (pricing activation, large credits/refunds/write-offs). |
| BR-009 | The platform MUST bound every AI action to an explicit, policy-defined autonomy level and produce an auditable record of model, input, decision, and outcome. |
| BR-010 | The platform MUST expose every UI-available capability through an equivalent, permissioned API. |
| BR-011 | The platform MUST publish material state changes as versioned, immutable domain events. |
| BR-012 | The platform MUST support effective-dated commercial configuration such that historical pricing and terms are never overwritten. |
| BR-013 | The platform MUST provide native, bidirectional traceability from a commercial offer to its resulting ledger entry (the Revenue Lifecycle Graph). |
| BR-014 | The platform MUST preserve a complete audit trail for every material mutation, including AI-originated actions. |
| BR-015 | The platform MUST support the MVP vertical slice defined in SUB-0003 as a coherent, demonstrable end-to-end path. |

## 11. Functional requirements (representative; full set decomposed per capability document)

| ID | Requirement | Traces to |
|---|---|---|
| FR-001 | The system MUST require a resolved tenant context for every business operation and persistence query. | BR-004, SUB-0011, SUB-0014 |
| FR-002 | The system MUST support OIDC/SAML login, MFA policy, RBAC, and optional ABAC. | SUB-0014 |
| FR-003 | The system MUST record actor, action, object, time, source, reason, and before/after references for material mutations. | BR-014, SUB-0014 |
| FR-004 | Sensitive operations MUST support configurable maker-checker approval with separation of duties. | BR-008, SUB-0014 |
| FR-020 | APIs accepting a retryable financial command MUST require and honor an idempotency key. | BR-002, SUB-0013, SUB-0019 |
| FR-021 | Usage ingestion MUST deduplicate by stable source event identity and never lose an accepted event. | BR-002, SUB-0007 |
| FR-050 | Catalog objects MUST be versioned and effective-dated; activated versions MUST NOT be edited in place. | BR-001, BR-012, SUB-0004, SUB-0007 |
| FR-051 | The pricing engine MUST support, at minimum, the MVP-classified pricing models in SUB-0003 composably within one subscription. | BR-001, SUB-0007 |
| FR-052 | Pricing calculations MUST use fixed-precision decimal arithmetic, explicit rounding, and a persisted calculation trace. | BR-003, SUB-0007 |
| FR-053 | Pricing activation MUST enforce permissions, approvals where policy requires, and emit an audit event. | BR-008, BR-014, SUB-0007 |
| FR-080 | Billing MUST support the schedules and proration behavior defined in SUB-0008 with deterministic, replayable output. | BR-003, SUB-0008 |
| FR-081 | Draft invoices MUST be previewable and recalculable; posted invoices MUST be immutable. | BR-005, SUB-0008 |
| FR-082 | Corrections to posted invoices MUST use credit note, debit note, void, or reversal policy defined in SUB-0008. | BR-005, SUB-0008 |
| FR-090 | Every invoice line MUST link to its commercial source, calculation trace, service period, and tax evidence. | BR-003, SUB-0006, SUB-0008 |
| FR-140 | Canonical payment and attempt state MUST be provider-neutral; providers are adapters, never the domain model. | SUB-0009 |
| FR-141 | Webhooks MUST be signature-verified, deduplicated, and resilient to out-of-order delivery. | SUB-0009, SUB-0014 |
| FR-150 | Every account MUST expose upcoming amount, payment risk, preferred channel, and a policy-bounded next action. | BR-006, SUB-0009 |
| FR-151 | Collection recommendations MUST have deterministic fallback rules and MUST NOT use protected attributes. | BR-006, SUB-0009, SUB-0016 |
| FR-190 | Portal users MUST view subscriptions, usage, invoices, balance, payments, and tokenized payment methods. | BR-007, SUB-0015 |
| FR-191 | Self-service subscription and payment-method changes MUST disclose effective date and financial impact before confirmation. | BR-007, SUB-0015 |
| FR-200 | Cancellation MUST be no harder to complete than upgrading and MUST NOT employ dark patterns. | BR-007, SUB-0000 PRIN-10/PRIN-11 |

Full functional requirement decomposition per capability continues within SUB-0004 through SUB-0017 as each is authored; this document is updated (§18 execution method) to append new FR ranges as they are defined, and the Requirements Traceability Matrix (SUB-TRACEABILITY_MATRIX) is the authoritative cross-reference once the full set exists.

## 12. Non-functional requirements

Defined in full in SUB-0018 (planned, Gate 3). Summary targets referenced here: critical financial APIs 99.99% target (enterprise horizon; MVP planning target is stated in SUB-0018), standard API p95 < 500 ms, UI common actions < 2 s, search < 1 s where practical.

## 13. Assumptions

| ID | Assumption |
|---|---|
| ASM-01 | The initial commercial wedge is mid-market B2B SaaS; the domain model remains industry-neutral (SUB-0003). |
| ASM-02 | Stripe is the first payment provider adapter; multi-gateway orchestration is a later release (SUB-0009, SUB-0003). |
| ASM-03 | PostgreSQL is authoritative for operational and financial records in the MVP horizon (SUB-0011, SUB-0012). |
| ASM-04 | English is the initial operating language; the data and template model is localization-ready but full localization is not an MVP acceptance criterion. |
| ASM-05 | AI is advisory-to-bounded in the MVP horizon per the L0–L2 autonomy levels; L3 execution-within-policy is evaluated per capability before enablement (SUB-0016). |

## 14. Dependencies

- Payment provider (Stripe) API and webhook reliability.
- Tax evidence source (external provider or externally derived input) per SUB-0009/SUB-0017.
- Identity provider for OIDC/SAML federation (SUB-0014).
- ERP/accounting system for downstream journal export (SUB-0010, SUB-0017).

## 15. Constraints

- No production code begins before Gate 4 (SUB-0019–SUB-0021) is satisfied per the master prompt's review-gate structure.
- Financial invariants (§11 of the master prompt, restated in SUB-0019) are non-negotiable and override delivery-schedule pressure per PRIN-04.
- AI may never be the sole source of a financial fact (PRIN-06).

## 16. Success metrics

| Metric | Target/definition |
|---|---|
| Billing accuracy | ≥ 99.99% of finalized invoice lines match approved golden calculations (SUB-0019). |
| Duplicate financial effect rate | Zero, verified continuously by the idempotency contract-test suite (SUB-0019). |
| Payment success rate / recovery rate | Tracked segmented by method and attempt; preventive-collections effectiveness measured against a deterministic-fallback baseline. |
| Time to launch a supported price model | Under one business day after commercial approval, once the model is already supported by the engine. |
| Self-service completion rate | Percentage of portal-initiated changes completed without a support contact. |
| Audit completeness | 100% of financially material mutations have a corresponding audit record with lineage. |

## 17. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Checklist-driven MVP scope creep | Shallow financial correctness, slow delivery | SUB-0003 enforces explicit non-goals and a vertical-slice release test |
| Undefined numeric/rounding semantics | Financial discrepancies, customer disputes | SUB-0007 freezes precision/rounding policy before implementation; Finance sign-off required (Human Decision Register) |
| AI overreach | Fabricated explanations, unauthorized action | SUB-0016 autonomy levels, grounding, and audit are mandatory, not optional |
| Weak tenant isolation | Cross-tenant data exposure | SUB-0011/SUB-0012/SUB-0014 mandate defense-in-depth isolation with negative test coverage in SUB-0019 |
| Provider lock-in | Loss of routing flexibility, regional expansion risk | SUB-0009 mandates canonical, provider-neutral payment abstractions |

## 18. Open questions

Tracked and resolved progressively in the Human Decision Register (§19).

## 19. Decisions Requiring Product Owner Approval

| ID | Decision needed | Status |
|---|---|---|
| DEC-001 | Launch countries, invoice regulations, currencies, and initial tax provider | Open |
| DEC-002 | Numeric precision and rounding policy by currency/model (finance sign-off) | Open |
| DEC-003 | Stripe account model, supported methods, regions, and Connect/non-Connect scope | Open |
| DEC-004 | MVP usage throughput, burst profile, and retention SLO | Open |
| DEC-005 | AI autonomy thresholds per agent (SUB-0016) before any L2/L3 enablement | Open |
| DEC-006 | Target availability by capability tier (SUB-0018) | Open |
| DEC-007 | Tenant deployment strategy (shared vs. dedicated) trigger criteria | Open |
| DEC-008 | Countries/payment rails supported at MVP launch | Open |
| DEC-009 | Confirm MVP capability classification (SUB-0003 §2) as final before backlog conversion | Open |
| DEC-010 | Approve MVP exit criteria (SUB-0003 §6) as the gate for Release 2 planning kickoff | Open |
| DEC-011 | De-minimis auto-resolution threshold for Dispute state machine (SUB-0005 §9.4) | Open |
| DEC-012 | Refund approval threshold amount(s) by currency (SUB-0005 §8) | Open |
| DEC-013 | Finance sign-off on `HALF_UP` rounding and `ACTUAL_DAYS` proration convention (extends DEC-002; SUB-0007 §13) | Open |
| DEC-014 | Release 2 pricing-model implementation priority order beyond the MVP set (SUB-0007 §3) | Open |
| DEC-015 | Verification-source requirements for outcome-based/revenue-share pricing before enabling for any live tenant (SUB-0007 §3.8) | Open |
| DEC-016 | Default invoice-grouping policy for new tenants (SUB-0008 §7) | Open |
| DEC-017 | Gap-evidence requirement for finalization rollback by launch jurisdiction (SUB-0008 §6) | Open |
| DEC-018 | Stripe account model and supported regions/methods at MVP launch (extends DEC-003; SUB-0009 §1) | Open |
| DEC-019 | Predictive routing/retry model opt-in default and evaluation cadence (SUB-0009 §3.5) | Open |
| DEC-020 | Collections risk-signal fairness/disparate-impact review before enabling for any live tenant (SUB-0009 §5) | Open |
| DEC-021 | Applicable revenue recognition standard(s) and multi-element allocation method (SUB-0010 §7–§8) | Open |
| DEC-022 | Chart-of-accounts default mapping and per-tenant customization scope (SUB-0010 §12) | Open |
| DEC-023 | Reconciliation exception SLO and escalation ownership (SUB-0010 §9) | Open |
| DEC-024 | Confirm the modular-monolith starting topology (SUB-0011 ADR-008) as the approved architecture baseline before Gate 4 backlog conversion | Open |
| DEC-025 | Approve deferral of a dedicated search/analytics platform (SUB-0011 ADR-014/ADR-015) pending measured Release 2 need | Open |
| DEC-026 | Financial/audit retention floor by launch jurisdiction (extends DEC-001; SUB-0012 §7) | Open |
| DEC-027 | Primary-key scheme final selection (ULID vs. UUIDv7) after benchmark (SUB-0012 §11) | Open |
| DEC-028 | API deprecation window length before the first breaking change (SUB-0013 §2) | Open |
| DEC-029 | Default and maximum `usage-events:batch` size under real ingestion load (SUB-0013 §9) | Open |
| DEC-030 | Whether GraphQL is offered alongside REST for read-heavy admin composition (SUB-0013 §12) | Open |
| DEC-031 | Break-glass audit review cadence and anomaly-alerting threshold (SUB-0014 §10) | Open |
| DEC-032 | Target certification roadmap (SOC 2 Type I/II timing, ISO 27001 scope) (SUB-0014 §13) | Open |
| DEC-033 | Penetration testing cadence and scope before first production launch handling live payment data (SUB-0014 §14) | Open |
| DEC-034 | Per-agent autonomy-level default and opt-in process for tenants (extends DEC-005; SUB-0016 §2) | Open |
| DEC-035 | Evaluation observation-period length and pass/fail criteria before any L2→L3 AI autonomy promotion (SUB-0016 §6) | Open |
| DEC-036 | Whether subscriber-facing Customer Care Agent L0 responses require a visible AI-disclosure label (SUB-0016 §3.6) | Open |
| DEC-037 | ERP connector implementation priority order for Release 2 (SUB-0017 §9) | Open |
| DEC-038 | Tax provider selection by launch jurisdiction (extends DEC-001; SUB-0017 §12) | Open |
| DEC-039 | Service-specific availability targets by capability tier, including whether/when 99.99% is committed (extends DEC-006; SUB-0018 §1) | Open |
| DEC-040 | MVP usage throughput, burst profile, and retention SLO after a dedicated benchmark spike (extends DEC-004; SUB-0018 §12) | Open |
| DEC-041 | Reference large-enterprise-tenant profile for noisy-neighbor tuning (SUB-0018 §12) | Open |
| DEC-042 | Load-test threshold values gating release, once the throughput benchmark exists (extends DEC-040; SUB-0019 §7) | Open |
| DEC-043 | Chaos-testing environment and cadence ownership (SUB-0019 §7) | Open |
| DEC-044 | Final backend runtime selection (TypeScript/Node, Kotlin/Java, or Go) after the precision/throughput/team-capability spike (SUB-0020 §1) | Open |
| DEC-045 | Managed container platform vs. self-operated Kubernetes decision threshold (SUB-0020 §13) | Open |

This register is the single authoritative location for high-impact commercial/product decisions across the entire document suite; later documents reference entries here rather than opening parallel decision lists.

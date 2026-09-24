# Master prompt review

**Reviewed:** `AI_Native_Subscription_Revenue_Platform_Master_Product_Specification.md`  
**Review date:** 2026-09-23  
**Disposition:** Suitable as a product vision and enterprise capability brief; not by itself implementation-ready.

## Executive assessment

The master prompt is unusually strong on product ambition, lifecycle completeness, financial invariants, and the sequencing of design before code. Its central idea—the Revenue Lifecycle Graph—provides a coherent product spine from commercial agreement to ledger. The Payment & Collections Intelligence MVP differentiator is also narrow enough to test commercially.

The prompt intentionally combines an enterprise end-state with an MVP. The main delivery risk is therefore not missing scope, but treating all stated capabilities as simultaneous MVP requirements. The pre-implementation set resolves this by separating MVP, Release 2, and Enterprise horizons and by preserving forward-compatible domain concepts without implementing empty enterprise machinery.

## Strengths to preserve

- End-to-end commercial and financial traceability is a product capability, not merely a logging concern.
- Posted invoices and ledgers are immutable; corrections are modeled explicitly.
- Pricing is effective-dated and historical commercial terms are preserved.
- Billing and entitlement are separate concepts.
- Payment providers are behind an orchestration/connector boundary.
- Idempotency, consistency, audit, tenant isolation, and explainability are non-negotiable.
- AI is bounded by deterministic fallbacks, protected-attribute restrictions, policy, and audit.
- Subscriber transparency and preventive collections are first-class experiences.
- The implementation method requires domain, API, event, security, UX, data, tests, and observability for each major capability.

## Ambiguities and adopted resolutions

| ID | Prompt ambiguity or tension | Adopted resolution for current drafts |
|---|---|---|
| R-001 | The target spans B2C, B2B, telecom, utilities, marketplaces, and industry, but no launch wedge is selected. | MVP targets mid-market B2B SaaS while keeping industry-neutral commercial primitives. |
| R-002 | MVP includes payment integration, while global methods and intelligent multi-gateway routing describe the end-state. | Stripe is the first provider-neutral adapter; multi-provider routing is Release 2. |
| R-003 | India-specific Razorpay/UPI is conditional, but launch geography is unspecified. | Keep an adapter seam; do not commit Razorpay until launch markets are decided. |
| R-004 | “Full subledger” is a core capability, while revenue recognition is enterprise scope. | MVP includes balanced receivables postings and immutable journal transactions, but not ASC 606/IFRS 15 allocation/schedules. |
| R-005 | Entitlements appear as a core domain service but are listed for Release 2. | Reserve an explicit boundary and IDs; do not make entitlement service an MVP dependency. |
| R-006 | “Millions of events per minute” is an end-state without an MVP traffic model. | Require horizontal design and durable ingestion; set concrete throughput after workload discovery and a benchmark spike. |
| R-007 | 99.99% availability is qualified by “where commercially appropriate.” | MVP planning target is 99.9% on financial writes; service-specific SLOs and enterprise 99.99% topology require business approval. |
| R-008 | Global invoicing/tax expectations lack launch jurisdictions and tax-liability model. | Provider-neutral tax evidence is modeled; legal formats and tax provider depend on country and seller-of-record decisions. |
| R-009 | AI forecasting/risk requires historical data, but cold-start and model governance are unspecified. | Deterministic scorecards/fallbacks launch first; ML recommendations require data readiness, evaluation, monitoring, fairness, and approval. |
| R-010 | Privacy erasure can conflict with immutable financial/audit records. | Retain legally required financial facts and pseudonymize/delete separable personal data under an approved retention policy. |
| R-011 | Subscriber self-service can conflict with contracts, regulation, and merchant policy. | Every action uses policy and shows effective date/financial impact; transparent cancellation remains the default where allowed. |
| R-012 | Search/analytics are described as real time, while financial posting needs strong consistency. | Transactional state is authoritative; projections show freshness and never authorize/post money. |
| R-013 | Microservice-capable contexts are listed while the prompt warns against premature services. | Begin as a modular monolith with separately scalable workers and explicit extraction criteria. |
| R-014 | The technology list offers several backend/runtime choices. | Defer runtime approval until a pricing precision, batch throughput, operability, and team-skill spike. |

## Missing decisions that block implementation, not documentation

1. Launch countries, merchant/seller-of-record model, invoice regulations, supported currencies, and initial tax provider.
2. Currency/quantity precision, rounding order, tier boundaries, proration convention, and calendar/time-zone semantics.
3. Payment methods and Stripe account model, including direct charges versus any connected-account use.
4. MVP usage throughput, peak shape, event size/dimension cardinality, retention, late-event window, and correction policy.
5. Data retention, residency, privacy erasure, support access, and audit-log retention requirements.
6. Availability/RPO/RTO targets by capability and the acceptable cost envelope.
7. Collection contact rules, risk inputs, protected-data review, retry limits, and jurisdiction-specific quiet hours.
8. Approval thresholds for pricing activation, credits, refunds, write-offs, and manual payment state repair.

These are tracked as assumptions or open decisions rather than silently invented. They must be resolved before the relevant schema/API is frozen.

## Scope risks

| Risk | Impact | Control |
|---|---|---|
| Checklist-driven MVP | Slow delivery and shallow financial correctness | Enforce the PRD non-goals and vertical-slice release test. |
| Premature microservices | Distributed failure and reconciliation complexity | Modular-first ADR and extraction triggers. |
| Provider model leakage | Lock-in and inconsistent future routing | Canonical payments plus anti-corruption adapters. |
| Mutable configuration affects history | Incorrect rebills and unexplainable invoices | Effective versions and pinned calculation traces. |
| AI overreach | Fabricated explanations or unauthorized financial actions | Governed advisory gateway, grounding, fallbacks, and separate authorized commands. |
| Weak tenant scoping | Cross-tenant exposure | Mandatory tenant context, RLS defense in depth, and negative isolation tests. |
| Undefined numeric semantics | Financial discrepancies | Approve pricing specification and golden datasets before implementation. |

## Recommended delivery sequence

Continue in the exact artifact order from the prompt. The next tranche should produce deliverables 06–12 together because the Revenue Lifecycle Graph, ERD, four state machines, and pricing rules constrain each other. API and event contracts should follow only after those semantics are stable; security and tenancy must then review those contracts before UX/backlog and implementation planning are finalized.


# SUB-GLOSSARY — Shared Glossary

**Document ID:** SUB-GLOSSARY
**Title:** Shared Glossary
**Version:** 0.1 (Draft)
**Status:** Living document — updated after every new artifact per the master prompt §18 execution method
**Owner:** Principal Software Architect
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23 (through Gate 4: SUB-0019–SUB-0021 — all 22 numbered documents complete)
**Related Documents:** [SUB-INDEX Document Register](SUB-INDEX_Document_Register.md), [SUB-TRACEABILITY_MATRIX](SUB-TRACEABILITY_MATRIX.md)

Every term below is defined exactly once. A later document must reuse a defined term as-is; it may extend a term's detail but must never redefine it differently. Proposed additions/changes are recorded in [SUB-ADR-REGISTER](SUB-ADR-REGISTER.md) if they represent a material domain decision.

| Term | Definition | Defined in |
|---|---|---|
| Account | Commercial and receivables boundary owned by a Customer; owns Subscriptions, Invoices, balance, contacts, and payment terms. | SUB-0004 §5.2 |
| Aggregate root | A domain entity that is the sole external entry point for consistency and identity within its cluster of owned child entities. | SUB-0004 §3 |
| Allowance | A quantity subtracted from aggregated usage before rating applies; scoped to one Subscription Item + Meter + billing window. | SUB-0007 §9 |
| AuditEvent | Append-only evidence record of a material mutation, human or AI-originated. | SUB-0004 §5.14 |
| Autonomy level | A policy-defined ceiling (L0–L3) bounding what an AI agent may do without further human authorization. | SUB-0016 §2 |
| Bounded context | A partition of the domain model with its own ubiquitous language and ownership boundary; contexts communicate only through published contracts. | SUB-0004 §2 |
| Broken-chain finding | A detected gap in the expected Revenue Lifecycle Graph path, evidenced and severity-scored, never an AI-generated diagnosis. | SUB-0006 §9 |
| Connector | A tenant-scoped, versioned adapter configuration translating an external system's identifiers/states at an anti-corruption boundary; external state never becomes canonical domain state. | SUB-0017 §1–§2 |
| Data classification | The mandatory sensitivity tag (`SECURITY_SECRET`, `RESTRICTED_FINANCIAL`, `CONFIDENTIAL_BUSINESS`, `INTERNAL_OPERATIONAL`, `PUBLIC`) every schema and event field carries, driving handling/redaction rules. | SUB-0014 §7 |
| Calculation trace | A persisted, typed operation tree recording exactly how a billable amount was derived, used as the sole factual source for billing explanations. | SUB-0007 §13 |
| Canonical reason | A stable, versioned reason code that a provider-specific decline/failure code maps to, carrying a `retry_advice` classification. | SUB-0009 §2.5 |
| Cash application | The act of allocating a succeeded Payment or credit to one or more open receivables. | SUB-0010 §4 |
| Chargeable quantity (`C`) | Normalized usage quantity after allowance is subtracted: `C = max(Q − A, 0)`. | SUB-0007 §3 |
| Charge | A billable economic fact produced by subscription, usage, or adjustment logic. | SUB-0004 §5.7 |
| CollectionCase | Managed work to prevent or resolve delinquency for an account or invoice set. | SUB-0004 §5.10 |
| Communication | One delivery request/outcome for a template-driven message to a customer or account contact. | SUB-0004 §5.10 |
| Contract | Formal negotiated agreement governing one or more subscriptions (Release 2 scope). | SUB-0004 §5.5 |
| CreditNote | Corrective document for a posted invoice; never edits the original invoice. | SUB-0004 §5.8 |
| Customer | Party receiving or buying value; may own one or more Accounts. | SUB-0004 §5.2 |
| Deferred revenue | The portion of a billed/collected amount not yet recognized under the applicable Revenue Schedule. | SUB-0010 §7 |
| Determinism key | The composite key (tenant, purpose, source fact/aggregate, price rule/version, service window, engine version) that guarantees identical input reproduces identical pricing output. | SUB-0007 §13 |
| Dispute | A subscriber- or operator-raised challenge to a charge, invoice, usage, tax, or payment, resolved through a governed workflow. | SUB-0005 §9 |
| DunningCampaign | Configurable retry/contact schedule and stop rules governing a class of collection cases. | SUB-0004 §5.10 |
| Effective-dated | A property of commercial configuration whereby a change takes effect at an explicit time without overwriting the prior version's history. | SUB-0000 PRIN-14 |
| Entitlement | What a subscriber may access, tracked separately from billing state. | SUB-0004 §5.6 |
| Financial Correctness Framework | The set of eight non-negotiable financial invariants (never double-charge, never lose usage, never mutate posted ledger/invoice, full traceability, idempotent retries, tenant isolation, AI grounding) each with a stated enforcement mechanism and verifying test class. | SUB-0019 §3 |
| ExternalMapping | The bidirectional lookup record linking a tenant's internal typed ID to an external system's identifier for one connector/system pair. | SUB-0017 §4 |
| Freshness indicator | A UI/API signal disclosing how current a projection-backed value is; required on every eventually consistent surface so it is never presented as authoritative real-time state. | SUB-0011 §9 ADR-018, SUB-0015 §4 |
| Gateway | A configured payment provider/merchant-account routing target. | SUB-0004 §5.9 |
| Gateway fee | The provider-charged cost of processing a payment, posted as a distinct expense-classified journal entry at settlement. | SUB-0010 §5 |
| Golden dataset/scenario | A committed fixture with known-correct expected output (amount, trace hash) used to catch any unintended drift in pricing/billing/financial calculation. | SUB-0007 §14, SUB-0019 §4 |
| Grounding | The requirement that an AI response or action derive only from retrievable, verifiable system-of-record facts (calculation trace, Revenue Lifecycle Graph); an ungrounded claim is refused, never approximated. | SUB-0016 §1, §4 |
| Idempotency key | A client-supplied identifier ensuring a repeated command produces exactly one business effect. | SUB-0001 FR-020 |
| Invoice | A legal demand for payment; draft is recalculable, posted is immutable. | SUB-0004 §5.8 |
| JournalEntry | One balanced accounting posting line, immutable once posted; corrections use a reversing entry, never an edit. | SUB-0004 §5.12 |
| Maker-checker | A control requiring a second, independent authorized actor to approve a sensitive action; the proposer cannot approve their own request. | SUB-0000 PRIN-08 (control), SUB-0001 BR-008 |
| Meter | Definition of a measurable unit, its dimensions, aggregation function, and correction policy. | SUB-0004 §5.7 |
| Next Best Action | The policy-bounded recommended collections action for an account, carrying reason codes, timing, and channel. | SUB-0009 §4.6 |
| Offer | Market/channel/segment-specific sellable packaging of a Product Version. | SUB-0004 §5.3 |
| Payment | Logical intent/movement to satisfy receivables, provider-neutral and independent of any single provider attempt. | SUB-0004 §5.9 |
| PaymentAttempt | One interaction with one provider/rail for a Payment. | SUB-0004 §5.9 |
| PaymentMethod | A tokenized reference to a subscriber's payment instrument; never stores raw credentials. | SUB-0004 §5.9 |
| Payment Success Engine | The prediction and deterministic-fallback system that recommends retry timing, gateway, and communication timing to maximize payment success. | SUB-0009 §3 |
| Plan | Recurring commercial configuration chosen by a subscriber. | SUB-0004 §5.3 |
| PriceRule | One charge-producing rule (tier, discount, allowance, cap) within a Rate Card. | SUB-0004 §5.4 |
| Product | Stable identity for something offered; mutable definition exists only through Product Versions. | SUB-0004 §5.3 |
| Promise to Pay | A recorded commitment from a subscriber to pay a specific amount by a specific date, tracked within a Collection Case. | SUB-0009 §4.3 |
| Proration | The rule determining how a partial billing period's charge is computed (`NONE`, `ACTUAL_DAYS`, `FULL_PERIOD_ONLY`, `IMMEDIATE_FULL`). | SUB-0007 §10 |
| Rate Card | Effective-dated set of price rules for a Plan. | SUB-0004 §5.4 |
| RatedEvent | Deterministic pricing result for one Usage Event or aggregate. | SUB-0004 §5.7 |
| Reconciliation | The process of matching Invoice, Payment, Settlement, and Journal Entry to confirm consistency and flag discrepancies. | SUB-0006 §9, SUB-0010 §9 |
| ReconciliationMatch | Evidence linking a payment/settlement/journal set as matched. | SUB-0004 §5.12 |
| Refund | A governed return of settled funds, linked to the succeeded Payment/allocation it reverses. | SUB-0004 §5.9 |
| Retry advice | The classification (`NEVER`, `CUSTOMER_ACTION`, `SAFE_AFTER`, `RECONCILE_FIRST`, `POLICY_EVALUATION`) attached to a canonical reason, governing whether/how a payment retry may proceed. | SUB-0009 §2.5 |
| Row-level security (RLS) | Database-enforced tenant isolation requiring `tenant_id` equality on every query for the application role, applied as defense in depth alongside the mandatory application-level filter. | SUB-0011 §9 ADR-013, SUB-0014 §4 |
| Revenue Lifecycle Graph (RLG) | The platform's native, bidirectional traceability projection linking Product through Journal Entry. | SUB-0006 |
| RevenueSchedule | Recognition schedule for a performance obligation (Enterprise scope). | SUB-0004 §5.12 |
| Rule | A reusable, typed, bounded condition/decision expression used by pricing, workflow, or collections policy — never arbitrary executable code. | SUB-0004 §5.13 |
| Settlement | Proof of provider/bank payout, distinct from and never overriding canonical Payment success. | SUB-0004 §5.12 |
| Subscription | Effective-dated agreement to receive an Offer/Plan under captured commercial terms. | SUB-0004 §5.6 |
| SubscriptionItem | One subscribed product/component with quantity and service dates, effective-dated. | SUB-0004 §5.6 |
| TaxRecord | Reproducible evidence of a tax determination applied to a document or line. | SUB-0004 §5.11 |
| Tenant | Security, configuration, and data-isolation boundary for one merchant organization. | SUB-0004 §5.1 |
| UsageEvent | Immutable statement that a measurable event occurred. | SUB-0004 §5.7 |
| Workflow | Event-triggered visual automation definition composed of Trigger → Condition → Action → Wait → Branch → Approval → Integration. | SUB-0004 §5.13 |

## Change log

| Date | Change |
|---|---|
| 2026-09-23 | Initial population from SUB-0000–SUB-0006 (Gate 1). |
| 2026-09-23 | Added pricing, billing, payments, and accounting terms from SUB-0007–SUB-0010 (Gate 2); resolved forward-reference pointers for Calculation trace, Promise to Pay, and Reconciliation now that their owning documents exist. |
| 2026-09-23 | Added architecture, data, security, and AI-governance terms from SUB-0011–SUB-0018 (Gate 3); resolved the Autonomy level forward-reference pointer. |
| 2026-09-23 | Added Financial Correctness Framework and Golden dataset/scenario terms from SUB-0019–SUB-0021 (Gate 4). Glossary is now stable across all 22 numbered documents. |

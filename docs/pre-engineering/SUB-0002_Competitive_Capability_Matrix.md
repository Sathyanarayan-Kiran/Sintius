# SUB-0002 — Competitive Capability Matrix

**Document ID:** SUB-0002
**Title:** Competitive Capability Matrix
**Version:** 0.1 (Draft)
**Status:** Draft
**Owner:** Enterprise Product Manager
**Reviewers:** CPO, Product Marketing, Architecture
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23
**Dependencies:** [SUB-0000](SUB-0000_Product_Manifesto.md), [SUB-0001](SUB-0001_Product_Requirements_Document.md)
**Related Documents:** [SUB-0003 MVP Scope & Release Strategy](SUB-0003_MVP_Scope_Release_Strategy.md)

## 1. Method and caveats

This matrix compares the target platform against nine reference platforms — SAP BRIM, Chargebee, Recurly, Zuora, Stripe Billing, Paddle, Maxio, Oracle Subscription Management, and Salesforce Revenue Cloud — using publicly described product positioning. It is a capability-shaping input, not a procurement scorecard: it does not compare quality, edition, region, price, or implementation effort, and it does not assert an unpublicized capability is absent from a competitor. Sources are the vendors' own product pages and documentation, listed in §4.

## 2. Capability matrix

For each capability: **industry expectation** (what the reference set collectively establishes as normal), **target platform behavior** (what this platform commits to), **parity requirement** (must the platform match the industry baseline to be credible), and **differentiation opportunity** (where the platform intends to exceed the baseline, if anywhere).

| Capability | Industry expectation | Target platform behavior | Parity requirement | Differentiation opportunity |
|---|---|---|---|---|
| Catalog | Versioned product/plan hierarchies with market/segment packaging | Effective-dated, versioned catalog with non-destructive history (SUB-0004, SUB-0007) | Required | None claimed beyond parity |
| Pricing flexibility | Tiered/graduated/usage/hybrid pricing composition | Typed, no-code pricing AST supporting 30+ documented models (SUB-0007) with persisted calculation trace | Required | Deterministic calculation trace + visual simulation before activation |
| Contract management | Negotiated terms, amendments preserving history | Reserved domain concept from MVP; full CPQ/amendment workflow is Release 2/Enterprise (SUB-0003) | Partial at MVP | None claimed until Release 2 |
| Metering | High-volume event ingestion with dedup/correction | Durable, deduplicated, replayable ingestion with explicit disposition (SUB-0007) | Required | None claimed beyond parity |
| Real-time rating | Deterministic, low-latency usage-to-charge conversion | Deterministic, idempotent, explainable rating with persisted trace (SUB-0007) | Required | Trace-grounded explainability, not only speed |
| Billing | Calendar/anniversary schedules, proration, multi-mode billing | Full schedule/proration model with immutable posted invoices (SUB-0008) | Required | None claimed beyond parity |
| Invoicing | Interactive, correctable invoicing with legal documents | Line-level expandable evidence, corrective-document-only correction (SUB-0008) | Required | "Explain this charge" grounded in calculation trace, not generated prose |
| Tax | Provider-neutral or provider-integrated tax determination | Provider-neutral evidence model; native determination is a later release (SUB-0008, SUB-0017) | Partial at MVP | None claimed until tax provider integration matures |
| Payment orchestration | Multi-gateway routing, tokenization, retries | Provider-neutral canonical model; Stripe is the first adapter, multi-gateway routing is Release 2 (SUB-0009) | Partial at MVP | Canonical payment state prevents provider lock-in from day one |
| Dunning | Configurable retry/reminder sequences | Configurable retries plus a Payment & Collections Intelligence summary (SUB-0009) | Required | Preventive, pre-due intervention rather than post-failure-only dunning |
| Collections | Case management, risk scoring, omnichannel contact | Deterministic explainable risk score, Next Best Action, policy-bounded workflow (SUB-0009) | Required | Explainable factor codes and mandatory deterministic fallback, never an opaque score |
| Subscriber experience | Self-service portal: invoices, payment methods, plan changes | Fintech-grade portal with payment inbox, calendar, bill-shock alerts, no-dark-pattern cancellation (SUB-0015) | Required | Financial-impact preview before every self-service change |
| Revenue recognition | Scheduled recognition, deferred revenue | Reserved domain concept from MVP; full recognition engine is Enterprise horizon (SUB-0003, SUB-0010) | Partial at MVP | None claimed until Enterprise horizon |
| Reconciliation | Invoice-payment-settlement-ledger matching | Reserved domain concept; automated reconciliation matures in Release 2/Enterprise (SUB-0010) | Partial at MVP | Revenue Lifecycle Graph surfaces broken chains as first-class findings, not only a reconciliation report |
| AI | Copilots/agents with varying grounding rigor | Grounded copilot and bounded agents with explicit autonomy levels and mandatory audit (SUB-0016) | Required at advisory tier | Explicit, auditable autonomy ceiling — no vendor in the reference set publishes an equivalent autonomy-level framework |
| Analytics | MRR/ARR/cohort/DSO reporting | Defined semantic-layer metrics in MVP; custom report builder and forecasting are later releases (SUB-0003) | Partial at MVP | None claimed until later releases |
| Workflows | Visual trigger/condition/action builders | Visual Workflow Builder over the domain event catalog (SUB-0013, SUB-0015) | Required for target scope | None claimed beyond parity |
| Extensibility | Low-code/serverless extension points | Sandboxed extension framework reserved; MVP scope is API/event/webhook extensibility (SUB-0013) | Partial at MVP | None claimed until extension framework ships |
| Integrations | ERP/CRM/payments/tax connector libraries | Connector architecture defined (SUB-0017); MVP ships Stripe, one tax-evidence adapter, and email | Partial at MVP | None claimed until connector library matures |
| Enterprise controls | RBAC, maker-checker, audit, compliance posture | RBAC/ABAC, maker-checker, immutable audit from MVP (SUB-0014) | Required | Audit and maker-checker apply to AI actions identically to human actions |
| Customization | Custom fields, objects, forms, no-code rules | Reserved from MVP; broad no-code customization matures in Release 2/Enterprise (SUB-0003) | Partial at MVP | None claimed until later releases |
| Developer experience | API docs, SDKs, sandbox, webhook tooling | API-first design with sandbox, webhook tester, and idempotent batch ingestion from MVP (SUB-0013) | Required | None claimed beyond parity |

## 3. Classification

| Classification | Capabilities |
|---|---|
| **Table stakes** (must reach parity to be credible) | Catalog, Metering, Real-time rating, Billing, Invoicing, Dunning, Collections, Subscriber experience, Enterprise controls, Developer experience, Workflows |
| **Strategic differentiators** (platform intends to exceed the baseline) | Pricing flexibility (trace-grounded simulation), Payment orchestration (canonical neutrality), Collections (explainable preventive scoring), Subscriber experience (financial-impact transparency), AI (bounded autonomy framework), Invoicing (trace-grounded explanation) |
| **Intentionally deferred** (partial or absent at MVP by design, per SUB-0003) | Contract management, Tax (native determination), Revenue recognition, Reconciliation (full automation), Analytics (custom builder/forecasting), Extensibility (sandboxed framework), Integrations (broad connector library), Customization (no-code object model) |

## 4. Capability sources

- SAP BRIM: high-volume subscriptions, recurring/one-time charges, usage rating, convergent invoicing, contract accounting. [SAP BRIM Help](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/a03da85e7c96487aac46d431799bebdf/c918bf4f27f44f71888040e6ae3add31.html?locale=en-US)
- Zuora: pricing, billing, payments, collections, revenue recognition suite. [Zuora Billing](https://www.zuora.com/products/billing-software/)
- Chargebee: subscription lifecycle, hybrid/usage billing, receivables, revenue recognition, gateway integrations. [Chargebee Billing](https://www.chargebee.com/billing)
- Recurly: subscription management, usage add-ons, multi-gateway payments, churn/recovery. [Recurly product](https://recurly.com/product/)
- Stripe Billing: subscriptions, usage billing, entitlements, customer portal, recovery, revenue recognition. [Stripe Billing features](https://stripe.com/billing/features)
- Paddle: Merchant-of-Record digital-product billing combining payments, tax, compliance, recovery. [Paddle Billing](https://www.paddle.com/billing)
- Maxio: B2B SaaS CPQ, billing, receivables, revenue recognition, metrics. [Maxio platform](https://www.maxio.com/product/maxio-platform)
- Oracle Subscription Management: fixed/recurring/consumption charges, self-service, invoicing, ERP/revenue-management integration. [Oracle Subscription Management](https://www.oracle.com/cx/sales/subscription-management/)
- Salesforce Revenue Cloud: catalog-to-cash, subscription/usage/hybrid billing, usage grants/rating, CRM-native revenue operations. [Salesforce Revenue Cloud overview](https://www.salesforce.com/sales/revenue-lifecycle-management/revenue-cloud/)

## 5. Validation work still required

- Scenario-based demonstrations (negotiated ramp deal, late usage, credit/rebill, partial payment, gateway outage, explain-my-bill) rather than checkbox comparison.
- Regional invoice/tax/payment validation in intended launch countries (Decision DEC-001, DEC-008 in SUB-0001).
- Interviews with billing operators and subscriber-facing support/finance users before final positioning is locked.

## Decisions Requiring Product Owner Approval

None new; this document informs but does not itself resolve DEC-001/DEC-008 from SUB-0001.

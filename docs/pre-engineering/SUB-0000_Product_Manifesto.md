# SUB-0000 — Product Manifesto & Principles

**Document ID:** SUB-0000
**Title:** Product Manifesto & Principles
**Version:** 0.1 (Draft)
**Status:** Draft
**Owner:** Chief Product Officer
**Reviewers:** Product, Architecture, Finance, Security
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23
**Dependencies:** None (root document)
**Related Documents:** [SUB-0001 Product Requirements Document](SUB-0001_Product_Requirements_Document.md), [SUB-GLOSSARY](SUB-GLOSSARY.md)

## 1. Product mission

Move every legitimate unit of value a business delivers — a subscription, a unit of usage, a negotiated commitment — from commercial agreement to collected cash, correctly, explainably, and without requiring the business to become a billing-systems expert.

## 2. Product vision

Build the operating system for recurring commercial relationships: a platform where businesses configure sophisticated monetization without engineering deployments, where every financial fact is traceable from the offer that created it to the ledger entry that recorded it, and where subscribers always understand what they owe and why.

## 3. Target market

Mid-market and enterprise organizations monetizing recurring or usage-based value across SaaS, API/AI-consumption, digital media, telecom, utilities, financial services, mobility, industrial equipment-as-a-service, and consumer memberships — deployed initially as a focused B2B SaaS wedge (SUB-0003) with an architecture that does not foreclose the broader verticals.

## 4. Core business problems

| Problem | Why existing tooling falls short |
|---|---|
| Commercial truth is fragmented across CRM, spreadsheets, application code, a payment gateway, and accounting software | No single system can answer "why was this customer charged this amount" without reconstructing history from multiple disconnected sources |
| Pricing changes require engineering deployments | Business agility is bottlenecked on release cycles rather than commercial decisions |
| Collections is reactive | Recovery starts only after a payment has already failed, rather than preventing the failure |
| Billing is opaque to subscribers | Support cost and churn rise when customers cannot self-explain their own bill |
| Financial history is mutable in practice | Ad hoc corrections and direct database edits erode auditability and create reconciliation risk |
| AI is either absent or unbounded | Billing systems either ignore AI entirely or risk AI fabricating financial explanations or taking unauthorized action |

## 5. Product principles

These principles are immutable design constraints, not aspirational values. Every downstream document (SUB-0001 onward) must be consistent with all of them; a proposed capability that violates one requires either redesign or an explicit, reviewed exception recorded in the Human Decision Register (§19 of the master prompt).

| ID | Principle | Statement |
|---|---|---|
| PRIN-01 | Prevent before dunning | Payment failure should be predicted and mitigated before it occurs, not only reacted to afterward. |
| PRIN-02 | Explainability over opaque automation | Every financial number and every automated recommendation must be traceable to verifiable facts a human can inspect. |
| PRIN-03 | Configuration over hard-coded behavior | Commercial rules — pricing, discounting, collections policy, workflow — are tenant-configurable data, not application code. |
| PRIN-04 | Financial correctness over convenience | When correctness and convenience conflict, correctness wins; a shortcut that risks a financial invariant is never acceptable regardless of delivery pressure. |
| PRIN-05 | Never mutate financial history silently | A posted invoice, a settled ledger entry, or an activated price version is corrected through an explicit, evidenced, linked correction — never edited in place. |
| PRIN-06 | No AI-generated financial hallucination | An AI system may summarize, explain, or recommend using verified system-of-record facts; it may never invent a financial fact or figure. |
| PRIN-07 | API parity with UI | Every capability exposed in the user interface has an equivalent, permissioned API; the UI is a client of the platform, not a privileged shortcut. |
| PRIN-08 | Event-driven interoperability | Material state changes are published as versioned, immutable facts so internal and external systems can react without polling or reverse-engineering state. |
| PRIN-09 | Subscriber trust | The platform treats the subscriber as a party entitled to clarity and fair treatment, not merely a revenue source to be optimized against. |
| PRIN-10 | Transparent cancellation | Cancellation is never harder to find, understand, or complete than upgrading. |
| PRIN-11 | No dark patterns | The product never manipulates a subscriber into an action against their clear interest through design, friction, or omission. |
| PRIN-12 | Bounded AI autonomy | AI acts only within an explicit, policy-defined autonomy level (SUB-0016); no AI action bypasses authorization, validation, or audit. |
| PRIN-13 | Strong auditability | Every material mutation — human or AI-originated — records who, what, when, where, before/after state, and why. |
| PRIN-14 | Effective-dated commercial configuration | Prices, plans, and contract terms are versioned with explicit effective periods; history is never overwritten by a later change. |
| PRIN-15 | Composable architecture | Every capability is reachable through UI, API, events, rules, workflow, and extension points — never locked behind one interaction surface. |

## 6. Product differentiators

The platform does not compete by matching every checkbox of incumbent suites (SUB-0002). It wins through six integrated, mutually reinforcing advantages:

1. **Revenue Lifecycle Graph** (SUB-0006) — native, bidirectional traceability from product offer to ledger entry, so any financial fact can be explained by tracing its lineage rather than reconstructing it from disparate systems.
2. **Preventive Collections** — a deterministic, explainable risk assessment and Next Best Action engine that intervenes before a due date, not only after a failed charge.
3. **Subscriber Financial Experience** — a self-service, fintech-grade portal where a subscriber can always understand and act on their financial relationship without contacting support.
4. **Monetization Studio** — a visual, simulatable, no-code pricing designer that lets commercial teams launch sophisticated pricing without an engineering deployment.
5. **Autonomous Revenue Operations** — bounded, explainable AI agents (SUB-0016) that detect leakage, assist reconciliation, and recommend collections action within an explicit autonomy policy, never as an unconstrained financial actor.
6. **Composable Platform** — every capability accessible through UI, API, events, rules, workflow, and extension, so the platform can be embedded in and extended by a business's broader operating stack.

## 7. Product anti-goals

The platform explicitly does not aim to be:

| Anti-goal | Clarification |
|---|---|
| Not merely an invoice generator | Invoicing is one stage of a lifecycle the platform manages end-to-end; a product that only produces PDFs has not met the bar. |
| Not an ERP clone | The platform integrates with ERP systems for ledger/GL close; it does not attempt to replace general-ledger accounting or corporate financial consolidation. |
| Not a payments gateway | The platform orchestrates and canonicalizes payment state behind provider-neutral abstractions; it does not become a payment processor or acquire merchant-of-record liability by default. |
| Not a hard-coded SaaS billing tool | The platform is built for industry-neutral commercial primitives from the outset, even though its initial commercial wedge is B2B SaaS (SUB-0003). |
| Not an uncontrolled AI financial agent | AI never acts on financial state outside an explicit, policy-bounded, audited autonomy level (SUB-0016, PRIN-06, PRIN-12). |

## 8. How this document governs the suite

Every subsequent document must be traceable to and consistent with the mission, principles, differentiators, and anti-goals stated here. A downstream document that appears to conflict with a principle in §5 must either be revised or must record the conflict and its resolution explicitly in [SUB-ADR-REGISTER](SUB-ADR-REGISTER.md) or the Human Decision Register maintained in [SUB-0001](SUB-0001_Product_Requirements_Document.md) §13.

## Decisions Requiring Product Owner Approval

None at this stage — this document establishes philosophy, not commercial commitments. Commercial trade-offs begin in SUB-0001/SUB-0003.

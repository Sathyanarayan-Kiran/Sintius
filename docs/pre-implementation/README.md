# Pre-implementation deliverables

This directory is the ordered design record for the AI-native Subscription & Revenue Management Platform. Production implementation must not begin until deliverables 01–25 have been reviewed and the MVP gate in this file is satisfied.

## Source and interpretation

Source: [`AI_Native_Subscription_Revenue_Platform_Master_Product_Specification.md`](../../AI_Native_Subscription_Revenue_Platform_Master_Product_Specification.md)

Review memo: [Master prompt review](00-master-prompt-review.md)

Continuation instructions: [Handover prompt](HANDOVER_PROMPT.md)

A second, independent documentation suite ([`docs/pre-engineering/`](../pre-engineering/SUB-INDEX_Document_Register.md)) also covers this domain. The two are reconciled in [`docs/CANONICAL_SPEC_INDEX.md`](../CANONICAL_SPEC_INDEX.md) — read that before starting implementation. Implementation itself is gated by [`docs/HANDOVER_PROMPT_IMPLEMENTATION.md`](../HANDOVER_PROMPT_IMPLEMENTATION.md).

The source describes an enterprise end-state and a deliberately narrower MVP. To prevent the end-state from overwhelming the first release, these documents use three horizons:

- **MVP:** credible vertical slice for B2B SaaS, including flat recurring, per-seat, tiered usage, one-time charges, Stripe through a provider abstraction, basic dunning, portal, audit, and Payment & Collections Intelligence.
- **Release 2:** contracts, entitlements, advanced rating, multi-currency/entity, payment orchestration, tax abstraction, leakage detection, and ERP integration.
- **Enterprise:** revenue recognition, marketplace settlement, advanced reconciliation/CPQ, bounded AI agents, regional deployment, and enterprise governance.

## Assumptions register

| ID | Assumption | Consequence | Validate by |
|---|---|---|---|
| A-001 | The initial commercial wedge is mid-market B2B SaaS, while the domain remains industry-neutral. | MVP prioritizes account hierarchies, invoice payment terms, seats, usage, and self-service. | Product discovery |
| A-002 | The platform is merchant-of-record neutral; the merchant remains seller of record in MVP. | Tax filing and Merchant of Record liability are external responsibilities. | Legal/finance review |
| A-003 | Stripe is the first connector, behind a provider port. | No Stripe identifiers or states become canonical domain concepts. | Architecture review |
| A-004 | One tenant may operate several brands, but MVP has one legal entity and one reporting currency per tenant. | Legal entity and currency keys exist now; multi-entity operations arrive in Release 2. | Finance review |
| A-005 | PostgreSQL is authoritative for operational and financial records in MVP. | Search, analytics, and cache are projections and cannot finalize financial state. | Architecture review |
| A-006 | Currency values use integer minor units plus ISO 4217 currency; quantities and rates use explicit fixed precision. | No binary floating point in commercial calculations. | Engineering review |
| A-007 | AI is advisory in MVP. Deterministic rules produce bill calculations and collection fallbacks. | AI cannot post, refund, write off, activate pricing, or alter financial truth without policy and approval. | Risk review |
| A-008 | English is the initial operating language; data and template models are localization-ready. | Full localization is not an MVP acceptance criterion. | Go-to-market review |

## Deliverable status

| # | Artifact | Status |
|---:|---|---|
| 01 | [Product Requirements Document](01-product-requirements-document.md) | Draft v0.1 |
| 02 | [Competitive capability matrix](02-competitive-capability-matrix.md) | Draft v0.1 |
| 03 | [Domain model](03-domain-model.md) | Draft v0.1 |
| 04 | [System context diagram](04-system-context.md) | Draft v0.1 |
| 05 | [Logical architecture](05-logical-architecture.md) | Draft v0.1 |
| 06 | [Revenue Lifecycle Graph design](06-revenue-lifecycle-graph.md) | Draft v0.1 |
| 07 | [Data model / ERD](07-data-model-erd.md) | Draft v0.1 |
| 08 | [Subscription state machine](08-subscription-state-machine.md) | Draft v0.1 |
| 09 | [Invoice state machine](09-invoice-state-machine.md) | Draft v0.1 |
| 10 | [Payment state machine](10-payment-state-machine.md) | Draft v0.1 |
| 11 | [Collection state machine](11-collection-state-machine.md) | Draft v0.1 |
| 12 | [Pricing engine specification](12-pricing-engine-specification.md) | Draft v0.1 |
| 13 | [API specification](13-api-specification.md) | Draft v0.1 |
| 14 | [Event taxonomy](14-event-taxonomy.md) | Draft v0.1 |
| 15 | [Security architecture](15-security-architecture.md) | Draft v0.1 |
| 16 | [Multi-tenancy architecture](16-multi-tenancy-architecture.md) | Draft v0.1 |
| 17 | [UX information architecture](17-ux-information-architecture.md) | Draft v0.1 |
| 18 | [Wireframes for primary screens](18-primary-screen-wireframes.md) | Draft v0.1 |
| 19 | [MVP backlog](19-mvp-backlog.md) | Draft v0.1 |
| 20 | [Epic → Feature → User Story → Acceptance Criteria](20-epic-feature-story-acceptance-criteria.md) | Draft v0.1 |
| 21 | [Technical implementation plan](21-technical-implementation-plan.md) | Draft v0.1 |
| 22 | [Repository structure](22-repository-structure.md) | Draft v0.1 |
| 23 | [Coding standards](23-coding-standards.md) | Draft v0.1 |
| 24 | [Testing strategy](24-testing-strategy.md) | Draft v0.1 |
| 25 | [Deployment architecture](25-deployment-architecture.md) | Draft v0.1 |
| 26 | MVP implementation | Blocked by pre-implementation gate |

## MVP implementation gate

Implementation may start when:

1. Artifacts 01–25 are present and internally consistent.
2. Critical invariants have an owner and at least one planned automated control.
3. Subscription, invoice, payment, and collection state machines are approved.
4. Pricing arithmetic, proration, idempotency, tenant isolation, and financial posting decisions are approved.
5. OpenAPI and event schemas cover the vertical slice.
6. Threat model and data classification are reviewed.
7. MVP backlog has acceptance criteria and traceability to PRD requirements.

## Document conventions

- `MUST`, `SHOULD`, and `MAY` have their RFC 2119 meanings.
- Requirement IDs are stable and traceable into APIs, stories, and tests.
- Posted financial facts are immutable; changes use adjustment, reversal, or superseding versions.
- Mermaid diagrams are source-controlled design artifacts and must render in the repository viewer.
- Dates are ISO 8601, timestamps are UTC, currencies are ISO 4217, and country codes are ISO 3166-1 alpha-2.

# Continuation handover prompt

Copy everything below the divider into a new implementation-AI session with access to this workspace.

---

You are continuing the pre-implementation design of an **AI-native Subscription & Revenue Management Platform**. Work in the existing workspace and preserve the established design unless you find a concrete contradiction or financial/control defect.

## Objective

Continue producing the ordered pre-implementation artifacts required by the master product specification. Do **not** begin production application code until deliverables 01–25 are complete, internally consistent, reviewed, and the implementation gate is satisfied.

Your immediate assignment is the next tranche, deliverables **13–18**:

13. API specification
14. Event taxonomy
15. Security architecture
16. Multi-tenancy architecture
17. UX information architecture
18. Wireframes for ten primary screens

After validating that tranche, continue in order with deliverables **19–25**:

19. MVP backlog
20. Epic → Feature → User Story → Acceptance Criteria decomposition
21. Technical implementation plan
22. Repository structure
23. Coding standards
24. Testing strategy
25. Deployment architecture

Stop before deliverable 26, MVP implementation, unless the user explicitly instructs you to begin it and the implementation gate is satisfied.

## Required reading

Read these files completely before creating or editing artifacts:

1. `AI_Native_Subscription_Revenue_Platform_Master_Product_Specification.md`
2. `docs/pre-implementation/README.md`
3. `docs/pre-implementation/00-master-prompt-review.md`
4. `docs/pre-implementation/01-product-requirements-document.md`
5. `docs/pre-implementation/02-competitive-capability-matrix.md`
6. `docs/pre-implementation/03-domain-model.md`
7. `docs/pre-implementation/04-system-context.md`
8. `docs/pre-implementation/05-logical-architecture.md`
9. `docs/pre-implementation/06-revenue-lifecycle-graph.md`
10. `docs/pre-implementation/07-data-model-erd.md`
11. `docs/pre-implementation/08-subscription-state-machine.md`
12. `docs/pre-implementation/09-invoice-state-machine.md`
13. `docs/pre-implementation/10-payment-state-machine.md`
14. `docs/pre-implementation/11-collection-state-machine.md`
15. `docs/pre-implementation/12-pricing-engine-specification.md`

Do not recreate, summarize away, or replace completed artifacts. Extend them and correct them only when a specific inconsistency is documented.

## Current product boundary

The enterprise vision spans B2C, B2B, B2B2C, marketplaces, telecom, utilities, financial services, mobility, industrial, media, and consumer services. The initial commercial and implementation wedge is **mid-market B2B SaaS**, using industry-neutral commercial primitives.

Three delivery horizons are established:

- **MVP:** authentication, tenancy, customer/account, versioned catalog and pricing, subscriptions, basic usage/rating, invoices, receivables subledger, Stripe behind a provider-neutral payment abstraction, basic dunning, subscriber portal, notifications, reporting, audit, and Payment & Collections Intelligence.
- **Release 2:** contracts, entitlements, advanced usage/rating, multi-provider orchestration, leakage detection, multi-currency/entity, tax abstraction, ERP integration, and advanced collection workflows.
- **Enterprise:** revenue recognition, marketplace settlement, advanced reconciliation/CPQ, governed AI agents, regional deployments, configuration promotion, and enterprise governance.

## Established architectural decisions

Treat these as the current design baseline:

1. Start with a **domain-modular application plus independently scalable workers**, not premature microservices.
2. Use **PostgreSQL as the authoritative MVP system of record**.
3. Use a **transactional outbox/inbox** for reliable event delivery and consumer deduplication.
4. Keep workflow state durable and explicit; introduce a Temporal-style platform only when measured complexity warrants it.
5. Use **REST/OpenAPI** for external synchronous APIs and versioned CloudEvents-style facts documented with JSON Schema/AsyncAPI conventions.
6. Use **provider-neutral canonical payment objects** and anti-corruption adapters; Stripe is the first connector, never the domain model.
7. Persist deterministic pricing results and a **typed calculation trace** for every billable result.
8. Use shared SaaS storage in MVP with mandatory tenant keys, application authorization, row-level-security defense in depth, and negative isolation tests. Preserve a dedicated-deployment path.
9. Put AI behind a governed advisory gateway. AI cannot write financial state directly or fabricate calculation facts.
10. Implement the Revenue Lifecycle Graph initially as a **rebuildable relational node/edge projection**, not a required graph database.
11. Use a typed declarative pricing AST with no arbitrary tenant code, high-precision decimal arithmetic, explicit rounding, versioned rules, and non-destructive corrections.
12. Keep lifecycle dimensions separate:
    - subscription service state versus scheduled changes;
    - invoice document state versus receivable and delivery state;
    - logical payment versus provider attempt, allocation, settlement, and refund;
    - collection case state versus stage, action, promise, and dispute state.

## Non-negotiable invariants

- Never double-charge because of retries.
- Never lose an acknowledged usage event.
- Never silently mutate posted invoices, ledger entries, activated price versions, or historical commercial snapshots.
- Corrections use explicit adjustment, credit, reversal, superseding version, or linked correction records.
- Never allow one tenant to read, change, infer, cache, search, or receive another tenant's data.
- Never create a financial effect without stable source identity, idempotency, authorization, audit, and lifecycle lineage.
- Never use binary floating point for commercial calculations.
- Never let external provider state names become canonical domain states.
- Never let search, analytics, graph, cache, or AI projections authorize or post financial state.
- Never generate an invoice explanation from AI memory; use calculation traces and verified Revenue Lifecycle Graph facts.
- Never store raw payment credentials or secrets in normal application storage, logs, traces, events, or audit diffs.
- Never allow an AI action to change customer financial state without policy, authorization, evidence, approval where required, and audit.

## Unresolved decisions

Do not silently invent final answers for these. Make a documented enterprise-grade assumption when necessary, mark it as proposed, and preserve the decision point:

- launch countries, currencies, invoice regulations, tax provider, and seller/merchant-of-record model;
- finance approval of `ACTUAL_DAYS` proration and default `HALF_UP` currency rounding;
- exact runtime choice between TypeScript/Node and Kotlin after pricing/batch/operability spikes;
- MVP usage throughput, burst profile, event retention, dimension cardinality, and late-event window;
- Stripe account model, supported methods, regions, and any connected-account scope;
- service-specific availability, RPO, RTO, and cost targets;
- retention, residency, privacy erasure, audit retention, and support-access requirements;
- collection contact rules, retry limits, risk inputs, fairness review, quiet hours, and approval thresholds.

## Artifact requirements

### 13 — API specification

Create `docs/pre-implementation/13-api-specification.md` and, where useful, machine-readable contracts under `docs/pre-implementation/contracts/openapi/`.

Cover at least:

- customers, accounts, products, plans/rate cards, subscriptions, usage events, invoices, payments, payment methods, credits, notifications, and webhooks;
- authentication and tenant derivation;
- authorization and permission examples;
- versioning and compatibility policy;
- resource/command naming;
- idempotency keys and request-hash conflicts;
- optimistic concurrency;
- correlation/causation IDs;
- pagination, filtering, sorting, field selection, and expansion;
- canonical problem/error model;
- money, quantity, time, date, and enum encoding;
- batch and asynchronous job patterns;
- rate limits and retry guidance;
- signed outbound webhooks and replay;
- examples for the complete MVP vertical slice.

The contract must reflect the established state machines rather than generic CRUD. Financial commands such as invoice finalization, payment attempt, refund, credit, and write-off need explicit action endpoints and permissions.

### 14 — Event taxonomy

Create `docs/pre-implementation/14-event-taxonomy.md` and optional example JSON Schemas under `docs/pre-implementation/contracts/events/`.

Define:

- domain, integration, audit, and projection-event distinctions;
- a versioned CloudEvents-style envelope;
- event identity, tenant, aggregate, schema version, correlation, causation, actor, occurred/recorded time, and data classification;
- naming and compatibility rules;
- ordering scope, delivery semantics, deduplication, replay, retention, dead-letter/quarantine handling, and schema registry governance;
- event catalog covering customer, catalog/pricing, subscription, usage/rating, invoice/receivable, payment/refund, collections, communications, approvals/audit, and integration delivery;
- which events are public webhooks versus internal-only facts;
- sensitive-data restrictions and payload-minimization rules;
- end-to-end event sequence for the MVP vertical slice.

Events are immutable past-tense facts, not remote commands disguised as events.

### 15 — Security architecture

Create `docs/pre-implementation/15-security-architecture.md`.

Include:

- assets, actors, trust zones, entry points, and data-flow threat model;
- data classification and handling rules;
- OIDC/OAuth2, SAML, MFA, service/workload identity, session, token, and API-key design;
- RBAC plus optional ABAC, resource authorization, maker-checker, and separation of duties;
- tenant isolation controls across database, cache, events, search, object storage, exports, observability, support, and AI;
- encryption, key management, secret management, rotation, certificate/signing-key lifecycle;
- payment tokenization and PCI DSS scope minimization;
- webhook ingress/egress security;
- SSRF, injection, XSS, CSRF, broken-object authorization, replay, mass assignment, and supply-chain controls;
- audit integrity and safe logging;
- privacy, retention, deletion/pseudonymization, legal hold, and residency hooks;
- AI threat controls including prompt injection, data exfiltration, tool authorization, grounding, and outcome audit;
- abuse/rate/fraud controls, incident response, vulnerability management, and security testing;
- a threat/risk register with mitigations, owners, and residual-risk decisions.

Do not claim compliance certification. State architectural alignment and evidence required for SOC 2, ISO 27001, PCI DSS scope minimization, GDPR, and relevant regional laws.

### 16 — Multi-tenancy architecture

Create `docs/pre-implementation/16-multi-tenancy-architecture.md`.

Cover:

- tenant identity and trusted context propagation;
- shared application/database model with row-level-security defense in depth;
- tenant-aware keys, constraints, caches, queues, jobs, search, object paths, exports, logs/traces, and rate limits;
- provisioning, suspension, closure, retention, migration, backup/restore, and tenant-scoped export;
- noisy-neighbor controls and quotas;
- encryption/key options and data-residency evolution;
- cross-tenant platform operations and de-identified aggregate analytics;
- time-bound audited support access and break glass;
- configuration inheritance/override rules;
- dedicated enterprise deployment path;
- isolation test matrix and incident containment.

Explicitly show how an untrusted request body can never override the tenant derived from authenticated context.

### 17 — UX information architecture

Create `docs/pre-implementation/17-ux-information-architecture.md`.

Define separate admin and subscriber experiences, including:

- personas, top-level navigation, route map, global search, command palette, object hierarchy, cross-links, breadcrumbs, and deep-link behavior;
- Revenue Dashboard, Customer 360, Subscription Detail, Product Catalog, Pricing Designer, Usage Explorer, Invoice Detail, Payment Detail, Collections Dashboard, Workflow Builder, and Customer Portal;
- permission-aware navigation and redacted states;
- progressive disclosure, keyboard behavior, responsive behavior, loading/empty/error/partial/stale states, destructive-action confirmation, approval states, and accessibility expectations;
- global patterns for status, money, dates/time zones, risk, calculation explanation, audit timeline, RLG traversal, notifications, and help;
- no-dark-pattern cancellation and transparent financial-impact previews.

The UX must feel modern and calm, but financial truth, state, freshness, and irreversible consequences must remain explicit.

### 18 — Wireframes for ten primary screens

Create `docs/pre-implementation/18-primary-screen-wireframes.md` containing low-fidelity text/Mermaid/ASCII wireframes for at least ten primary screens. Include the eleven screens named by the master prompt if practical:

1. Revenue Dashboard
2. Customer 360
3. Subscription Detail
4. Product Catalog
5. Pricing Designer
6. Usage Explorer
7. Invoice Detail
8. Payment Detail
9. Collections Dashboard
10. Workflow Builder
11. Customer Portal

For every screen provide:

- purpose and primary personas;
- information hierarchy;
- components and principal actions;
- default, loading, empty, partial/stale, error, permission-denied, and destructive-action states;
- permissions and approval behavior;
- keyboard and mobile/responsive behavior;
- accessibility notes;
- links into the Revenue Lifecycle Graph and calculation evidence where relevant.

Wireframes should show layout and behavior, not merely list requirements.

### 19–25

When proceeding to the final pre-implementation tranche:

- Keep all backlog items traceable to PRD IDs and critical invariants.
- Use the epic IDs `SUB-001` through `SUB-017` from the master specification.
- Decompose each epic into features, user stories, acceptance criteria, API/data/UX/security/test requirements.
- Make the implementation plan sequential, dependency-aware, and capable of delivering the defined end-to-end vertical slice.
- Define a concrete repository structure that enforces module ownership and generated-contract handling.
- Make coding standards specific to money, time, tenant context, idempotency, events, errors, logs, migrations, and accessibility.
- Make testing cover unit, integration, contract, golden pricing/billing, property-based tests, provider simulation, tenant isolation, load, failover, security, reconciliation, accessibility, backup/restore, and end-to-end acceptance.
- Make deployment architecture distinguish MVP from enterprise evolution and include zones, databases, workers, secrets, observability, backup, disaster recovery, deployment strategy, migrations, and rollback.

## Working method

1. Start by reporting what you found in the existing artifact set and any concrete inconsistencies.
2. Maintain terminology, IDs, state names, horizons, and invariants already established.
3. Create artifacts in numeric order and update `docs/pre-implementation/README.md` from `Planned` to `Draft v0.1` only when each file is substantive.
4. Record every major architecture choice with decision, alternatives, advantages, disadvantages, rationale, and implications.
5. Use Mermaid where a relationship or sequence is materially clearer than prose.
6. Use stable requirement/control IDs when later backlog, tests, or APIs must reference them.
7. Prefer explicit assumptions and open decisions over blocking or silently guessing.
8. Do not add fashionable infrastructure without a measured trigger and operational owner.
9. Do not edit the master prompt. Preserve existing artifacts unless a correction is necessary; document such corrections.
10. Do not create production UI/backend code during this assignment.

## Validation before handoff

Before reporting completion of a tranche:

- verify every expected file exists and is linked in `README.md`;
- verify all local Markdown links resolve;
- verify code/Mermaid fences are balanced;
- search for accidental encoding artifacts and unresolved `TODO`, `TBD`, `FIXME`, or placeholder text;
- check state names and entity terminology against artifacts 03 and 07–12;
- check every financial mutation has idempotency, authorization, audit, correction, and graph-lineage behavior;
- check tenant isolation across all data paths;
- check AI never becomes the source of financial truth;
- list proposed choices still requiring Product, Finance, Legal, Security, or Architecture approval.

## Completion response

At the end of each tranche, report:

- artifacts created and their paths;
- material decisions made;
- validation performed;
- unresolved approvals or conflicts;
- the next ordered tranche.

Begin by reading the required files, then produce deliverables 13–18. Do not restart from product discovery and do not begin MVP implementation.

---


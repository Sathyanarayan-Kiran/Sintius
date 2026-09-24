# Product Requirements Document

**Product:** Subscription & Revenue Operating System  
**Document version:** 0.1  
**Status:** Draft for product, finance, security, and architecture review  
**Scope:** MVP with explicit forward-compatible enterprise boundaries

## 1. Executive summary

The product is a multi-tenant platform that moves a commercial agreement through subscription, usage, billing, invoicing, collection, and audit while preserving end-to-end traceability. Its first release targets mid-market B2B SaaS businesses that need recurring, seat-based, one-time, and usage charges without embedding billing logic in application code.

The MVP differentiator is **Payment & Collections Intelligence**: every account exposes the upcoming amount, payment risk, preferred channel, and a policy-compliant next action. All explanations and financial actions must be grounded in deterministic records. AI may summarize or recommend; it may not invent financial facts or bypass controls.

## 2. Problem statement

Subscription businesses commonly distribute commercial truth across CRM, spreadsheets, product code, a payment gateway, invoices, and accounting software. That fragmentation causes slow pricing changes, unexplainable bills, duplicate or missed charges, poor payment recovery, and weak auditability.

The product must make the following chain observable and controllable:

`Offer → Subscription → Usage → Charge → Invoice → Payment → Settlement → Accounting`

## 3. Goals and outcomes

| ID | Goal | MVP outcome measure |
|---|---|---|
| G-01 | Launch monetization without deployments | A pricing manager configures and activates an approved supported price without code. |
| G-02 | Produce correct, explainable bills | Every invoice line resolves to a price version and originating subscription item or usage aggregate. |
| G-03 | Prevent duplicate financial effects | Repeated commands with the same idempotency key produce one business effect. |
| G-04 | Improve payment success | Operators see risk, reason codes, and next action before and after failure. |
| G-05 | Build subscriber trust | A subscriber can inspect amount, due date, usage basis, and payment state from one portal. |
| G-06 | Preserve enterprise evolution | MVP boundaries permit later contracts, entitlements, orchestration, tax, rev-rec, and multi-entity support without replacing canonical IDs. |

## 4. Non-goals for MVP

- Full CPQ, negotiated contract authoring, or contract amendment workflows.
- ASC 606/IFRS 15 revenue recognition engine.
- Marketplace seller onboarding, split settlement, or commission accounting.
- Real-time multi-gateway optimization; only a connector abstraction and Stripe adapter are required.
- Native tax determination or filing; MVP accepts provider-derived tax results and stores tax evidence.
- Multi-entity consolidation, cross-ledger accounting, or regional data residency deployments.
- Autonomous AI actions that alter money, access, pricing, or posted records.
- Telecom-scale mediation at millions of events per minute; the design must scale horizontally, but MVP load targets are agreed separately.

## 5. Personas and jobs to be done

| Persona | Primary job | MVP-critical workflows |
|---|---|---|
| Billing Administrator | Run accurate billing operations | Preview/finalize invoices, issue adjustments, inspect failures |
| Pricing Manager | Launch controlled offers quickly | Version product/plan/prices, simulate, request activation |
| Collections Agent | Recover cash with appropriate action | Work prioritized queues, contact customer, record outcome |
| Finance Controller | Protect financial integrity | Approve sensitive actions, inspect audit trail, reconcile totals |
| Customer Support | Explain and resolve billing questions | Customer 360, invoice explanation, payment timeline |
| Developer | Integrate product and platform | API keys/OAuth, usage ingestion, webhooks, sandbox |
| Subscriber Admin | Control company subscriptions and payments | View/change plan, seats, invoices, payment methods, pay balance |
| Executive | Understand recurring revenue and risk | Revenue dashboard, payment success, receivables, risk |
| Auditor | Verify who changed what and why | Immutable audit evidence, object lineage, exports |

## 6. MVP journeys

### J-01 Configure and sell

1. Pricing Manager creates a product version, plan, and price components.
2. The platform validates date ranges, currency, billing cadence, and tier completeness.
3. A second authorized user approves activation when maker-checker policy applies.
4. An operator or API creates a customer and subscription against the immutable active version.
5. The system schedules billing and records an auditable commercial snapshot.

### J-02 Meter to invoice

1. A product submits usage with tenant, event, customer, subscription, meter, timestamp, quantity, and dimensions.
2. Ingestion validates schema, ownership, effective subscription, and deduplicates by source/event ID.
3. The rating policy aggregates and prices eligible usage deterministically.
4. Billing creates a draft invoice containing recurring, seat, one-time, and usage lines.
5. An operator or schedule previews and finalizes it; finalization assigns a legal invoice number and freezes line facts.

### J-03 Collect and recover

1. The system forecasts upcoming amount and evaluates deterministic risk signals.
2. It recommends channel and next action under merchant policy.
3. At due time, the payment service creates one logical payment and provider attempt.
4. Provider callbacks are authenticated, deduplicated, ordered, and mapped to canonical states.
5. Failure starts dunning; success allocates cash, closes eligible collection work, and emits events.

### J-04 Explain and self-serve

1. The subscriber opens an invoice in the portal.
2. Each line expands into quantity, time window, allowance, tier/rate, discount, tax, and adjustment facts.
3. “Explain my bill” produces a deterministic comparison; AI may turn those facts into prose.
4. The subscriber pays, changes a tokenized payment method, or starts an allowed subscription change.

## 7. Functional requirements

### Platform, identity, and tenancy

| ID | Requirement | MVP priority |
|---|---|---|
| FR-PLT-001 | The system MUST require a tenant context for every business operation and persistence query. | P0 |
| FR-PLT-002 | The system MUST support human OIDC login, MFA policy hooks, service credentials, RBAC, and scoped permissions. | P0 |
| FR-PLT-003 | The system MUST record actor, action, object, time, source, reason, and before/after references for material mutations. | P0 |
| FR-PLT-004 | Sensitive operations MUST support configurable maker-checker approval. | P0 |
| FR-PLT-005 | APIs MUST accept correlation IDs and idempotency keys where a retry could duplicate a business effect. | P0 |

### Customer and account

| ID | Requirement | MVP priority |
|---|---|---|
| FR-CUS-001 | Users MUST create and manage customers, billing accounts, contacts, addresses, tax evidence, and external references. | P0 |
| FR-CUS-002 | Customer 360 MUST display subscriptions, balance, invoices, payments, risk, communications, and timeline. | P0 |
| FR-CUS-003 | Merge and destructive deletion of financially referenced customers are excluded; records MAY be deactivated or pseudonymized under policy. | P1 |

### Catalog and pricing

| ID | Requirement | MVP priority |
|---|---|---|
| FR-PRC-001 | Catalog objects MUST be versioned and effective-dated; activated versions MUST NOT be edited in place. | P0 |
| FR-PRC-002 | MVP MUST support flat recurring, per-seat, one-time, volume/graduated tiered, and usage pricing, composable within one subscription. | P0 |
| FR-PRC-003 | Calculations MUST use fixed-precision decimal rules, explicit currency rounding, and a persisted calculation trace. | P0 |
| FR-PRC-004 | Users MUST preview sample scenarios before activation and see validation failures. | P0 |
| FR-PRC-005 | Pricing activation MUST enforce permissions and approvals and emit an audit event. | P0 |

### Subscription lifecycle

| ID | Requirement | MVP priority |
|---|---|---|
| FR-SUB-001 | The system MUST create, activate, trial, change quantity, change plan, pause, resume, cancel, renew, and terminate subscriptions subject to policy. | P0 |
| FR-SUB-002 | Every change MUST have requested-at and effective-at timestamps, reason, actor, and immutable history. | P0 |
| FR-SUB-003 | A change MUST evaluate billing and proration impact before commit. | P0 |
| FR-SUB-004 | Subscription state changes MUST be idempotent and publish versioned domain events through an outbox. | P0 |

### Usage and rating

| ID | Requirement | MVP priority |
|---|---|---|
| FR-USG-001 | The API MUST accept single and batch usage events with stable source event IDs. | P0 |
| FR-USG-002 | The platform MUST reject malformed or cross-tenant events, deduplicate repeats, and quarantine unresolved events. | P0 |
| FR-USG-003 | Accepted events MUST be retained and replayable; corrections MUST reference the original rather than overwrite it. | P0 |
| FR-USG-004 | Rating MUST be deterministic, version-aware, explainable, and safe to replay without duplicate charges. | P0 |
| FR-USG-005 | Late-event cutoffs and adjustment behavior MUST be tenant policy, with a clear operator outcome. | P1 |

### Billing and invoices

| ID | Requirement | MVP priority |
|---|---|---|
| FR-INV-001 | Billing MUST support calendar and anniversary schedules, advance/arrears/mixed charges, and deterministic proration. | P0 |
| FR-INV-002 | Draft invoices MUST be previewable and recalculable; posted invoices MUST be immutable. | P0 |
| FR-INV-003 | Corrections to posted invoices MUST use credit note, debit note, void, or reversal policy. | P0 |
| FR-INV-004 | Every line MUST link to its commercial source, calculation trace, service period, tax evidence, and financial postings. | P0 |
| FR-INV-005 | The system MUST render accessible HTML and downloadable PDF invoices; JSON is available by API. | P0 |
| FR-INV-006 | Invoice numbering MUST be unique within tenant/legal-entity/sequence scope and allocated only at finalization. | P0 |

### Payments, receivables, and collections

| ID | Requirement | MVP priority |
|---|---|---|
| FR-PAY-001 | Canonical payment and attempt records MUST be provider-neutral; Stripe is an adapter. | P0 |
| FR-PAY-002 | Provider credentials and raw card data MUST NOT enter application logs or canonical storage; only tokens and non-sensitive descriptors are stored. | P0 |
| FR-PAY-003 | Webhooks MUST be signature-verified, deduplicated, and resilient to out-of-order delivery. | P0 |
| FR-PAY-004 | The subledger MUST support invoice balances, partial/unapplied payments, credits, refunds, and write-offs through balanced immutable entries. | P0 |
| FR-COL-001 | Each account MUST show upcoming amount, payment risk band/reasons, preferred channel, and next best policy-compliant action. | P0 |
| FR-COL-002 | Basic dunning MUST support configurable retries and email notifications with stop conditions. | P0 |
| FR-COL-003 | Recommendations MUST have deterministic fallback rules and MUST NOT use protected sensitive attributes. | P0 |
| FR-COL-004 | Manual contact, promise-to-pay, dispute handoff, and outcome MUST be recorded on a collection timeline. | P1 |

### Portal, notifications, and reporting

| ID | Requirement | MVP priority |
|---|---|---|
| FR-EXP-001 | Portal users MUST view subscriptions, usage, invoices, balance, payments, and tokenized payment methods. | P0 |
| FR-EXP-002 | Policy-allowed upgrades, downgrades, seat changes, pause, resume, and cancellation MUST disclose effective date and financial impact before confirmation. | P0 |
| FR-EXP-003 | Notifications MUST use versioned templates and record send status without storing provider secrets. | P0 |
| FR-ANA-001 | Basic reporting MUST calculate MRR, ARR, active subscriptions, outstanding AR, payment success, collection rate, and recovered revenue from defined semantic rules. | P0 |

## 8. Critical invariants

| ID | Invariant | Required control |
|---|---|---|
| INV-001 | A retried request never creates a second charge or payment. | Idempotency record + unique business constraint + transactional effect |
| INV-002 | An accepted usage event is never lost. | Durable write before acknowledgement + replayable processing state |
| INV-003 | A posted invoice is never edited silently. | State guard + immutable lines + corrective document |
| INV-004 | Ledger history is never rewritten. | Append-only entries + balanced transaction constraint + reversal links |
| INV-005 | One tenant never reads or changes another tenant's data. | Mandatory tenant context + database isolation policy + negative tests |
| INV-006 | A calculation explanation never relies on generated facts. | Persisted calculation trace is sole factual source |
| INV-007 | Activated pricing cannot be changed retroactively by mutation. | Effective-dated versions + activation approval |
| INV-008 | No AI action modifies financial state without policy, authorization, evidence, and audit. | Tool allowlist + approval gate + action log |

## 9. Non-functional requirements

| Area | MVP requirement |
|---|---|
| Availability | Financial write path target 99.9% for MVP; architecture supports multi-zone and an enterprise 99.99% target. |
| API performance | p95 under 500 ms for normal synchronous APIs excluding external providers; long work is asynchronous. |
| UI performance | Common interactions under 2 seconds under agreed reference load. |
| Durability | No acknowledged financial command or accepted usage event lost within documented RPO; backups and restore drills required. |
| Consistency | Strong for finalization, allocation, posting, idempotency, and financially material entitlement state; eventual for search, analytics, and notifications. |
| Accessibility | Admin and portal target WCAG 2.2 AA. |
| Security | TLS in transit, encryption at rest, secret management, least privilege, MFA hooks, rate limiting, audit, OWASP verification. |
| Privacy | Data classification, purpose limitation, retention policies, export, and controlled erasure/pseudonymization. |
| Observability | Structured logs, metrics, traces, correlation ID, tenant-safe diagnostics, and business process health. |
| Recovery | MVP RPO ≤ 5 minutes and RTO ≤ 60 minutes, validated by restore exercise; stricter targets require deployment review. |

## 10. Success metrics

- Billing accuracy: at least 99.99% of finalized invoice lines match approved golden calculations; any monetary defect is severity 1 or 2 by exposure.
- Payment success rate and recovery rate segmented by method and attempt, without misleading retry inflation.
- Duplicate financial effect rate: zero.
- Usage acceptance durability: 100% of acknowledged events queryable or traceable to an explicit terminal disposition.
- Median time to launch an already-supported price model: under one business day after approval.
- Self-service completion rate and support contacts per 1,000 subscribers.
- Unexpected-bill and billing-dispute rates.
- Percentage of invoice and payment records with complete lifecycle lineage: 100%.

## 11. Release acceptance

The MVP is acceptable only when the four primary state machines, price golden datasets, tenant-isolation suite, webhook replay suite, ledger balance checks, accessibility checks, backup restore, and a complete end-to-end scenario all pass:

`create tenant → create customer → activate price → subscribe → ingest usage → preview/finalize invoice → attempt/fail/retry/succeed payment → allocate cash → explain bill → verify audit and lineage`.

## 12. Open decisions

| ID | Decision needed | Owner | Needed before |
|---|---|---|---|
| OD-001 | Initial countries, invoice regulations, currencies, and tax provider | Product + Legal | Invoice schema freeze |
| OD-002 | Numeric precision and rounding policy by currency/model | Finance + Architecture | Pricing specification approval |
| OD-003 | Proration convention and daylight-saving/calendar treatment | Product + Finance | Subscription state machine approval |
| OD-004 | MVP usage throughput and retention SLO | Product + Engineering | Deployment design |
| OD-005 | Stripe regions, methods, and Connect/non-Connect scope | Payments + Legal | Connector implementation |
| OD-006 | Risk inputs, evaluation cadence, and fairness review | Risk + Product | Collections implementation |


# SUB-0021 — MVP Delivery Backlog

**Document ID:** SUB-0021
**Title:** MVP Delivery Backlog
**Version:** 0.1 (Draft)
**Status:** Draft
**Owner:** Technical Program Manager
**Reviewers:** Enterprise Product Manager, Principal Software Architect, QA/Test Architect, all domain architects
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23
**Dependencies:** [SUB-0001](SUB-0001_Product_Requirements_Document.md)–[SUB-0020](SUB-0020_Engineering_Implementation_Blueprint.md)
**Related Documents:** [SUB-TRACEABILITY_MATRIX](SUB-TRACEABILITY_MATRIX.md)

## 1. Purpose and notation

This document converts the documentation suite into engineering-ready work items using the hierarchy **Epic → Feature → User Story → Acceptance Criteria → Technical Tasks → Test Cases**. Every story cites the requirement, entity, state machine, API, event, UI screen, and security control it depends on, so nothing here is disconnected from SUB-0001–SUB-0020 (master prompt §3 traceability principle).

Given the size of a full backlog, this document shows the complete feature breakdown for all 17 epics and at least one fully fleshed representative user story per epic (persona, intent, business value, preconditions, acceptance criteria, API impact, data impact, events, permissions, UI behavior, observability, test scenarios). The same template applies to every remaining story during sprint planning; §14 states this explicitly as the completion method rather than silently implying full enumeration here.

Story ID format: `US-<EPIC>-NN`. Epic IDs are fixed by the master specification: `SUB-E001`–`SUB-E017`.

## 2. SUB-E001 — Platform Foundation

**Goal:** every other epic can rely on trusted tenant context, idempotency, durable event delivery, and audit without re-solving them.

**Features:** F1 Trusted tenant-context propagation; F2 Idempotency-record infrastructure; F3 Transactional outbox + dispatcher; F4 RLS + mandatory application filter + architecture test; F5 Canonical problem/error model.

### US-E001-01 — Idempotent financial commands

- **Persona:** Developer (platform engineer).
- **Intent:** *As a platform engineer, I want every financially material command to require and honor an idempotency key, so that a network retry never creates a duplicate financial effect.*
- **Business value:** directly protects INV-01/INV-06 (SUB-0019 §3) — the platform's most reputationally damaging failure mode is a duplicate charge.
- **Preconditions:** `platform/idempotency` package exists; the target command handler is classified "financially material" per SUB-0011 ADR-016.
- **Acceptance criteria:**
  - Given a prior successful command with key `K`, when the identical request repeats with key `K`, then the original response is returned verbatim and no new effect is created.
  - Given a prior command with key `K`, when a request with key `K` but a different body hash arrives, then the platform returns `409 idempotency_key_reused_with_different_payload`.
- **API impact:** `Idempotency-Key` header required on every endpoint in SUB-0013 §9 classified financially material.
- **Data impact:** `idempotency_record` table (SUB-0012 §1 conventions).
- **Events:** none directly; the protected command's own event still fires exactly once.
- **Permissions:** none beyond the command's own permission requirement.
- **UI behavior:** transparent to the user; a client-generated key is attached by the calling application layer, not manually entered.
- **Observability:** idempotency conflict rate is a dashboarded metric (a rising rate may indicate a client-side retry bug).
- **Technical tasks:** implement `platform/idempotency` read/write helper; wire into the command-handler base class; add architecture-lint rule flagging a financially classified handler missing the check.
- **Test scenarios:** SUB-0019 §2.3 duplicate-request contract test; concurrent-duplicate race test (SUB-0019 §2.12).

## 3. SUB-E002 — Identity & Tenancy

**Goal:** tenants and users are provisioned, authenticated, and authorized under RBAC with maker-checker where policy requires it.

**Features:** F1 Tenant provisioning lifecycle; F2 OIDC/SAML login + MFA; F3 RBAC/ABAC permission catalog; F4 Maker-checker approval workflow; F5 Break-glass support access.

### US-E002-01 — Maker-checker on pricing activation

- **Persona:** Finance Controller.
- **Intent:** *As a Finance Controller, I want pricing activation to require my approval after a Pricing Manager submits it, so that no single actor can expose the tenant to unreviewed pricing.*
- **Business value:** enforces SUB-0000 PRIN-08 and BR-008 — the platform's core financial-control differentiator.
- **Preconditions:** an `ApprovalPolicy` requiring two-party approval on rate-card activation is configured for the tenant (SUB-0007 §11).
- **Acceptance criteria:**
  - Given a Pricing Manager submits a rate card, when they attempt to approve their own request, then the platform rejects it.
  - Given a Finance Controller approves, when the decision is recorded, then activation proceeds atomically with an immutable `ApprovalRequest` record.
- **API impact:** `POST /rate-cards/{id}/submit-approval`, approval decision endpoint (SUB-0013 §9).
- **Data impact:** `ApprovalRequest` record (SUB-0004 §5.1 pattern).
- **Events:** internal approval-decision fact (not public per SUB-0013 §11.1).
- **Permissions:** `pricing:rate_card:activate` (proposer) distinct from the approver role; separation of duties enforced.
- **UI behavior:** Pricing Studio (SUB-0015 §3.5) shows "Pending approval" status; the approve control is never shown to the submitting user for their own submission.
- **Observability:** approval-latency metric (time from submit to decision) for process-health monitoring.
- **Technical tasks:** implement `platform/auth` maker-checker evaluation; wire rate-card activation command through it; UI approval-pending state.
- **Test scenarios:** SUB-0019 §2.15 self-approval rejection test; SUB-0014 §16 AC 4.

## 4. SUB-E003 — Customer Management

**Goal:** customers and billing accounts are the stable commercial parties every downstream object references.

**Features:** F1 Customer/Account CRUD and lifecycle; F2 Customer 360 read model; F3 Deactivation/pseudonymization workflow.

### US-E003-01 — Customer 360 composed view

- **Persona:** Customer Support Agent.
- **Intent:** *As a Customer Support Agent, I want a single Customer 360 view, so that I can answer a billing question without navigating five separate screens.*
- **Business value:** reduces support handling time; supports SUB-0000's "subscriber trust" principle by equipping support to answer questions accurately.
- **Preconditions:** the customer has at least one Account with a Subscription.
- **Acceptance criteria:**
  - Given a customer with active subscriptions, open invoices, and a payment risk assessment, when Customer 360 loads, then identity, MRR/ARR, balance, and risk display in the header and each tab loads independently.
  - Given the Communications tab's data is projection-backed, when it is stale beyond the freshness SLO, then a freshness indicator is shown.
- **API impact:** `GET /customers/{id}`, `GET /accounts/{id}/balance`, `GET /accounts/{id}/collection-summary` (SUB-0013 §9).
- **Data impact:** read-only composition; no new write path.
- **Events:** none (read-only screen).
- **Permissions:** Contracts tab requires contract-visibility permission; omitted entirely without it (SUB-0015 §3.2).
- **UI behavior:** per-tab error boundary — a failure in one tab does not break the others (SUB-0015 §3.2).
- **Observability:** per-tab load-latency metric to catch a slow downstream dependency.
- **Technical tasks:** compose the read model from Customer, Account, Subscription, Invoice, Payment, CollectionCase read paths; implement tab-level error boundaries.
- **Test scenarios:** partial-tab-failure isolation test; permission-based tab-hiding test.

## 5. SUB-E004 — Product Catalog

**Goal:** a versioned, effective-dated commercial catalog that never mutates historical pricing.

**Features:** F1 Product/ProductVersion versioning and publish workflow; F2 Offer/Plan composition; F3 Catalog UI.

### US-E004-01 — Publish a new Product Version without altering history

- **Persona:** Product Manager.
- **Intent:** *As a Product Manager, I want to publish a new Product Version without altering the prior active version, so that existing subscriptions remain correctly priced.*
- **Business value:** protects PRIN-05/PRIN-14 — the platform's non-negotiable "never rewrite commercial history" guarantee.
- **Preconditions:** `ProductVersion v3` is `ACTIVE`.
- **Acceptance criteria:**
  - Given `v3` is `ACTIVE`, when `v4` is published, then `v3` remains unchanged and existing subscription items referencing `v3` are unaffected.
  - Given an attempted publish with an overlapping effective range for the same selection key, when submitted, then the platform rejects it with a specific gap/overlap error.
- **API impact:** `POST /products/{id}/versions`, `POST /product-versions/{id}/publish` (SUB-0013 §9).
- **Data impact:** `product_version` table with exclusion constraint on effective range per selector (SUB-0012 §5).
- **Events:** `product_version.published.v1` (internal).
- **Permissions:** `catalog:product:publish`.
- **UI behavior:** Catalog screen (SUB-0015 §3.4) "Diff" compares two versions field-by-field.
- **Observability:** publish-frequency metric per tenant.
- **Technical tasks:** implement the effective-range overlap database constraint; version-diff UI component.
- **Test scenarios:** effective-range overlap rejection test; existing-subscription-unaffected regression test.

## 6. SUB-E005 — Pricing

**Goal:** deterministic, explainable, no-code pricing composition, simulation, and activation.

**Features:** F1 Typed pricing AST + compiler; F2 MVP charge types (flat, per-seat, one-time, volume/graduated tier, allowance+overage); F3 Proration engine; F4 Calculation trace persistence; F5 Rate-card activation with maker-checker; F6 Simulation; F7 Pricing Studio UI.

### US-E005-01 — Graduated-tier pricing without code

- **Persona:** Pricing Manager.
- **Intent:** *As a Pricing Manager, I want to configure graduated-tier usage pricing without writing code, so that I can launch a new price without an engineering deployment.*
- **Business value:** directly realizes BR-001 and the "Monetization Studio" differentiator (SUB-0000 §6).
- **Preconditions:** a rate card in `DRAFT` state exists.
- **Acceptance criteria:**
  - Given tiers `[0,100]@$10`, `(100,1000]@$8` and chargeable quantity 150, when rated, then the result is `100×$10 + 50×$8 = $1,400.00` exactly (SUB-0007 §14 Golden Example 4).
  - Given the same canonical input and engine version, when rating is replayed, then the result and trace content hash are byte-identical.
- **API impact:** `POST /pricing/validate`, `POST /pricing/simulations`, `POST /rate-cards/{id}/activate` (SUB-0013 §9).
- **Data impact:** `rate_card`, `price_rule` tables (SUB-0012 §4.3).
- **Events:** internal `pricing.rate_evaluated.v1`.
- **Permissions:** `pricing:rate_card:author` (draft/edit) distinct from `pricing:rate_card:activate` (maker-checker gated).
- **UI behavior:** Pricing Studio visual flow (SUB-0015 §3.5) matching SUB-0007 §2's stage order.
- **Observability:** rating-latency metric; determinism-check alert if a replay produces a differing hash.
- **Technical tasks:** implement the typed AST compiler (SUB-0007 §4); graduated-tier formula; calculation-trace persistence.
- **Test scenarios:** SUB-0007 §14 Golden Examples 3–6; property test for tier-slice-sum-equals-chargeable-quantity (SUB-0019 §2.6).

## 7. SUB-E006 — Subscription Lifecycle

**Goal:** every subscription transition is effective-dated, idempotent, auditable, and correctly evaluates billing impact.

**Features:** F1 Canonical state machine (all SUB-0005 §2 transitions); F2 Subscription item lifecycle; F3 Scheduled changes; F4 Preview-change endpoint; F5 Subscription Detail UI.

### US-E006-01 — Scheduled cancellation preserves service until effective date

- **Persona:** Subscriber.
- **Intent:** *As a Subscriber, I want to schedule a cancellation for a future date, so that I keep service until the period I've already paid for ends.*
- **Business value:** realizes FR-EXP-002-equivalent transparency and the no-dark-pattern principle (SUB-0000 PRIN-10/11).
- **Preconditions:** subscription is `ACTIVE`.
- **Acceptance criteria:**
  - Given an `ACTIVE` subscription, when a cancellation is scheduled for a future `effective_at`, then the subscription remains `ACTIVE` with `cancel_at` set until that instant, and the scheduled change is revocable per policy.
  - Given the scheduler claims a due change with an idempotent `change_id`, when it retries after a transient failure, then the change applies exactly once.
- **API impact:** `POST /subscriptions/{id}/cancel` with `effective_at` (SUB-0013 §9).
- **Data impact:** `subscription`, `subscription_item` tables (SUB-0012 §4.4).
- **Events:** `subscription.changed.v1`, `subscription.cancelled.v1` (SUB-0013 §11).
- **Permissions:** portal session scoped to the subscriber's own account (SUB-0014 §2).
- **UI behavior:** Subscriber Portal cancellation flow (SUB-0015 §3.11) — equal prominence to upgrade, effective-date/impact preview before confirmation.
- **Observability:** cancellation-scheduled-vs-executed metric for churn tracking.
- **Technical tasks:** scheduled-change claim logic with idempotent `change_id`; preview-change endpoint.
- **Test scenarios:** SUB-0005 §2 acceptance scenario 3; concurrent scheduler retry test.

## 8. SUB-E007 — Billing

**Goal:** scheduled, restartable billing runs assemble correct draft invoices from eligible charges.

**Features:** F1 Billing schedule (calendar/anniversary, advance/arrears); F2 Billing-run job (async, restartable); F3 Draft invoice assembly and grouping.

### US-E007-01 — Restartable billing run

- **Persona:** Billing Administrator.
- **Intent:** *As a Billing Administrator, I want a billing run to be restartable after a failure, so that a partial run never produces inconsistent invoices.*
- **Business value:** protects INV-04 (SUB-0019 §3) and operational reliability at scale.
- **Preconditions:** a billing run is in progress across multiple accounts.
- **Acceptance criteria:**
  - Given a billing run fails partway through, when it is retried, then already-completed accounts are not reprocessed and control totals reconcile at completion.
- **API impact:** `POST /billing-runs` (async job pattern, SUB-0013 §9).
- **Data impact:** `billing_run` table with checkpoint state.
- **Events:** internal `invoice.generated.v1` per completed account.
- **Permissions:** `billing:run:execute`.
- **UI behavior:** billing-run progress indicator (control totals visible to the operator).
- **Observability:** bill-run progress and control-total dashboards (SUB-0011 §12).
- **Technical tasks:** checkpointed job execution; control-total exposure.
- **Test scenarios:** SUB-0019 §2.13 restart/resume integration test.

## 9. SUB-E008 — Invoicing

**Goal:** invoices are previewable while draft, immutable once posted, and corrected only through governed corrective documents.

**Features:** F1 Invoice document state machine; F2 Finalization transaction; F3 Receivable state machine; F4 Credit note/write-off/void; F5 PDF/HTML/JSON rendering; F6 Invoice Detail UI.

### US-E008-01 — Idempotent, atomic finalization

- **Persona:** Billing Administrator.
- **Intent:** *As a Billing Administrator, I want finalization to be atomic and idempotent, so that two concurrent finalize calls never produce two invoice numbers for the same draft.*
- **Business value:** protects INV-01 and INV-04 — the platform's most critical billing-correctness guarantee.
- **Preconditions:** a draft invoice has passed preview validation with no blockers.
- **Acceptance criteria:**
  - Given two finalize requests with the same idempotency key race concurrently, when both are processed, then exactly one invoice number, receivable, and journal transaction are created.
- **API impact:** `POST /invoices/{id}/finalize` (SUB-0013 §9).
- **Data impact:** `invoice`, `invoice_line`, `journal_entry` (SUB-0012 §4.6, §4.8).
- **Events:** `invoice.finalized.v1` (public, SUB-0013 §11).
- **Permissions:** `billing:invoice:finalize`, maker-checker if above threshold.
- **UI behavior:** Invoice Detail (SUB-0015 §3.7) shows the three independent state badges post-finalization.
- **Observability:** finalization-latency and duplicate-attempt-rate metrics.
- **Technical tasks:** single-transaction finalization procedure; number-allocation locking.
- **Test scenarios:** SUB-0019 §2.12 concurrency test; SUB-0008 §15 AC 1.

## 10. SUB-E009 — Payments

**Goal:** provider-neutral canonical payment state, safe retries, and correct allocation — Stripe is the first and only MVP adapter.

**Features:** F1 Canonical Payment/Attempt state machines; F2 Stripe adapter; F3 Payment method tokenization; F4 Inbound webhook verification/dedup; F5 Allocation engine; F6 Refund lifecycle; F7 Payment Detail UI.

### US-E009-01 — No duplicate charge on ambiguous provider timeout

- **Persona:** Developer (platform engineer).
- **Intent:** *As a platform engineer, I want an ambiguous provider response to never trigger an automatic new attempt, so that a network timeout cannot cause a duplicate charge.*
- **Business value:** protects INV-01 — the single highest-severity payments failure mode.
- **Preconditions:** a payment attempt is submitted to Stripe.
- **Acceptance criteria:**
  - Given a provider call times out after the request may have reached the provider, when the attempt is recorded, then it enters `UNKNOWN` and reconciles via the same provider idempotency reference before any new attempt is permitted.
- **API impact:** `POST /payments`, `POST /payments/{id}/attempts` (SUB-0013 §9).
- **Data impact:** `payment`, `payment_attempt` (SUB-0012 §4.7).
- **Events:** `payment.attempted.v1` (internal), `payment.succeeded.v1`/`payment.failed.v1` (public) once resolved.
- **Permissions:** `payments:payment:create`.
- **UI behavior:** Payment Detail (SUB-0015 §3.8) shows the `UNKNOWN`/reconciliation-required state with both icon and text.
- **Observability:** `UNKNOWN`-state rate and time-to-reconciliation metrics.
- **Technical tasks:** implement the reconciliation loop against the stored provider idempotency reference.
- **Test scenarios:** SUB-0019 §2.8 payment-simulator timeout case; SUB-0009 §8 AC 1.

## 11. SUB-E010 — Subscriber Portal

**Goal:** a fintech-grade self-service experience with transparent financial-impact previews and no dark patterns.

**Features:** F1 Portal auth/session scoped to one account; F2 Portal Home (payment inbox, bill-shock alert); F3 Bills/Explain-my-bill; F4 Self-service changes with impact preview; F5 No-dark-pattern cancellation.

### US-E010-01 — Cancellation as easy as upgrade

- **Persona:** Subscriber.
- **Intent:** *As a Subscriber, I want cancellation to be as easy to find as upgrade, so that I am not manipulated into staying.*
- **Business value:** realizes SUB-0000 PRIN-10/11 directly — a stated product principle, not merely a feature.
- **Preconditions:** subscriber is authenticated in the Portal.
- **Acceptance criteria:**
  - Given I open the Subscriptions screen, when I look for Cancel, then it has equal visual prominence to Upgrade, and confirming shows the exact effective date and financial impact before I commit.
- **API impact:** `POST /subscriptions/{id}/preview-change`, `POST /subscriptions/{id}/cancel` (SUB-0013 §9).
- **Data impact:** none beyond the subscription state change itself.
- **Events:** `subscription.cancellation_scheduled.v1`.
- **Permissions:** portal session scoping (SUB-0014 §2).
- **UI behavior:** SUB-0015 §3.11 — single optional retention offer, unambiguous "No thanks, continue cancelling" path.
- **Observability:** cancellation-flow completion-rate and drop-off metrics (to detect if a future design change inadvertently adds friction).
- **Technical tasks:** impact-preview call before confirmation; UX flow audit against the no-dark-pattern checklist.
- **Test scenarios:** SUB-0015 §6 AC 5 no-dark-pattern UX audit.

## 12. SUB-E011 — Usage & Metering

**Goal:** durable, deduplicated, replayable usage ingestion feeding deterministic rating.

**Features:** F1 Meter definition + ingestion API; F2 Deduplication, validation, quarantine; F3 Aggregation + late-event policy; F4 Rating run; F5 Usage correction; F6 Usage Explorer UI.

### US-E011-01 — Durable acceptance before acknowledgement

- **Persona:** Developer (merchant integration).
- **Intent:** *As a merchant developer, I want a batch of usage events to durably persist before I get an acknowledgement, so that an accepted event is never silently lost.*
- **Business value:** protects INV-02 — a lost usage event is unrecoverable revenue leakage.
- **Preconditions:** a valid API credential scoped to the tenant.
- **Acceptance criteria:**
  - Given a batch of 500 events including one duplicate `source_event_id`, when submitted, then each item's disposition (`ACCEPTED`/`DUPLICATE`/`REJECTED`/`QUARANTINED`) is returned individually and every accepted event is durably queryable.
- **API impact:** `POST /usage-events:batch` (SUB-0013 §9).
- **Data impact:** `usage_event` table, partitioned by event time (SUB-0012 §4.5, §7).
- **Events:** `usage.received.v1` (public, aggregate-level), `usage.rated.v1` (internal, per-event).
- **Permissions:** scoped API credential per tenant.
- **UI behavior:** Usage Explorer (SUB-0015 §3.6) disposition badges.
- **Observability:** accepted/quarantined usage rate dashboard (SUB-0011 §12 business telemetry).
- **Technical tasks:** durable-write-before-ack ingestion path; per-item disposition response.
- **Test scenarios:** SUB-0019 §2.2 dedup integration test; SUB-0011 §6.2 usage ingestion sequence.

## 13. SUB-E012 — Collections

**Goal:** the MVP differentiator — preventive, explainable, policy-bounded collections.

**Features:** F1 Collection case + stage model; F2 Deterministic risk scorecard; F3 Next Best Action engine; F4 Basic dunning; F5 Payment & Collections Intelligence summary (the differentiator); F6 Collections Command Center UI.

### US-E012-01 — Payment & Collections Intelligence summary

- **Persona:** Finance Controller.
- **Intent:** *As a Finance Controller, I want the Payment & Collections Intelligence summary available for every account, so that the platform's core differentiator is verifiable from day one.*
- **Business value:** directly realizes the MVP differentiator named in the master prompt and SUB-0000 §6.
- **Preconditions:** the account has at least one open or upcoming invoice.
- **Acceptance criteria:**
  - Given any account with at least one open or upcoming invoice, when its collection summary is requested, then upcoming amount, risk band, preferred channel, and next best action are returned with reason codes and policy version.
- **API impact:** `GET /accounts/{id}/collection-summary` (SUB-0013 §9).
- **Data impact:** `CollectionCase`, `RiskAssessment` (implicit) read model.
- **Events:** internal only (SUB-0013 §11.1).
- **Permissions:** `collections:read`.
- **UI behavior:** Collections Command Center (SUB-0015 §3.9) and Customer 360 header (SUB-0015 §3.2).
- **Observability:** risk-band distribution and next-action execution-rate metrics.
- **Technical tasks:** deterministic scorecard implementation; Next Best Action ranking with policy revalidation at execution time.
- **Test scenarios:** SUB-0009 §8 AC 6, AC 8 (deterministic-fallback test).

## 14. SUB-E013 — Notifications

**Goal:** versioned templates and tracked delivery without leaking provider secrets.

**Features:** F1 Notification template versioning + email adapter; F2 Delivery status tracking.

### US-E013-01 — Delivery status independent of financial truth

- **Persona:** Billing Administrator.
- **Intent:** *As a Billing Administrator, I want to know whether a due-date reminder was actually delivered, so that I can escalate manually if it failed.*
- **Business value:** prevents a false assumption that a customer was reminded when they were not, which would otherwise mask a preventable delinquency.
- **Preconditions:** a notification has been queued for delivery.
- **Acceptance criteria:**
  - Given a notification is queued, when the provider reports failure, then the notification's status is `FAILED` with a safe reason, distinct from invoice/payment truth.
- **API impact:** internal delivery-status query (not a primary public endpoint at MVP).
- **Data impact:** `Communication` record (SUB-0004 §5.10).
- **Events:** internal delivery-status facts only.
- **Permissions:** `communications:read`.
- **UI behavior:** delivery status shown in Collections Command Center action history (SUB-0015 §3.9).
- **Observability:** delivery success/failure rate by channel.
- **Technical tasks:** email adapter with delivery-receipt handling.
- **Test scenarios:** delivery-failure-does-not-affect-invoice-state test.

## 15. SUB-E014 — Analytics

**Goal:** MVP-scope basic reporting with defined semantic rules — no custom report builder yet.

**Features:** F1 Basic reporting semantic layer; F2 Revenue Command Center UI.

### US-E014-01 — One defined MRR calculation

- **Persona:** Executive.
- **Intent:** *As an Executive, I want MRR/ARR computed from one defined semantic rule, so that Finance and Product never argue about whose number is right.*
- **Business value:** prevents costly internal disputes over metric definitions and builds trust in the Revenue Command Center.
- **Preconditions:** active subscriptions with recurring components exist.
- **Acceptance criteria:**
  - Given active subscriptions with recurring components, when MRR is computed, then the calculation uses the single version-controlled semantic definition and matches the Revenue Command Center display exactly.
- **API impact:** internal reporting query surface.
- **Data impact:** read replica / semantic layer (SUB-0011 ADR-015).
- **Events:** none (read-only).
- **Permissions:** `analytics:read`.
- **UI behavior:** Revenue Command Center (SUB-0015 §3.1) KPI cards.
- **Observability:** metric-computation-latency and staleness indicators.
- **Technical tasks:** define and version the MRR/ARR semantic rule once, shared by every consumer.
- **Test scenarios:** metric-definition regression test against a fixed dataset.

## 16. SUB-E015 — AI Revenue Intelligence

**Goal:** grounded, bounded AI assistance — no autonomous financial action, no fabricated explanation.

**Features:** F1 AI gateway (allowlist, grounding, redaction, audit); F2 Grounded "Explain my bill"; F3 Customer 360 Revenue Copilot panel.

### US-E015-01 — Grounded bill explanation

- **Persona:** Subscriber.
- **Intent:** *As a Subscriber, I want "Explain my bill" to use only verified facts, so that I can trust the explanation even though it reads like prose.*
- **Business value:** realizes the "explainable billing" differentiator and PRIN-06 (no AI-generated financial hallucination).
- **Preconditions:** the invoice has a persisted calculation trace.
- **Acceptance criteria:**
  - Given a bill increase driven by 460 additional API requests and 2 added seats, when "Explain my bill" is invoked, then the response cites exact figures from the calculation trace/RLG and never states a fact not present in those sources; if a trace is missing, the response explicitly says so instead of inventing an explanation.
- **API impact:** AI gateway invocation behind the Bills/Invoice Detail screens (no separate public financial-mutation endpoint).
- **Data impact:** read-only against `CalculationTrace` and RLG projections.
- **Events:** AI interaction evidence (internal audit only).
- **Permissions:** scoped to the requesting user's own authorized data (SUB-0014 §4).
- **UI behavior:** shared "Explain" component (SUB-0015 §5) used identically in Invoice Detail and Portal Bills.
- **Observability:** grounding-failure rate (how often the agent must refuse due to insufficient evidence).
- **Technical tasks:** AI gateway grounding-retrieval pipeline scoped to tenant/account; refusal path for insufficient evidence.
- **Test scenarios:** SUB-0016 §7 AC 3 grounding-fabrication test case.

## 17. SUB-E016 — Integrations

**Goal:** connector primitives and outbound webhooks — not the full enterprise integration marketplace.

**Features:** F1 Connector/ExternalMapping/WebhookEndpoint primitives; F2 Outbound signed webhook delivery + replay; F3 Tax-evidence adapter.

### US-E016-01 — Webhook replay after merchant-side outage

- **Persona:** Developer (merchant integration).
- **Intent:** *As a merchant developer, I want to replay a missed webhook delivery, so that an outage on my side doesn't cause permanent data loss.*
- **Business value:** protects merchant integrations from data loss without requiring the platform to over-retry indefinitely.
- **Preconditions:** a delivery failed and is past retry exhaustion.
- **Acceptance criteria:**
  - Given a delivery failed and is past retry exhaustion, when I call the replay endpoint, then the exact original event envelope is redelivered under a new delivery ID.
- **API impact:** `POST /webhook-endpoints/{id}/deliveries/{delivery_id}/replay` (SUB-0013 §10).
- **Data impact:** `WebhookEndpoint`, delivery log records.
- **Events:** the replayed event's original envelope, unchanged.
- **Permissions:** `integrations:webhook:replay`.
- **UI behavior:** Developer Console delivery log with a replay control.
- **Observability:** replay-rate and dead-letter-queue depth metrics.
- **Technical tasks:** delivery-log persistence; replay endpoint reusing the persisted envelope verbatim.
- **Test scenarios:** signature/replay contract test (SUB-0013 §10).

## 18. SUB-E017 — Audit & Compliance

**Goal:** every material mutation and AI action is auditable, and isolation is continuously verified.

**Features:** F1 Append-only AuditEvent write path; F2 Audit timeline UI component; F3 Tenant-isolation negative test suite; F4 Audit export API.

### US-E017-01 — Audit record for every financial mutation

- **Persona:** Auditor.
- **Intent:** *As an Auditor, I want every financial mutation to have a corresponding audit record with before/after evidence, so that I can reconstruct what happened without trusting a human's memory.*
- **Business value:** realizes BR-014 and is the foundation every other control (maker-checker, AI governance) depends on for verifiability.
- **Preconditions:** none — this applies to every financially material mutation platform-wide.
- **Acceptance criteria:**
  - Given any invoice/payment/subscription/pricing mutation commits, when I query the audit trail for that object, then actor, action, reason, correlation ID, and safe before/after references are present.
- **API impact:** audit export API (permissioned, logged; SUB-0014 §11).
- **Data impact:** `audit_event` table, `INSERT`-only application role privilege (SUB-0012 §4.9).
- **Events:** none directly (the audit record itself is the artifact, not a separate broadcast fact).
- **Permissions:** `audit:read`.
- **UI behavior:** shared Audit Timeline component (SUB-0015 §5) reused across Customer 360, Subscription Detail, Invoice Detail.
- **Observability:** audit-write failure alert (a domain mutation without its audit record is a top-severity incident).
- **Technical tasks:** same-transaction audit write for every command handler; `INSERT`-only database privilege enforcement.
- **Test scenarios:** SUB-0019 §2.2 audit-completeness integration test.

## 19. Backlog completion method

Every remaining feature listed under each epic (§2–§18) is decomposed into its own user stories using the identical 12-field template (persona, intent, business value, preconditions, acceptance criteria, API impact, data impact, events, permissions, UI behavior, observability, technical tasks, test scenarios) during sprint planning, before that feature enters a sprint. A feature is not "backlog-ready" until this decomposition exists — this is the concrete meaning of "engineering-ready work items" (master prompt §21).

## 20. Epic-to-requirement traceability summary

| Epic | Primary BR/FR | Primary domain entities | Primary state machine |
|---|---|---|---|
| SUB-E001 Platform Foundation | BR-002, BR-010, BR-011 | IdempotencyRecord, OutboxEvent | — |
| SUB-E002 Identity & Tenancy | BR-004, BR-008 | Tenant, User, Role, ApprovalRequest | Tenant |
| SUB-E003 Customer Management | FR-CUS (SUB-0001 capability list) | Customer, Account | — |
| SUB-E004 Product Catalog | BR-012 | Product, ProductVersion, Offer, Plan | — |
| SUB-E005 Pricing | BR-001 | RateCard, PriceRule | — |
| SUB-E006 Subscription Lifecycle | BR-007 (partial) | Subscription, SubscriptionItem | Subscription |
| SUB-E007 Billing | BR-003 (partial) | Charge, RatedEvent | — |
| SUB-E008 Invoicing | BR-003, BR-005 | Invoice, InvoiceLine, CreditNote | Invoice, Credit Note |
| SUB-E009 Payments | BR-002 (partial) | Payment, PaymentAttempt, Refund | Payment, Payment Attempt, Refund |
| SUB-E010 Subscriber Portal | BR-007 | Subscription, Invoice, PaymentMethod | — |
| SUB-E011 Usage & Metering | BR-002 (partial) | UsageEvent, RatedEvent | — |
| SUB-E012 Collections | BR-006 | CollectionCase | Collection Case |
| SUB-E013 Notifications | — (supporting) | Communication | — |
| SUB-E014 Analytics | — (supporting) | — (read model) | — |
| SUB-E015 AI Revenue Intelligence | BR-009 | AuditEvent (AI fields) | — |
| SUB-E016 Integrations | — (supporting) | Connector, ExternalMapping, WebhookEndpoint | — |
| SUB-E017 Audit & Compliance | BR-014 | AuditEvent | — |

## 21. Acceptance criteria

1. Every epic (`SUB-E001`–`SUB-E017`) has a stated goal and feature list.
2. Every representative story includes all 12 required fields (persona, intent, business value, preconditions, acceptance criteria, API impact, data impact, events, permissions, UI behavior, observability, technical tasks, test scenarios).
3. Every story's acceptance criteria are stated in Given/When/Then form and reference only vocabulary already fixed in SUB-0004/SUB-0005.
4. Every story cites at least one governing document section for its API, data, event, and security claims — no unsourced assertion.
5. The epic-to-requirement traceability summary (§20) leaves no epic without at least one BR/FR or domain-entity linkage.
6. No story here contradicts a Release-2/Enterprise-deferred scope boundary set in SUB-0003 §2.

## Decisions Requiring Product Owner Approval

None new; this document converts already-approved scope (SUB-0001–SUB-0018) into work items and does not itself make a new commercial or architectural trade-off.

---

## Gate 4 completion statement

With SUB-0019, SUB-0020, and this document (SUB-0021) drafted, all 22 numbered documents plus the four companion registers exist at Draft v0.1. Per the master prompt §20 completion criteria and §17 Gate 4 questions:

- **Can teams test financial correctness?** Yes — SUB-0019 defines the full test taxonomy and the eight-invariant Financial Correctness Framework with an enforcement mechanism and verifying test class for each.
- **Is the repo/architecture clear?** Yes — SUB-0011 (architecture, all 11 mandatory ADRs) and SUB-0020 (repository structure, module boundaries, coding standards, CI/CD) are both drafted.
- **Is the backlog implementation-ready?** The template and epic/feature structure are complete; full story-level decomposition per §19's completion method remains a sprint-planning activity, consistent with the master prompt's own instruction not to treat backlog conversion as a one-time act frozen before any team engagement.

**Engineering implementation (master prompt document 22, MVP implementation) remains gated** on human review advancing every document from Draft (v0.1) to Approved Baseline (v1.0) per §16 of the master prompt, and on resolution of the highest-priority entries in the Human Decision Register (SUB-0001 §19, currently DEC-001 through DEC-045) — particularly DEC-001 (launch countries/currencies/tax), DEC-002/DEC-013 (rounding/proration finance sign-off), DEC-005/DEC-034 (AI autonomy thresholds), and DEC-044 (backend runtime selection). This document does not declare those resolved; it surfaces them for Product Owner decision as the master prompt requires.

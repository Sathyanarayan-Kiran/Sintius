# Epic → Feature → User Story → Acceptance Criteria decomposition

**Version:** 0.1
**Status:** Proposed MVP decomposition
**Related:** [MVP backlog](19-mvp-backlog.md), [Product Requirements Document](01-product-requirements-document.md), master specification §102

## 1. Purpose and notation

This document decomposes the seventeen master-specification epics (`SUB-001`–`SUB-017`) into Features and representative User Stories with Given/When/Then acceptance criteria, for the MVP-horizon backlog items fixed in deliverable 19. It does not re-litigate scope — every feature here maps to one or more backlog IDs (`BL-*`) from deliverable 19 §4, and every story cites the requirement/invariant/state-machine section it must satisfy rather than restating that section's content.

- **Feature ID:** `FEAT-<EPIC>-NN`
- **Story ID:** `US-<EPIC>-NN`
- **Story form:** *As a `<persona>`, I want `<capability>`, so that `<outcome>`.*
- **AC form:** *Given `<precondition>`, when `<action>`, then `<result>`.*
- Each feature lists **Requirements** — the API (deliverable 13), Data (deliverable 07), UX (deliverable 17/18), Security (deliverable 15/16), and Test (deliverable 24) references that govern it — as citations, not restatements.
- Personas are exactly those named in PRD §5 and master prompt §61; no new persona is introduced.
- Stories shown are representative of each feature's acceptance bar, not an exhaustive enumeration of every backlog item's stories; full coverage is achieved by applying the same pattern to every `BL-*` item during sprint planning.

## 2. `SUB-001` Platform Foundation

**Goal:** every other epic can rely on trusted tenant context, idempotency, durable event delivery, and tenant isolation without re-solving them.

### FEAT-SUB001-01 Trusted tenant context and idempotency

Covers `BL-001-01`, `BL-001-02`.

**US-SUB001-01** — *As a platform engineer, I want tenant identity resolved only from authenticated context, so that no request body field can assert or override a tenant.*

- Given a request with a valid credential for tenant A and a body containing `tenant_id` for tenant B, when the request is processed, then the platform rejects it with `403 tenant_mismatch` (deliverable 13 §3) and no domain transaction begins.
- Given a request without any body `tenant_id`, when processed, then the trusted tenant from the credential is used throughout the transaction, cache keys, and emitted events (deliverable 16 §1).

**US-SUB001-02** — *As an API caller, I want a repeated request with the same idempotency key to produce one financial effect, so that network retries cannot duplicate a charge.*

- Given a prior successful `POST` with `Idempotency-Key: K`, when the identical request is repeated with the same key and body, then the original response is returned verbatim and no new effect is created (deliverable 13 §8, INV-001).
- Given a prior request with key `K`, when a request with the same key but a different body hash arrives, then the platform returns `409 idempotency_key_reused_with_different_payload`.

**Requirements:** API — deliverable 13 §3, §8; Data — deliverable 07 `IdempotencyRecord`; Security — deliverable 15 §4.1; Test — idempotency contract test suite (deliverable 24 §4).

### FEAT-SUB001-02 Transactional outbox and RLS enforcement

Covers `BL-001-03`, `BL-001-04`, `BL-001-05`.

**US-SUB001-03** — *As a downstream consumer, I want every committed domain change to reliably produce its event, so that billing/notification workers never miss a fact.*

- Given a domain transaction commits, when the transaction completes, then an outbox record exists in the same transaction and is eventually dispatched at least once (ADR-LA-003).
- Given a dispatcher failure after commit, when the dispatcher recovers, then undelivered outbox records are redelivered and consumers deduplicate by event ID (deliverable 14 §5).

**US-SUB001-04** — *As a security reviewer, I want cross-tenant queries to fail even if application code has a bug, so that isolation does not depend on one layer alone.*

- Given RLS is enabled on a tenant-owned table and the application-layer filter is bypassed in a test harness, when a query for tenant B's row runs under tenant A's session context, then zero rows are returned (deliverable 16 §2, ADR-MT-001).

**Requirements:** API — deliverable 13 §11 (problem model); Data — deliverable 07 §8; Security — deliverable 15 §6, deliverable 16 §2; Test — isolation matrix (deliverable 16 §11.1).

## 3. `SUB-002` Identity & Tenant Management

**Goal:** tenants and users are provisioned, authenticated, and authorized under RBAC with maker-checker where policy requires it.

### FEAT-SUB002-01 Tenant provisioning and lifecycle

Covers `BL-002-01`.

**US-SUB002-01** — *As a platform operator, I want a tenant provisioned in one atomic step, so that a partially configured tenant is never externally reachable.*

- Given a provisioning request with valid legal-entity and admin-user data, when provisioning completes, then `Tenant`, default roles, and the initial admin `UserMembership` exist together or the whole operation rolls back (deliverable 16 §4.2).
- Given an `ACTIVE` tenant, when it is suspended, then scheduled billing/dunning jobs pause and existing data is untouched (deliverable 16 §4.1).

**Requirements:** API — deliverable 13 (tenant admin endpoints, out of public OpenAPI scope, internal-only); Data — deliverable 07 `Tenant`; UX — n/a (internal ops); Security — deliverable 15 §4; Test — tenant lifecycle scenario test.

### FEAT-SUB002-02 Authentication, RBAC, and maker-checker

Covers `BL-002-02`, `BL-002-03`, `BL-002-04`.

**US-SUB002-02** — *As a Finance Controller, I want pricing activation to require a second authorized approver, so that no single actor can expose the tenant to unreviewed pricing.*

- Given a Pricing Manager submits a rate card for activation, when they attempt to approve their own request, then the platform rejects it (separation of duties, deliverable 15 §5.4).
- Given a Finance Controller approves, when the decision is recorded, then activation proceeds atomically with an immutable `ApprovalRequest` record (deliverable 12 §18).

**Requirements:** API — deliverable 13 §4; Data — deliverable 07 `Role`, `UserMembership`, `ApprovalRequest`; Security — deliverable 15 §5; Test — maker-checker self-approval rejection test (deliverable 15 §15 AC 4).

## 4. `SUB-003` Customer Management

**Goal:** customers and billing accounts are the stable commercial parties every downstream object references.

### FEAT-SUB003-01 Customer and account management

Covers `BL-003-01`, `BL-003-02`.

**US-SUB003-01** — *As a Billing Administrator, I want to create a customer and billing account, so that I can attach subscriptions and invoices to it.*

- Given valid customer and account input (currency, terms), when created, then the account is `ACTIVE` and owns no subscriptions yet (deliverable 03 §"Customer and Account").

**US-SUB003-02** — *As Customer Support, I want a single Customer 360 view, so that I can answer a billing question without navigating five screens.*

- Given a customer with active subscriptions, open invoices, and a payment risk assessment, when Customer 360 loads, then identity, MRR/ARR, balance, and risk display in the header and each tab loads independently (deliverable 18 §2).
- Given the Communications tab's data is projection-backed, when it is stale beyond the freshness SLO, then a freshness indicator is shown (deliverable 17 §10).

**Requirements:** API — deliverable 13 §16.1; Data — deliverable 07 `Customer`, `Account`; UX — deliverable 17 §5.2, deliverable 18 §2; Security — deliverable 15 §5.3 (BOLA); Test — Customer 360 composition test with partial-tab-failure isolation.

## 5. `SUB-004` Product Catalog

**Goal:** a versioned, effective-dated commercial catalog that never mutates historical pricing.

### FEAT-SUB004-01 Product versioning and publication

Covers `BL-004-01`, `BL-004-02`, `BL-004-03`.

**US-SUB004-01** — *As a Product Manager, I want to publish a new Product Version without altering the prior active version, so that existing subscriptions remain correctly priced.*

- Given `ProductVersion v3` is `ACTIVE`, when `v4` is published, then `v3` remains unchanged and existing subscription items referencing `v3` are unaffected (deliverable 03 §"Product, Offer, Plan, and Rate Card").
- Given an attempted publish with an overlapping effective range for the same selection key, when submitted, then the platform rejects it with a specific gap/overlap error (deliverable 03 invariants).

**Requirements:** API — deliverable 13 §16.2; Data — deliverable 07 `ProductVersion`, `Offer`, `Plan`; UX — deliverable 18 §4; Test — effective-range overlap rejection test.

## 6. `SUB-005` Pricing Engine

**Goal:** deterministic, explainable, no-code pricing composition, simulation, and activation.

### FEAT-SUB005-01 Charge types, proration, and calculation trace

Covers `BL-005-01`–`BL-005-05`, `BL-005-09`.

**US-SUB005-01** — *As a Pricing Manager, I want to configure graduated-tier usage pricing without writing code, so that I can launch a new price without an engineering deployment.*

- Given tiers `[0,100]@₹10`, `(100,1000]@₹8` and chargeable quantity 150, when rated, then the result is `100×₹10 + 50×₹8 = ₹1,400.00` exactly (deliverable 12 §8 example, golden dataset).

**US-SUB005-02** — *As a Finance Controller, I want every billable amount to carry a persisted calculation trace, so that "why this amount" never depends on regenerating an explanation.*

- Given a charge is rated, when the result is persisted, then a `CalculationTrace` with engine/schema version and full operation tree is stored and linked (ADR-PRC-002).
- Given the same canonical input and engine version, when rating is replayed, then the result and trace content hash are byte-identical (deliverable 12 §16, §24 AC 2).

**Requirements:** API — deliverable 13 §16.2 (`/pricing/*`, `/calculation-traces/{id}`); Data — deliverable 07 `RateCard`, `PriceComponent`, `CalculationTrace`; Security — deliverable 12 §21; Test — golden dataset + property tests (deliverable 12 §23).

### FEAT-SUB005-02 Activation workflow and simulation

Covers `BL-005-06`, `BL-005-07`, `BL-005-08`.

**US-SUB005-03** — *As a Pricing Manager, I want to simulate a candidate rate card against a historical cohort before activation, so that I can see revenue and bill-shock impact.*

- Given a candidate rate card and a baseline version, when simulation runs, then revenue delta, ARPU change, winners/losers, and bill-shock threshold counts are returned without mutating any production subscription, invoice, or charge (deliverable 12 §17).

**Requirements:** API — deliverable 13 §16.2 `/pricing/simulations`; UX — deliverable 18 §5; Security — deliverable 12 §21 (separate simulate-with-production-data permission); Test — simulation non-mutation test.

## 7. `SUB-006` Subscription Lifecycle

**Goal:** every subscription transition is effective-dated, idempotent, auditable, and correctly evaluates billing impact.

### FEAT-SUB006-01 Canonical lifecycle and scheduled changes

Covers `BL-006-01`–`BL-006-04`.

**US-SUB006-01** — *As a Subscriber Admin, I want to schedule a cancellation for a future date, so that I keep service until the period I've already paid for ends.*

- Given an `ACTIVE` subscription, when a cancellation is scheduled for a future `effective_at`, then the subscription remains `ACTIVE` with `cancel_at` set until that instant, and the scheduled change is revocable per policy (deliverable 08 §3).
- Given the scheduler claims a due change with an idempotent `change_id`, when it retries after a transient failure, then the change applies exactly once (deliverable 08 §10, deliverable 08 §12 AC 1).

**US-SUB006-02** — *As a Billing Administrator, I want a mid-cycle seat increase to produce a disclosed proration amount before I confirm it, so that the customer is never surprised.*

- Given an `ACTIVE` subscription with 100 seats, when quantity is increased to 142 mid-period, then `preview-change` returns a deterministic proration trace, and only on explicit confirm does the new item interval and charge commit (deliverable 08 §12 AC 2).

**Requirements:** API — deliverable 13 §16.3; Data — deliverable 07 `Subscription`, `SubscriptionItem`, `SubscriptionChange`; UX — deliverable 18 §3; Test — concurrent stale-version rejection test (deliverable 08 §12 AC 7).

## 8. `SUB-007` Billing Engine

**Goal:** scheduled, restartable billing runs assemble correct draft invoices from eligible charges.

### FEAT-SUB007-01 Billing schedule and run

Covers `BL-007-01`–`BL-007-03`.

**US-SUB007-01** — *As a Billing Administrator, I want a billing run to be restartable after a failure, so that a partial run never produces inconsistent invoices.*

- Given a billing run fails partway through, when it is retried, then already-completed accounts are not reprocessed and control totals reconcile at completion (deliverable 05 §9, deliverable 13 §13.2 job pattern).

**Requirements:** API — deliverable 13 §16.5 `/billing-runs`; Data — deliverable 07 `BillingRun`; Test — restart/resume integration test.

## 9. `SUB-008` Invoice Management

**Goal:** invoices are previewable while draft, immutable once posted, and corrected only through governed corrective documents.

### FEAT-SUB008-01 Finalization and immutability

Covers `BL-008-01`–`BL-008-05`.

**US-SUB008-01** — *As a Billing Administrator, I want finalization to be atomic and idempotent, so that two concurrent finalize calls never produce two invoice numbers for the same draft.*

- Given two finalize requests with the same idempotency key race concurrently, when both are processed, then exactly one invoice number, receivable, and journal transaction are created (deliverable 09 §13 AC 1, INV-003/INV-004).

**US-SUB008-02** — *As a Finance Controller, I want to correct a posted invoice only through a credit note, so that the original legal document is never altered.*

- Given a `POSTED` invoice with an error, when a credit note is issued, then the original invoice's lines and totals remain unchanged and the credit note links to it via `CORRECTS` (deliverable 09 §8, deliverable 06 §5).

**Requirements:** API — deliverable 13 §16.5; Data — deliverable 07 `Invoice`, `CreditNote`, `JournalTransaction`; UX — deliverable 18 §7; Test — finalize-race idempotency test, golden total-reconciliation test (deliverable 09 §13 AC 10).

## 10. `SUB-009` Payments

**Goal:** provider-neutral canonical payment state, safe retries, and correct allocation — Stripe is the first and only MVP adapter.

### FEAT-SUB009-01 Canonical payment lifecycle and Stripe adapter

Covers `BL-009-01`–`BL-009-04`.

**US-SUB009-01** — *As a platform engineer, I want an ambiguous provider response to never trigger an automatic new attempt, so that a network timeout cannot cause a duplicate charge.*

- Given a provider call times out after the request may have reached the provider, when the attempt is recorded, then it enters `UNKNOWN` and reconciles via the same provider idempotency reference before any new attempt is permitted (deliverable 10 §13 AC 1).

**US-SUB009-02** — *As a platform engineer, I want a webhook with a mismatched amount to never mark a payment succeeded, so that a forged or corrupted event cannot fabricate cash receipt.*

- Given a webhook claims success for attempt X with an amount not matching the stored attempt, when processed, then it is quarantined, not applied, and no payment state changes (deliverable 10 §13 AC 4).

**Requirements:** API — deliverable 13 §16.6; Data — deliverable 07 `Payment`, `PaymentAttempt`, `ProviderEvent`; Security — deliverable 15 §8.1, §2.4; Test — provider simulation suite (deliverable 24 §7).

### FEAT-SUB009-02 Allocation and refunds

Covers `BL-009-05`, `BL-009-06`.

**US-SUB009-03** — *As a Billing Administrator, I want one successful payment to allocate across multiple open invoices, so that a customer paying a lump sum is handled correctly.*

- Given a `SUCCEEDED` payment exceeding one invoice's balance, when allocation runs, then it applies across eligible receivables without exceeding the payment amount or any receivable's open amount (deliverable 10 §7, §13 AC 5).

**Requirements:** Data — deliverable 07 `Allocation`, `Refund`; Test — allocation-boundary property test.

## 11. `SUB-010` Customer Portal

**Goal:** a fintech-grade self-service experience with transparent financial-impact previews and no dark patterns.

### FEAT-SUB010-01 Portal home and self-service changes

Covers `BL-010-01`–`BL-010-05`.

**US-SUB010-01** — *As a Subscriber Admin, I want to see my upcoming amount and payment risk before it's due, so that I can act before service is affected.*

- Given usage is trending above the account's typical level, when Portal Home loads, then a bill-shock alert with an estimated bill range is shown alongside upgrade/alert/continue options (master prompt §30, deliverable 18 §11).

**US-SUB010-02** — *As a Subscriber Admin, I want cancellation to be as easy to find as upgrade, so that I am not manipulated into staying.*

- Given I open the Subscriptions screen, when I look for Cancel, then it has equal visual prominence to Upgrade, and confirming shows the exact effective date and financial impact before I commit (deliverable 17 §9.1–9.3).

**Requirements:** API — deliverable 13 §16.3, §16.6; UX — deliverable 17 §9, deliverable 18 §11; Security — deliverable 13 §3 (portal session scoping); Test — no-dark-pattern UX audit (deliverable 17 §11 AC 5).

## 12. `SUB-011` Usage & Metering

**Goal:** durable, deduplicated, replayable usage ingestion feeding deterministic rating.

### FEAT-SUB011-01 Ingestion, deduplication, and rating

Covers `BL-011-01`–`BL-011-04`.

**US-SUB011-01** — *As a merchant developer, I want a batch of usage events to durably persist before I get an acknowledgement, so that an accepted event is never silently lost.*

- Given a batch of 500 events including one duplicate `source_event_id`, when submitted, then each item's disposition (`ACCEPTED`/`DUPLICATE`/`REJECTED`/`QUARANTINED`) is returned individually and every accepted event is durably queryable (INV-002, deliverable 13 §13.1).

**US-SUB011-02** — *As a Billing Administrator, I want late usage arriving after invoice posting to never edit the posted line, so that the invoice stays legally immutable.*

- Given a usage event with event-time before period close arrives after the invoice for that period posted, when processed, then a new adjustment charge is created and linked to the original period; the posted line is untouched (deliverable 12 §7 "Late and corrected usage").

**Requirements:** API — deliverable 13 §16.4; Data — deliverable 07 `UsageEvent`, `UsageAggregate`, `RatedEvent`; Test — late-event/correction golden case (deliverable 12 §23).

## 13. `SUB-012` Collections

**Goal:** the MVP differentiator — preventive, explainable, policy-bounded collections.

### FEAT-SUB012-01 Risk scoring and Next Best Action

Covers `BL-012-01`–`BL-012-03`, `BL-012-05`, `BL-012-06`.

**US-SUB012-01** — *As a Collections Agent, I want every risk score to show its contributing factors, so that I can trust and act on the recommendation.*

- Given a risk assessment of `HIGH`, when displayed, then factor codes with direction/contribution, policy version, and generation time are shown alongside the band — never a bare label (deliverable 11 §6, deliverable 17 §8.4).

**US-SUB012-02** — *As a Finance Controller, I want the Payment & Collections Intelligence summary to be available for every account, so that the platform's core differentiator is verifiable on day one.*

- Given any account with at least one open or upcoming invoice, when its collection summary is requested, then upcoming amount, risk band, preferred channel, and next best action are returned with reason codes and policy version (master prompt §87, `GET /accounts/{id}/collection-summary`).

**US-SUB012-03** — *As a Collections Manager, I want a broken promise to reactivate priority without duplicating the case, so that agents don't chase the same account twice.*

- Given an open promise-to-pay passes its due date without qualifying allocation, when evaluated, then the existing case (not a new one) moves to `ACTIVE` with elevated priority (deliverable 11 §8).

**Requirements:** API — deliverable 13 §16.8; Data — deliverable 07 `CollectionCase`, `RiskAssessment`; UX — deliverable 18 §9; Test — deterministic-fallback and model-outage test (deliverable 11 §15 AC 8).

## 14. `SUB-013` Notifications

**Goal:** versioned templates and tracked delivery without leaking provider secrets.

### FEAT-SUB013-01 Template delivery and status

Covers `BL-013-01`, `BL-013-02`.

**US-SUB013-01** — *As a Billing Administrator, I want to know whether a due-date reminder was actually delivered, so that I can escalate manually if it failed.*

- Given a notification is queued, when the provider reports failure, then the notification's status is `FAILED` with a safe reason, distinct from invoice/payment truth (deliverable 09 §4 "Delivery is independent of legal validity").

**Requirements:** API — deliverable 13 §16.9; Data — deliverable 07 `Communication`; Security — deliverable 15 §3 (no secrets in payload).

## 15. `SUB-014` Analytics

**Goal:** MVP-scope basic reporting with defined semantic rules — no custom report builder yet.

### FEAT-SUB014-01 Core revenue and collections metrics

Covers `BL-014-01`, `BL-014-02`.

**US-SUB014-01** — *As an Executive, I want MRR/ARR computed from one defined semantic rule, so that Finance and Product never argue about whose number is right.*

- Given active subscriptions with recurring components, when MRR is computed, then the calculation uses the single version-controlled semantic definition (deliverable 05 §5 "Metrics definitions are version-controlled") and matches the Revenue Dashboard display exactly.

**Requirements:** API — internal reporting query surface (extends deliverable 13 read patterns); UX — deliverable 18 §1; Test — metric-definition regression test against a fixed dataset.

## 16. `SUB-015` AI Revenue Intelligence (MVP-narrow)

**Goal:** grounded, bounded AI assistance — no autonomous financial action, no fabricated explanation.

### FEAT-SUB015-01 Grounded explanation and AI gateway

Covers `BL-015-01`–`BL-015-03`.

**US-SUB015-01** — *As a subscriber, I want "Explain my bill" to use only verified facts, so that I can trust the explanation even though it reads like prose.*

- Given a bill increase driven by 460 additional API requests and 2 added seats, when "Explain my bill" is invoked, then the response cites exact figures from the calculation trace/RLG and never states a fact not present in those sources; if a trace is missing, the response explicitly says so instead of inventing an explanation (master prompt §33, deliverable 12 §15).

**US-SUB015-02** — *As a security reviewer, I want every AI tool invocation to require the same authorization a human action would, so that AI cannot act with elevated implicit trust.*

- Given the AI Revenue Assistant suggests an action requiring approval, when a user clicks "Act," then the platform routes through the identical authorized command and approval gate as a human-initiated request (deliverable 15 §10).

**Requirements:** API/Security — deliverable 15 §10, deliverable 05 ADR-LA-009; Test — prompt-injection and grounding-fabrication test cases.

## 17. `SUB-016` Integration Framework (MVP-narrow)

**Goal:** connector primitives and outbound webhooks — not the full enterprise integration marketplace.

### FEAT-SUB016-01 Connector primitives and webhook delivery

Covers `BL-016-01`–`BL-016-03`.

**US-SUB016-01** — *As a merchant developer, I want to replay a missed webhook delivery, so that an outage on my side doesn't cause permanent data loss.*

- Given a delivery failed and is past retry exhaustion, when I call the replay endpoint, then the exact original event envelope is redelivered under a new delivery ID (deliverable 13 §15.3).

**Requirements:** API — deliverable 13 §16.10; Data — deliverable 07 `Connector`, `WebhookEndpoint`; Security — deliverable 15 §2.4 (SSRF egress controls); Test — signature/replay contract test.

## 18. `SUB-017` Audit & Compliance

**Goal:** every material mutation and AI action is auditable, and isolation is continuously verified.

### FEAT-SUB017-01 Append-only audit and isolation verification

Covers `BL-017-01`–`BL-017-04`.

**US-SUB017-01** — *As an Auditor, I want every financial mutation to have a corresponding audit record with before/after evidence, so that I can reconstruct what happened without trusting a human's memory.*

- Given any invoice/payment/subscription/pricing mutation commits, when I query the audit trail for that object, then actor, action, reason, correlation ID, and safe before/after references are present (deliverable 03 §"Audit and Approval", INV — audit completeness).

**US-SUB017-02** — *As a security reviewer, I want the tenant-isolation test suite to block release on failure, so that isolation regressions cannot reach production.*

- Given the isolation test matrix (deliverable 16 §11.1) includes a failing case, when CI runs, then the release pipeline is blocked (deliverable 16 §13 AC 2).

**Requirements:** API — deliverable 13 §16 (audit export, internal); Data — deliverable 07 `AuditEvent`; Security — deliverable 15 §9.1; Test — deliverable 16 §11.1 full matrix.

## 19. Traceability summary

| Epic | Features (MVP) | Backlog items covered | PRD requirement areas |
|---|---|---|---|
| SUB-001 | 2 | BL-001-01–05 | FR-PLT-001–005 |
| SUB-002 | 2 | BL-002-01–05 | FR-PLT-002, FR-PLT-004 |
| SUB-003 | 1 | BL-003-01–03 | FR-CUS-001–003 |
| SUB-004 | 1 | BL-004-01–03 | FR-PRC-001 |
| SUB-005 | 2 | BL-005-01–09 | FR-PRC-002–005 |
| SUB-006 | 1 | BL-006-01–05 | FR-SUB-001–004 |
| SUB-007 | 1 | BL-007-01–03 | FR-INV-001 |
| SUB-008 | 1 | BL-008-01–06 | FR-INV-002–006 |
| SUB-009 | 2 | BL-009-01–07 | FR-PAY-001–004 |
| SUB-010 | 1 | BL-010-01–05 | FR-EXP-001–002 |
| SUB-011 | 1 | BL-011-01–06 | FR-USG-001–005 |
| SUB-012 | 1 | BL-012-01–06 | FR-COL-001–004 |
| SUB-013 | 1 | BL-013-01–02 | FR-EXP-003 |
| SUB-014 | 1 | BL-014-01–02 | FR-ANA-001 |
| SUB-015 | 1 | BL-015-01–03 | master prompt §33, §87 |
| SUB-016 | 1 | BL-016-01–03 | deliverable 04 §4 |
| SUB-017 | 1 | BL-017-01–04 | FR-PLT-003 |

## 20. Acceptance criteria

1. Every P0 backlog item in deliverable 19 §4 is covered by at least one feature in this document.
2. Every user story's Given/When/Then references only vocabulary already fixed in deliverables 03, 07, 08–12; no new state, enum, or entity name is introduced.
3. Every story cites at least one PRD requirement (`FR-*`) or master-prompt section; every money-affecting story additionally cites the invariant (`INV-*`) it protects.
4. No R2/Enterprise-scope story is included as if it were MVP (cross-checked against deliverable 19 §6).
5. Every feature lists API, Data, and Test requirement references; UX and Security references are present wherever the feature has a user-facing or security-relevant surface.

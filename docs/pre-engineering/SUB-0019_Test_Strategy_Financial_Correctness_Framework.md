# SUB-0019 — Test Strategy & Financial Correctness Framework

**Document ID:** SUB-0019
**Title:** Test Strategy & Financial Correctness Framework
**Version:** 0.1 (Draft)
**Status:** Draft
**Owner:** QA/Test Architect
**Reviewers:** Principal Software Architect, Billing and Rating Architect, Payments Architect, Security Architect, Revenue Accounting SME
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23
**Dependencies:** [SUB-0005](SUB-0005_State_Machine_Specification.md)–[SUB-0018](SUB-0018_Non_Functional_Requirements.md)
**Related Documents:** SUB-0020 Engineering Implementation Blueprint (planned), SUB-0021 MVP Delivery Backlog (planned)

## 1. Purpose and gating philosophy

This document assembles every test class the master prompt requires into one CI-enforced strategy and states the Financial Correctness Framework — the platform's non-negotiable testing floor. A financially material change without its required test class does not merge, regardless of manual confidence in it.

| Gating tier | Meaning |
|---|---|
| **Blocking (every PR)** | Runs on every pull request; failure blocks merge. |
| **Blocking (release)** | Runs on every release candidate; failure blocks release even if individual PRs passed. |
| **Scheduled** | Runs on a defined cadence independent of the PR/release cycle; failure pages the owning team without retroactively blocking already-merged work. |

## 2. Test taxonomy

### 2.1 Unit testing

- **Scope:** pure domain logic — state-machine transition guards (SUB-0005), pricing formula components in isolation (SUB-0007 §3), value-object invariants.
- **Tier:** Blocking (every PR).
- **Rule:** no database, network, or clock access; deterministic inputs only — a unit test injects time, it never waits for it.

### 2.2 Integration testing

- **Scope:** application/command handlers against a real (test-container) PostgreSQL instance, exercising the full transaction including idempotency-record and outbox writes.
- **Tier:** Blocking (every PR) for the owning module; Blocking (release) across all modules.
- **Rule:** every state-machine transition row in SUB-0005 has at least one integration test exercising it from a real repository — mocking the database for a state-machine test is insufficient coverage, because the invariant (e.g., "posted invoice cannot be edited") is a database-constraint-plus-application-logic invariant (SUB-0012 §4.6).

### 2.3 Contract testing

- **Scope:** the published API (SUB-0013 §9) and event schemas (SUB-0013 §11) against both server implementation and generated clients.
- **Tier:** Blocking (every PR) for any change under the contract surface; Blocking (release) for the full suite.
- **Required cases:** every endpoint's request/response matches its schema; a duplicate request with the same `Idempotency-Key` returns the original response verbatim; a reused key with a different payload returns `409`; a stale `If-Match` returns `412`; an illegal state transition returns the documented `409`; a consumer generated from the current event schema processes a payload from the prior non-breaking revision without error.

### 2.4 API testing

- **Scope:** black-box testing of the full public API surface (SUB-0013) including authentication, tenant derivation, pagination/filtering, and the canonical problem model.
- **Tier:** Blocking (release).
- **Required case:** a cross-tenant ID probe against every documented endpoint returns the standard non-leaking `404` shape (SUB-0013 §8, SUB-0014 §4) with no measurable latency signal above tolerance.

### 2.5 Event testing

- **Scope:** the domain event catalog (SUB-0013 §11) — envelope shape, ordering-per-aggregate guarantee, at-least-once delivery, consumer idempotency, dead-letter behavior.
- **Tier:** Blocking (release).
- **Rule:** every Public-classified event has a documented example payload validated against its registered schema in CI; Collections/AI-gateway events (internal-only, SUB-0013 §11.1) are automatically checked to never appear in the webhook-eligible classification.

### 2.6 Property-based testing

- **Scope:** invariant properties over the pricing engine (SUB-0007) — graduated-price monotonicity, non-negative charge, tier slices summing exactly to chargeable quantity, allowance balance identities, rounded-allocation-sums-to-total, replay stability, commutative aggregation order-independence, single-winner selection.
- **Tier:** Blocking (release); Scheduled (nightly extended-range run with a larger generated input space than the PR-time subset).
- **Tooling note:** generator inputs are constrained to the typed domain (`Quantity<Unit>`, `Money<Currency>`, valid tier definitions) so generated cases are realistic, not merely syntactically valid.

### 2.7 Golden dataset testing

- **Scope:** the fixed dataset of pricing, billing, and financial scenarios with known-correct expected output (§4).
- **Tier:** Blocking (every PR) touching pricing/rating/billing modules; Blocking (release) for the full dataset.
- **Rule:** golden outputs are committed fixtures with their expected calculation-trace content hash (SUB-0007 §13); a diff for an unchanged input/engine-version combination is always a defect, never "expected drift." Any pricing-engine version change runs a full shadow/golden comparison against the previous version's stored results before the new version may be activated for a live tenant.

### 2.8 Payment simulator

- **Scope:** the Stripe adapter boundary (SUB-0009 §2), using a recorded/simulated provider double producing every canonical response class from SUB-0009 §2.5 (declines by category, timeouts, ambiguous `UNKNOWN` responses, out-of-order webhooks, duplicate webhooks, mismatched-amount webhooks).
- **Tier:** Blocking (release); a targeted happy-path-plus-one-failure-class subset is Blocking (every PR) for changes under the payments module.
- **Required cases:** timeout-after-provider-acceptance never duplicates a charge; duplicate/out-of-order webhooks produce one state progression and one allocation; a mismatched-amount webhook is quarantined, never applied; refund retries produce exactly one provider refund.
- **Rule:** the simulated provider double is versioned alongside the adapter and reviewed whenever the real provider's documented behavior changes.

### 2.9 Tax simulator

- **Scope:** the tax-evidence adapter boundary (SUB-0008 §8, SUB-0017 §12) using a simulated provider double producing representative jurisdiction/category/rate combinations and a stale-quote scenario.
- **Tier:** Blocking (release) for the evidence-storage and stale-quote-blocks-finalization behavior (SUB-0008 §8); full native-determination simulation is a Release 2 addition once a tax connector is built.
- **Required case:** finalization is blocked when the stored tax quote is past its validity window, and revalidation clears the block.

### 2.10 Reconciliation testing

- **Scope:** invoice-total-to-receivable-to-journal reconciliation (SUB-0010 §2, §14 AC 1), payment-allocation-boundary properties, ERP/tax export control-total matching, migration source/target control totals.
- **Tier:** Blocking (release) for the core invoice/receivable/journal triad; Scheduled for full ERP/export reconciliation given its dependency on external test doubles.
- **Rule:** every reconciliation test asserts exact equality (debits equal credits per currency, open amount matches source minus allocations) — no tolerance for a rounding "close enough" delta, since SUB-0007 §13's largest-remainder allocation rule exists precisely so this can be an exact-equality test.

### 2.11 Load testing

- **Scope:** usage ingestion throughput (against the benchmark target from Decision DEC-040), billing-run duration at representative tenant/subscription-count scale, API p95 latency under the SUB-0018 §3 reference load, database behavior under per-tenant fairness controls (SUB-0018 §2).
- **Tier:** Scheduled (regular cadence); Blocking (release) for a defined minimum threshold before major releases.
- **Required case:** a "hot tenant" scenario (one tenant driving disproportionate load) validates noisy-neighbor controls, not only aggregate throughput.

### 2.12 Concurrency testing

- **Scope:** optimistic-concurrency conflict handling (SUB-0013 §7), concurrent billing-run/finalization races (SUB-0008 §15 AC 1), concurrent subscription-item changes (SUB-0005 §2 stale-version rejection).
- **Tier:** Blocking (release).
- **Required case:** two finalization retries with the same idempotency key racing concurrently produce exactly one invoice number, receivable, and journal transaction — never two, never zero.

### 2.13 Failover testing

- **Scope:** provider outage handling (the platform still previews bills and accepts durable usage during a payment/tax provider outage, per SUB-0011 §2), outbox dispatcher recovery after crash, billing-run restart after partial failure, database failover/replica promotion.
- **Tier:** Scheduled; Blocking (release) for the core outbox-recovery and billing-run-restart cases.
- **Rule:** every failover test asserts not just "the system recovers" but "the system recovers with zero duplicate or lost financial effect" (§3 invariants) — recovery alone is an incomplete pass.

### 2.14 Chaos testing

- **Scope:** injected failure (network partition, database connection loss, delayed provider response, killed worker mid-transaction) against the financial write path specifically.
- **Tier:** Scheduled (pre-release, non-production environment).
- **Rule:** every chaos scenario's pass criterion is identical to §2.13 — no duplicate or lost financial effect, and the system reaches a consistent, explainable state (never a silent partial-application state).

### 2.15 Security testing

- **Scope:** SAST/dependency scanning (Blocking, every PR), DAST/authenticated API fuzzing (Scheduled, pre-release), maker-checker self-approval rejection (Blocking, every PR touching approval logic), AI gateway prompt-injection/grounding-fabrication cases (Blocking, release), SSRF/injection/XSS/CSRF/BOLA/mass-assignment/replay cases (Blocking, release), secret/credential log-content scanning (Blocking, every PR).
- **Tier:** mixed, as annotated.
- **Rule:** penetration testing (SUB-0014 §14, Decision DEC-033) findings are converted into permanent regression tests here once remediated.

### 2.16 Penetration testing

- **Scope:** independent, scheduled assessment of the deployed system against the threat model in SUB-0014 §12.
- **Tier:** Scheduled (cadence per Decision DEC-033), mandatory before first production launch handling live payment data.

### 2.17 Accessibility testing

- **Scope:** every screen in SUB-0015 §3, automated (axe-core or equivalent) plus a documented manual keyboard-only pass for the two desktop-first canvas screens (Pricing Studio, Workflow Builder).
- **Tier:** Blocking (every PR) for automated checks on any changed screen; Scheduled (full-suite manual pass) before major releases.
- **Rule:** WCAG 2.2 AA is the merge bar (SUB-0018 §8); a new AA violation blocks merge absent an explicit, time-bound, tracked exception.

### 2.18 Regression testing

- **Scope:** every previously fixed defect in a financially material path gets a permanent test in the appropriate class above — a production defect fix is not complete until its regression test exists.
- **Tier:** Blocking (every PR, as part of the growing suite in its class).

## 3. Financial Correctness Framework: critical invariants

These invariants are absolute — never traded off for schedule, convenience, or an "edge case we'll fix later" (SUB-0000 PRIN-04).

| ID | Invariant | Enforcement mechanism | Verifying test class |
|---|---|---|---|
| INV-01 | Never double-charge due to request retries | Idempotency-record table + unique business constraints (SUB-0011 ADR-016) | §2.3, §2.8, §2.12 |
| INV-02 | Never lose an accepted usage event | Durable write before acknowledgement (SUB-0012 §4.5), unique source-event constraint | §2.2, §2.11, §2.13 |
| INV-03 | Never mutate a posted ledger entry | No `UPDATE`/`DELETE` grant on `journal_entry` (SUB-0012 §4.8); reversing entry only | §2.2, §2.10 |
| INV-04 | Never silently change a finalized invoice | No `UPDATE`/`DELETE` grant on posted `invoice`/`invoice_line` (SUB-0012 §4.6); credit note/reversal only | §2.2, §2.7 |
| INV-05 | Every money movement is traceable | Revenue Lifecycle Graph lineage (SUB-0006), mandatory source-document reference on every journal entry (SUB-0012 §4.8) | §2.7, §2.10 |
| INV-06 | Retries must remain idempotent | Idempotency architecture (SUB-0011 ADR-016) applied uniformly to every financially material command | §2.3, §2.8, §2.12 |
| INV-07 | One tenant never reads or changes another tenant's data | RLS + mandatory application filter (SUB-0011 ADR-013, SUB-0014 §4) | §2.4 (isolation matrix, §6) |
| INV-08 | AI never fabricates a financial fact or acts without authorization | Grounding requirement + identical authorization path as a human action (SUB-0016 §1, §4) | §2.15 (AI-specific cases) |

Every invariant above is release-blocking, with zero exceptions — this is the concrete meaning of "financial correctness over convenience" (SUB-0000 §13).

## 4. Representative golden scenarios

Extends the 22 pricing-specific golden examples in SUB-0007 §14 with cross-module financial scenarios exercising the full lifecycle.

| # | Scenario | Expected outcome |
|---|---|---|
| G1 | Create tenant → customer → activate price → subscribe → ingest usage → finalize invoice → pay → allocate | Full PRD-equivalent vertical slice completes with correct amounts, traceable lineage, and one audit record per mutation |
| G2 | Two concurrent finalize calls on the same draft invoice with the same idempotency key | Exactly one invoice number, receivable, and journal transaction created |
| G3 | Payment attempt times out after reaching the provider (ambiguous outcome) | Attempt enters `UNKNOWN`; reconciliation resolves it using the same provider idempotency reference; no duplicate attempt created |
| G4 | Duplicate and out-of-order payment webhooks for the same attempt | One legal state progression, one allocation |
| G5 | Late-arriving usage event after invoice posting | A new linked adjustment charge is created on a subsequent document; the posted line is untouched |
| G6 | Credit note issued against a posted invoice | Original invoice lines/totals unchanged; balanced reversal/credit journal entries posted; graph edge `CORRECTS` created |
| G7 | Refund exceeding the refundable succeeded amount after a prior partial refund | Rejected with a specific validation error; no financial effect |
| G8 | Cross-tenant invoice ID probed by an authenticated user of a different tenant | Standard non-leaking `404`; no data or existence signal |
| G9 | Rate card activation attempted by the same user who authored it, under a separation-of-duties policy | Rejected as a self-approval violation |
| G10 | AI Revenue Copilot asked to explain a bill with no persisted calculation trace available | Response explicitly states the limitation; no fabricated explanation produced |
| G11 | Billing run interrupted mid-execution and restarted | Already-completed accounts are not reprocessed; control totals reconcile; no duplicate invoices |
| G12 | Settlement received with an amount mismatch against expected payment total | Reconciliation exception raised with evidence; not silently absorbed into a rounding adjustment |

## 5. Test-class-to-deliverable traceability

| Test class | Primary governing document(s) | Gating tier |
|---|---|---|
| Unit | SUB-0005, SUB-0007 | Blocking (PR) |
| Integration | SUB-0004, SUB-0005, SUB-0012 | Blocking (PR + release) |
| Contract | SUB-0013 | Blocking (PR + release) |
| API | SUB-0013, SUB-0014 | Blocking (release) |
| Event | SUB-0013 | Blocking (release) |
| Property-based | SUB-0007 | Blocking (release), Scheduled (extended) |
| Golden dataset | SUB-0007, SUB-0008, SUB-0010 | Blocking (PR + release) |
| Payment simulator | SUB-0009 | Blocking (release), targeted subset (PR) |
| Tax simulator | SUB-0008, SUB-0017 | Blocking (release) |
| Reconciliation | SUB-0010 | Blocking (release), Scheduled (full) |
| Load | SUB-0011, SUB-0018 | Scheduled, Blocking (release, threshold) |
| Concurrency | SUB-0005, SUB-0008, SUB-0013 | Blocking (release) |
| Failover | SUB-0011 | Scheduled, Blocking (release, core cases) |
| Chaos | SUB-0011 | Scheduled |
| Security | SUB-0014 | Mixed |
| Penetration | SUB-0014 | Scheduled |
| Accessibility | SUB-0015, SUB-0018 | Blocking (PR automated), Scheduled (manual) |
| Regression | All | Blocking (PR, as part of its class) |

## 6. Tenant isolation matrix (release-blocking, zero exceptions)

| Test | Asserts |
|---|---|
| Cross-tenant read via direct object ID | Non-leaking `404` |
| Cross-tenant write attempt (forged/mismatched tenant context) | Rejected before any domain transaction begins |
| RLS-only enforcement (application filter bypassed in test harness) | Database layer alone blocks the cross-tenant row |
| Cache key collision | No cross-tenant read even under a crafted matching business key |
| Event/outbox cross-tenant leakage | A consumer processing tenant A's stream never receives or applies a tenant B event |
| Search cross-tenant query | An unscoped or crafted query never returns another tenant's document |
| Support/break-glass scope enforcement | An active grant for tenant A cannot be used to query tenant B |
| Rate-limit isolation | Saturating tenant A's quota does not measurably affect tenant B's latency |
| Restore drill isolation | A single-tenant logical restore does not alter or expose other tenants' current state |

## 7. Acceptance criteria

1. Every state-machine transition in SUB-0005 has at least one integration test exercising it.
2. The full golden dataset (SUB-0007 §14 plus §4 above) passes before any pricing-engine version is activated for a live tenant.
3. The tenant isolation matrix (§6) is release-blocking with zero exceptions in the CI pipeline configuration.
4. Every financially material command handler has a passing idempotent-replay test before it is considered done.
5. All eight critical invariants (§3) have an assigned verifying test class and are demonstrably enforced, not merely documented.
6. A newly discovered production defect in a financially material path always results in a new permanent regression test before the fix is considered complete.

## Decisions Requiring Product Owner Approval

| ID | Decision needed | Status |
|---|---|---|
| DEC-042 | Load-test threshold values gating release (extends DEC-040 once the throughput benchmark exists) | Open |
| DEC-043 | Chaos-testing environment and cadence ownership | Open |

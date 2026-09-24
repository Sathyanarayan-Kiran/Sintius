# Testing strategy

**Version:** 0.1
**Status:** Proposed MVP baseline
**Related:** [Pricing engine specification](12-pricing-engine-specification.md) §23, [Multi-tenancy architecture](16-multi-tenancy-architecture.md) §11, [Coding standards](23-coding-standards.md), [Technical implementation plan](21-technical-implementation-plan.md)

## 1. Purpose and gating philosophy

Every test class below already exists as a requirement somewhere in deliverables 07–23; this document assembles them into one coherent, CI-enforced strategy and states which classes are release-blocking versus advisory. The platform's core promise — traceable, correct, non-duplicable money movement — is a testing promise before it is a feature promise: a financially material change without its required test class does not merge, regardless of how confident the author is in manual verification.

| Gating tier | Meaning |
|---|---|
| **Blocking (every PR)** | Runs on every pull request; a failure blocks merge. |
| **Blocking (release)** | Runs on every release candidate; a failure blocks release even if individual PRs passed. |
| **Scheduled** | Runs on a defined cadence (nightly/weekly) independent of the PR/release cycle; a failure pages the owning team but does not retroactively block already-merged work. |

## 2. Unit tests

- **Scope:** pure domain logic in `modules/*/domain` — state machine transition guards, value-object invariants, pricing formula components in isolation.
- **Tier:** Blocking (every PR).
- **Rule:** a unit test may not touch a database, network, or clock; deterministic inputs only (deliverable 12 §14 "no current clock access" applies equally to test design — tests inject time, they don't wait for it).
- **Ownership:** the module team (deliverable 21 §5).

## 3. Integration tests

- **Scope:** `modules/*/application` command/query handlers against a real (test-container) PostgreSQL instance, exercising the full transaction including idempotency-record and outbox writes (deliverable 22 §3 layering).
- **Tier:** Blocking (every PR) for the owning module; Blocking (release) across all modules together.
- **Rule:** every state-machine transition table row in deliverables 08–11 has at least one integration test exercising it from a real repository, not a mocked one — mocking the database for a state-machine test is treated as insufficient coverage, because the invariant being protected (e.g., "posted invoice cannot be edited") is a database-constraint-plus-application-logic invariant, not application logic alone.

## 4. Contract tests

- **Scope:** the published OpenAPI document (deliverable 13) and event JSON Schemas (deliverable 14) against both the server implementation and any generated client/SDK.
- **Tier:** Blocking (every PR) for any change under `contracts/`; Blocking (release) for the full suite.
- **Cases required:**
  - every documented endpoint's request/response matches its schema (provider-side contract test);
  - a duplicate request with the same `Idempotency-Key` returns the original response verbatim (deliverable 13 §8, deliverable 23 §5.3);
  - a request with a reused key and different payload returns `409 idempotency_key_reused_with_different_payload`;
  - a stale `If-Match` returns `412` with current resource state (deliverable 13 §9);
  - an illegal state transition (e.g., finalizing an already-`VOIDED` invoice) returns the documented `409`;
  - a consumer generated from the current schema can process a payload from the previous non-breaking minor revision without error (forward-compatibility check, deliverable 13 §5, deliverable 14 §4).

## 5. Golden pricing/billing tests

- **Scope:** the exact dataset enumerated in deliverable 12 §23 — flat monthly price across 28/29/30/31-day periods, mid-period start/end/seat changes, tier boundaries, allowance edge cases, package rounding, discount stacking, minimum/cap ordering, JPY/INR/3-decimal-currency precision, late-event correction, idempotent replay, and rejection cases (overflow, missing dimension, invalid tier gap).
- **Tier:** Blocking (every PR) touching `modules/pricing`, `modules/rating`, or `modules/billing`; Blocking (release) for the full dataset.
- **Rule:** golden outputs are stored as committed fixtures with their expected calculation-trace content hash (deliverable 12 §16); a diff in output for an unchanged input/engine-version combination is always a defect, never "expected drift."
- **Engine-upgrade rule:** any pricing-engine version change runs a full shadow/golden comparison against the previous version's stored results before the new version may be activated for live tenants (deliverable 12 §16).

## 6. Property-based tests

- **Scope:** the invariant properties listed in deliverable 12 §23 §"Property tests" — graduated-price monotonicity, non-negative charge, tier slices summing exactly to chargeable quantity, allowance balance identities, rounded-allocation-sums-to-total, replay stability, commutative aggregation order-independence, single-winner selection.
- **Tier:** Blocking (release); Scheduled (nightly extended-range run with a larger generated input space than the PR-time subset, to catch rare boundary failures without slowing every PR).
- **Tooling note:** generator inputs are constrained to the typed domain (`Quantity<Unit>`, `Money<Currency>`, valid tier definitions) so generated cases are realistic, not merely syntactically valid — an unconstrained fuzzer would mostly generate cases the compiler already rejects (deliverable 12 §14).

## 7. Provider simulation tests

- **Scope:** the Payment (Stripe adapter) and Tax adapter boundaries, using a recorded/simulated provider double that can produce every canonical response class from deliverable 10 §6 (declines by category, timeouts, ambiguous/`UNKNOWN` responses, out-of-order webhooks, duplicate webhooks, mismatched-amount webhooks).
- **Tier:** Blocking (release); a targeted subset (happy path + one failure class) is Blocking (every PR) for changes under `modules/payments`.
- **Cases required (deliverable 10 §13):** timeout-after-provider-acceptance never duplicates a charge; duplicate/out-of-order webhooks produce one state progression and one allocation; a mismatched-amount webhook is quarantined, not applied; refund retries produce exactly one provider refund.
- **Rule:** the simulated provider double is versioned alongside the adapter and reviewed whenever the real provider's documented behavior changes, so simulation drift from reality is a tracked risk, not an assumption.

## 8. Tenant isolation tests

- **Scope:** the full matrix from deliverable 16 §11.1 — cross-tenant read/write attempts, RLS-only enforcement (application filter bypassed in harness), cache-key collision, event/outbox cross-tenant leakage, search cross-tenant query, object-storage path traversal, break-glass scope enforcement, rate-limit isolation, job/worker context forgery, restore-drill isolation.
- **Tier:** Blocking (release), no exceptions — this is the platform's single highest-severity failure class (deliverable 15 §12 RISK-SEC-001) and is never advisory.
- **Rule:** a newly discovered isolation gap (from incident review, deliverable 16 §11.2, or otherwise) is added to this matrix before the incident is considered closed, not merely fixed in the code that caused it.

## 9. Load tests

- **Scope:** usage ingestion throughput (against the SPIKE-05 target, deliverable 21 §2), billing-run duration at representative tenant/subscription-count scale, API p95 latency under the reference load from PRD §9, database connection/query behavior under per-tenant fairness controls (deliverable 16 §5).
- **Tier:** Scheduled (regular cadence against a stable environment); Blocking (release) for a defined minimum threshold before major releases.
- **Rule:** load tests explicitly include a "hot tenant" scenario (one tenant driving disproportionate load) to validate noisy-neighbor controls (deliverable 16 §5), not only aggregate throughput.

## 10. Failover tests

- **Scope:** provider outage handling (payment/tax adapter unavailable — the platform must still preview bills and accept durable usage per deliverable 04 §7), outbox dispatcher recovery after crash, billing-run restart after partial failure (deliverable 21 §3 Phase 2 exit criteria), database failover/replica promotion.
- **Tier:** Scheduled; Blocking (release) for the core outbox-recovery and billing-run-restart cases.
- **Rule:** every failover test asserts not just "the system recovers" but "the system recovers with zero duplicate or lost financial effect" (INV-001, INV-002) — recovery alone is an incomplete pass.

## 11. Security tests

- **Scope:** SAST/dependency scanning (Blocking, every PR), DAST/authenticated API fuzzing (Scheduled, pre-release), maker-checker self-approval rejection (deliverable 15 §15 AC 4, Blocking every PR touching approval logic), AI gateway prompt-injection/grounding-fabrication cases (deliverable 15 §10, Blocking release), SSRF/injection/XSS/CSRF/BOLA/mass-assignment/replay cases from deliverable 15 §8 (Blocking release), secret/credential log-content scanning (deliverable 15 §15 AC 2, Blocking every PR).
- **Tier:** mixed, as annotated above.
- **Rule:** penetration testing (deliverable 15 §11.5) is external to this automated suite but its findings are converted into permanent regression tests here once remediated, so a found vulnerability class cannot silently regress.

## 12. Reconciliation tests

- **Scope:** invoice-total-to-receivable-to-journal reconciliation (deliverable 09 §13 AC 10), payment-allocation-boundary properties (deliverable 10 §13 AC 5), ERP/tax export control-total matching (deliverable 04 §4), migration source/target control totals (deliverable 07 §10, deliverable 23 §9.4).
- **Tier:** Blocking (release) for the core invoice/receivable/journal triad; Scheduled for full ERP/export reconciliation given its dependency on external test doubles.
- **Rule:** every reconciliation test asserts exact equality (debits equal credits per currency, open amount matches source minus allocations) — no reconciliation test tolerates a rounding "close enough" delta; deliverable 12 §13's largest-remainder allocation rule exists precisely so this can be an exact-equality test.

## 13. Accessibility tests

- **Scope:** every screen in deliverable 18, automated (axe-core or equivalent) plus a documented manual keyboard-only pass for the two desktop-first canvas screens (Pricing Designer, Workflow Builder) that need a structured non-drag alternative (deliverable 17 §6.4).
- **Tier:** Blocking (every PR) for automated checks on any changed screen; Scheduled (full-suite manual pass) before major releases.
- **Rule:** WCAG 2.2 AA is the merge bar (deliverable 23 §10.5); a new AA violation blocks merge unless an explicit, time-bound, tracked exception is approved by the accessibility owner.

## 14. Backup and restore tests

- **Scope:** full-cluster point-in-time restore, single-tenant logical export/restore (deliverable 16 §4.5), post-restore isolation verification (deliverable 16 §11.1 restore-drill case), invoice-numbering/idempotency/allocation/journal-balance preservation across a restore (deliverable 07 §11 AC 7).
- **Tier:** Scheduled (regular drill cadence, e.g., quarterly at minimum) — restore correctness must be demonstrated on a live cadence, not assumed from the backup mechanism's existence.
- **Rule:** a drill that reveals RPO/RTO outside the PRD §9 target (RPO ≤ 5 minutes, RTO ≤ 60 minutes for MVP) is treated as a production incident for remediation-tracking purposes, not merely a "needs improvement" note.

## 15. End-to-end acceptance tests

- **Scope:** the PRD §11 release-acceptance scenario in full — `create tenant → create customer → activate price → subscribe → ingest usage → preview/finalize invoice → attempt/fail/retry/succeed payment → allocate cash → explain bill → verify audit and lineage` — plus the MVP vertical-slice walkthrough in deliverable 13 §17 and the Phase 3 checkpoint in deliverable 21 §7.
- **Tier:** Blocking (release), and re-run as the Phase 3 go/no-go gate (deliverable 21 §7).
- **Rule:** this scenario runs against a clean, representative environment (not a hand-tuned demo tenant) so it validates the same path a new customer would actually experience.

## 16. Test-class-to-deliverable traceability

| Test class | Primary governing deliverable(s) | Gating tier |
|---|---|---|
| Unit | 08–12 (domain rules) | Blocking (PR) |
| Integration | 07–11 (state machines, data model) | Blocking (PR + release) |
| Contract | 13, 14 | Blocking (PR + release) |
| Golden pricing/billing | 12 §23 | Blocking (PR + release) |
| Property-based | 12 §23 | Blocking (release), Scheduled (extended) |
| Provider simulation | 10 | Blocking (release) |
| Tenant isolation | 16 §11.1 | Blocking (release), no exceptions |
| Load | 05 §11, 21 §2 | Scheduled, Blocking (release, threshold) |
| Failover | 04 §7, 05 §9 | Scheduled, Blocking (release, core cases) |
| Security | 15 | Mixed (PR/release/scheduled) |
| Reconciliation | 07 §10, 09 §13, 10 §13 | Blocking (release), Scheduled (full) |
| Accessibility | 17, 18, 23 §10 | Blocking (PR automated), Scheduled (manual) |
| Backup/restore | 07 §11, 16 §4.5 | Scheduled |
| End-to-end acceptance | PRD §11, 13 §17, 21 §7 | Blocking (release) |

## 17. Acceptance criteria

1. Every state-machine transition in deliverables 08–11 has at least one integration test exercising it (§3).
2. The full golden dataset (deliverable 12 §23) passes before any pricing-engine version is activated for a live tenant (§5).
3. The tenant isolation matrix (§8) is release-blocking with zero exceptions in the CI pipeline configuration.
4. Every financially material command handler (deliverable 23 §5) has a passing idempotent-replay test before it is considered done.
5. The end-to-end acceptance scenario (§15) passes on a clean environment before each release and at the Phase 3 implementation checkpoint (deliverable 21 §7).
6. Every test class in §16 has an assigned gating tier and owning team before the implementation gate (deliverable 25/README) is considered satisfied.
7. A newly discovered production defect in a financially material path always results in a new permanent regression test in the appropriate class before the fix is considered complete, not just a manual verification note.

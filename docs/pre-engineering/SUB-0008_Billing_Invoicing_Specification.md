# SUB-0008 — Billing & Invoicing Specification

**Document ID:** SUB-0008
**Title:** Billing & Invoicing Specification
**Version:** 0.1 (Draft)
**Status:** Draft
**Owner:** Billing and Rating Architect
**Reviewers:** Revenue Accounting SME, ERP Integration Architect, Finance Controller, QA/Test Architect
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23
**Dependencies:** [SUB-0004](SUB-0004_Domain_Model.md), [SUB-0005](SUB-0005_State_Machine_Specification.md), [SUB-0007](SUB-0007_Pricing_Rating_Engine_Specification.md)
**Related Documents:** SUB-0009 Payments & Collections Specification (planned), SUB-0010 Accounting & Revenue Specification (planned)

## 1. Billing cycle models

| Model | Definition | Anchor |
|---|---|---|
| Calendar billing | Fixed calendar boundaries (1st of month, quarter start) shared across all subscriptions on the plan | Plan/tenant configuration |
| Anniversary billing | Boundaries anchored to the subscription's own activation date | Subscription activation date |
| Advance | Charge covers the upcoming service period, billed before service is rendered | Period start |
| Arrears | Charge covers the just-completed service period, billed after service is rendered | Period end |
| Mixed | Recurring components bill in advance; usage components bill in arrears within the same invoice | Per-component declaration |

A `SubscriptionItem`'s billing mode (advance/arrears) is a property of its `PriceRule` (SUB-0007 §3.1), not an invoice-level global — mixed mode is the normal case for a hybrid subscription (SUB-0007 §3.9).

## 2. Billing calendar and cut-off rules

- Every tenant declares a business time zone and a billing calendar (calendar or anniversary, per account or per subscription).
- **Cut-off:** usage accepted before the declared cut-off instant for a billing period is eligible for that period's invoice; usage accepted after cut-off but with an event time inside the period is late-arriving (§9).
- A billing run's cut-off is recorded as an explicit input to the run, not inferred from wall-clock time at execution — a delayed run still uses its declared cut-off, so results are reproducible.

## 3. Proration and partial-period handling

Reuses SUB-0007 §10 in full (`NONE`, `ACTUAL_DAYS`, `FULL_PERIOD_ONLY`, `IMMEDIATE_FULL`). A partial period at subscription start, end, or mid-cycle change always produces its own charge computation with its own service-period boundaries — it is never blended into an adjacent full period's amount.

## 4. Bill run

```mermaid
flowchart LR
  Trigger[Scheduled/manual trigger] --> Select[Select eligible accounts/subscriptions by cutoff]
  Select --> Gather[Gather billable charges: recurring, usage, one-time, adjustments]
  Gather --> Group[Apply invoice grouping policy]
  Group --> Draft[Assemble draft invoice per group]
  Draft --> Preview[Preview: validate blockers]
  Preview --> Finalize[Finalize: number, post, receivable, journal]
```

- A bill run is restartable and resumable: already-completed accounts within a run are not reprocessed on retry, and the run exposes control totals (accounts processed, charges included, total amount) so a partial failure is visible, not silently swallowed.
- Bill runs are idempotent per `(tenant_id, run_id)`; a retried run with the same identity does not reprocess completed work or duplicate invoices.

## 5. Invoice preview

- Preview is a non-posting, recalculable operation available at any time before finalization. It records: source charges and service periods, quantity/rate/tier/discount detail, proration and rounding operations, tax quote/evidence, credits considered/applied, grouping dimensions, calculation trace IDs, and control totals/warnings.
- A preview response has an expiry and an input/version hash; finalization revalidates or recomputes if a relevant input changed since the preview was generated.
- Preview must identify blockers explicitly: incomplete usage, stale tax quote, missing address/PO, incompatible currency — finalization is refused, never silently degraded, when a blocker exists.

## 6. Invoice finalization

Finalization is idempotent and executes as one strong transaction:

1. Lock or version-check the draft and its included active charges.
2. Verify approval (if policy requires it), account/legal-entity/currency, required tax evidence, totals, and absence of duplicate active billing inclusion.
3. Allocate the next invoice number in the correct tenant/legal-entity/sequence scope.
4. Freeze invoice lines, totals, due date, terms, addresses, and calculation references.
5. Mark charges billed through explicit inclusion records.
6. Create the receivable and a balanced journal transaction (SUB-0010).
7. Write the audit record, idempotency outcome, and the `invoice.finalized.v1` event (SUB-0013).

Any failure rolls back the entire transaction, including number allocation, unless local regulation requires gap evidence — in which case reserved numbers receive an explicit void/gap record rather than a silent skip.

## 7. Invoice grouping and splitting

| Concern | Rule |
|---|---|
| Grouping | Configurable by account, legal entity, PO, currency, business unit, contract, or product family; a tenant may choose one invoice or multiple invoices per billing cycle. |
| Splitting | A single account with mixed currencies or mixed legal entities always splits into separate invoices — one posted invoice never spans more than one currency or one legal entity. |
| Multi-account | An invoice belongs to exactly one Account; consolidated "family billing" across multiple accounts, if offered, produces one invoice per account with a shared payment/collection view, never one invoice referencing multiple accounts. |
| Multi-contract | Charges from multiple Contracts under the same Account may be grouped onto one invoice only if grouping policy permits and currency/legal-entity match; each line retains its originating contract reference. |
| Multi-currency | Cross-currency consolidation into one document requires an explicit, evidenced FX allocation model (Release 2/Enterprise) — MVP-scope invoices are single-currency. |

## 8. Tax

- The billing engine accepts a tax evidence result (jurisdiction, category, provider/reference, rate/amount, timestamp, inputs hash) per line/document and stores it immutably alongside the invoice (`TaxRecord`, SUB-0004 §5.11).
- Tax rounding is recorded as a distinct traced operation from pricing rounding (SUB-0007 §8) — the two are never merged into one undocumented total adjustment.
- A stale tax quote (older than its declared validity window) blocks finalization until revalidated (§5).

## 9. Late-arriving usage behavior

| Timing | Behavior |
|---|---|
| Before invoice finalization | The relevant usage aggregate is rebuilt/superseded and rerated idempotently; the draft invoice reflects the corrected total. |
| After invoice finalization | A new adjustment aggregate/rating/charge is created, linked to the original period, and placed on a later corrective document or credit note per policy. The posted line is never edited. |
| Cutoff and grace window | Tenant policy; every accepted usage event reaches an explicit billed, carried-forward, zero-rated, or adjusted disposition — no event is silently dropped from billing consideration. |

## 10. Invoice immutability and recalculation rules

- `DRAFT` invoices are freely recalculable; each recalculation is a new draft revision with its own trace, not an overwrite that destroys the prior preview's evidence.
- `POSTED` invoices are immutable in every dimension — lines, totals, dates, terms — with no ordinary update/delete path through API, repository, or admin tooling (SUB-0005 §3).
- **Finalization locks:** once a charge is included in a posted invoice via an explicit inclusion record, it cannot be included in any other active invoice (duplicate-inclusion is a database-enforced uniqueness constraint, not merely an application check).

## 11. Corrections, reversals, credit notes, debit notes, write-offs, adjustments

| Correction type | When used | Mechanism |
|---|---|---|
| Credit note | Reducing a posted invoice's collectible amount or reversing tax/line detail | New posted corrective document linked via `CORRECTS`; original invoice unchanged (SUB-0005 §10) |
| Debit note | Adding a legitimate additional charge related to a posted invoice without reopening it | New posted corrective document referencing the original invoice, never editing it |
| Reversal | Fully undoing a posted invoice's financial effect (e.g., after a validly permitted void) | Full reversal posting; document transitions to `VOIDED` (SUB-0005 §3) |
| Write-off | Approved reduction of open receivable with no corresponding payment | Write-off journal entry and receivable reduction; requires threshold approval and accounting reason (SUB-0010) |
| Adjustment | Any other governed correction (usage correction, pricing correction) reaching the invoice | Always a new linked charge/line on a subsequent document, never an edit to a posted line |

Every correction type requires a mandatory reason code; corrections above a configured amount threshold require maker-checker approval (PRIN-08, SUB-0014).

## 12. Bill explainability

Every invoice line must be explainable entirely from its calculation trace (SUB-0007 §13) and Revenue Lifecycle Graph lineage (SUB-0006) — never from regenerated or AI-inferred prose alone (PRIN-06). "Why is this charge $7,842?" resolves deterministically to: source charge(s) → rating trace → applied rate/tier/discount/guardrail → rounding operation → final amount. If a trace is missing or invalid for any reason, the system states that limitation explicitly rather than producing a plausible-sounding but ungrounded explanation.

## 13. Totals and balance invariants

- `subtotal = sum(pre-discount line bases)` under the configured sign model.
- Discounts, tax, rounding, credits, and adjustments reconcile line-to-document totals with explicit rounding lines where necessary.
- One posted invoice uses one transaction currency.
- `receivable_original_amount = posted_invoice_amount` for collectible invoices.
- `open_amount = original − active payment allocations − active credit allocations − approved write-offs ± reversed allocations`, and can never be negative — excess cash becomes an unapplied/credit balance.

## 14. Dates

| Date/time | Meaning |
|---|---|
| `service_period` | Period in which value was provided; line-level. |
| `invoice_date` | Legal issue/business date. |
| `posted_at` | System instant finalization committed. |
| `due_date` | Business date payment is due. |
| `tax_point_date` | Jurisdiction-specific tax date. |
| `delivered_at` | Provider/user delivery evidence; not the issue date. |

Dates are never inferred from one another after posting; business calendars and time zones are explicit.

## 15. Acceptance criteria

1. Two finalization retries with one idempotency key produce exactly one invoice number, receivable, and journal transaction.
2. A stale preview cannot finalize after a relevant price/usage/tax input changes without revalidation.
3. A posted invoice line cannot be edited through any interface.
4. Partial and final payment allocations update receivable state while document state remains `POSTED`.
5. A credit correction leaves the original invoice intact and produces balanced postings and graph edges.
6. Delivery failure does not cancel or mutate the posted invoice.
7. A cross-tenant charge cannot be included in a draft or inferred through validation errors.
8. Duplicate charge inclusion is blocked even under concurrent billing workers.
9. Invoice totals, receivable original amount, and journal control totals reconcile exactly for golden datasets.
10. Every invoice line's amount is explainable entirely from its calculation trace and RLG lineage.

## Decisions Requiring Product Owner Approval

| ID | Decision needed | Status |
|---|---|---|
| DEC-016 | Default invoice-grouping policy for new tenants (one invoice vs. per-product-family split by default) | Open |
| DEC-017 | Gap-evidence requirement for finalization rollback by launch jurisdiction (§6) | Open |

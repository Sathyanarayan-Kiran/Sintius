# SUB-0010 — Accounting & Revenue Specification

**Document ID:** SUB-0010
**Title:** Accounting & Revenue Specification
**Version:** 0.1 (Draft)
**Status:** Draft
**Owner:** Revenue Accounting SME
**Reviewers:** ERP Integration Architect, Finance Controller, Principal Software Architect, QA/Test Architect
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23
**Dependencies:** [SUB-0004](SUB-0004_Domain_Model.md), [SUB-0005](SUB-0005_State_Machine_Specification.md), SUB-0008 Billing & Invoicing Specification, SUB-0009 Payments & Collections Specification
**Related Documents:** SUB-0017 Integration Architecture (planned)

## 1. Scope and separation of concerns

This specification defines accounts receivable, cash application, credits, write-offs, refund accounting, settlements, revenue recognition, journal generation, and reconciliation. It keeps four concerns explicitly separate, per SUB-0000's product principle that distinct financial facts have distinct lifecycles:

**Billing** (SUB-0008, when a customer is legally charged) is separate from **Cash** (this document §3–§5, when money actually moves) is separate from **Revenue** (this document §7–§8, when value is recognized as earned under accounting policy) is separate from **Accounting** (this document §6, §9, the ledger record of all of the above).

An invoice being posted does not mean revenue is recognized; a payment succeeding does not mean revenue is recognized; only the revenue schedule (§7) determines recognition timing.

## 2. Double-entry accounting concepts

The platform adopts double-entry concepts where appropriate: every `JournalEntry` (SUB-0004 §5.12) is one line of a balanced `JournalTransaction`-equivalent posting event, and every posting event's debits equal its credits per currency. This is enforced as a database-level invariant (a posting transaction that does not balance is rejected outright), not merely an application convention.

## 3. Accounts receivable and customer balance

- Accounts receivable is the sum of open `Receivable`-equivalent balances (tracked via Invoice's receivable dimension, SUB-0005 §3) across an account's posted, collectible invoices.
- Customer/account balance is maintained near real-time as a derived view: `original amount − active allocations − approved write-offs ± reversed allocations` (SUB-0008 §13), never stored as an independently mutable field that could drift from its source transactions.

## 4. Cash application

- Cash application (allocation) is the act of applying a succeeded `Payment` or a `CreditNote`-sourced credit to one or more open receivables.
- Allocation is immutable once created; reversal creates a linked reversing record, never an edit (SUB-0005 §10 Credit Note; SUB-0005 §4 Payment).
- Allocation cannot exceed the source's available amount or the target receivable's open amount — enforced as a database constraint, not only application logic.
- Unapplied cash (overpayment, SUB-0009 §2.8) sits as an account credit balance until explicitly allocated or refunded.

## 5. Credits, write-offs, and refund accounting

| Type | Accounting effect |
|---|---|
| Credit (CreditNote) | Reduces receivable and/or creates account credit balance; balanced reversal/credit journal entries posted atomically with issuance (SUB-0008 §11) |
| Write-off | Reduces open receivable to zero (or a partial amount) without a corresponding cash receipt; posts to a designated write-off ledger account; requires threshold approval (SUB-0009 §4.3, PRIN-08) |
| Refund | Reverses previously recognized cash; posts a balanced reversal entry linked to the original payment's journal entries (SUB-0005 §8); never modifies the original payment-success journal entry in place |
| Gateway fees | Posted as a separate expense-classified journal entry at settlement time (§6), distinct from the gross payment amount, so gross/net reconciliation (§9) remains traceable |

## 6. Settlements

- A `Settlement` (SUB-0004 §5.12) proves provider/bank payout of previously succeeded payments and is structurally distinct from and never overrides canonical `Payment` success (SUB-0005 §4).
- Settlement records gross amount, fees, and net amount per settlement period; fee amounts drive the gateway-fee journal entries in §5.
- A settlement exception (amount mismatch, missing expected settlement) is surfaced as an operator-visible finding (SUB-0006 §9), never silently absorbed into a rounding adjustment.

## 7. Revenue recognition (Enterprise horizon)

- Every invoiced (or, for usage, rated) amount is associated with a `RevenueSchedule` (SUB-0004 §5.12) representing its performance obligation and recognition pattern — reserved in the domain model from MVP even though full recognition automation is Enterprise-scope (SUB-0003 §2, ADR-004 in SUB-ADR-REGISTER).
- Deferred revenue is the portion of billed/collected amount not yet recognized; it is tracked as its own ledger classification, reducible only by the schedule's recognition postings, never by direct adjustment.
- Contract modifications, credits, and refunds each produce a linked revenue-schedule adjustment (SUB-0005 §11) — the original schedule's history is preserved, and adjustments apply prospectively from the modification point unless an approved retrospective restatement is explicitly authorized.
- Revenue recognition patterns supported (Enterprise scope, to be finalized with Revenue Accounting SME sign-off): straight-line over the performance period, point-in-time (e.g., one-time charges recognized on delivery), and usage-consumption-proportional (recognized as usage occurs).

## 8. Allocation rules for recognition (multi-element arrangements)

- A hybrid subscription (SUB-0007 §3.9) with multiple performance obligations (e.g., a platform fee plus a support service) allocates the total transaction price across obligations using each obligation's standalone selling price, consistent with standard multi-element revenue allocation practice — the specific accounting standard's detailed application (e.g., ASC 606/IFRS 15) is confirmed with Finance/Revenue Accounting before Enterprise-horizon implementation (Decision, §12).
- Allocation results are stored as evidence on the `RevenueSchedule`, reproducible from the pinned price version and allocation method version, never re-derived silently from a later configuration state.

## 9. Reconciliation engine

```mermaid
flowchart LR
  Invoice --> Payment
  Payment --> GatewayTx[Gateway Transaction]
  GatewayTx --> Settlement
  Settlement --> Bank[Bank Deposit]
  Bank --> GL[General Ledger]
```

- Automated reconciliation matches Invoice ↔ Payment ↔ Gateway Transaction ↔ Settlement ↔ Bank Deposit ↔ General Ledger export, producing a `ReconciliationMatch` (SUB-0004 §5.12) with confidence and matching-rule evidence for each proposed link.
- Discrepancies (amount mismatch, missing counterpart, timing gap beyond SLO) are flagged as findings, using the same broken-chain finding shape as the Revenue Lifecycle Graph (SUB-0006 §9) so reconciliation exceptions are visible through the same operator tooling as any other lineage gap.
- Reconciliation is Release 2 for full automation; MVP provides the underlying evidence trail (Settlement, JournalEntry records) so no data-model rework is needed when automation is built (SUB-0003 §2).

## 10. ERP posting

- The platform exports balanced business postings and source-document references to the merchant's ERP/general ledger; the platform is authoritative for its own subledger, while the ERP remains authoritative for corporate GL close (SUB-0000 §5 anti-goal "not an ERP clone").
- ERP acknowledgement and batch/control totals are reconciled after export; an ERP-side rejection never silently changes a posted source document on the platform — it surfaces as an operator-visible export exception requiring explicit resolution.
- Export batches are idempotent and replayable; a retried export does not duplicate journal entries on the ERP side, using the same idempotency discipline as every other financial command (SUB-0001 BR-002).

## 11. Accounting event taxonomy

| Event | Emitted when |
|---|---|
| `invoice.finalized.v1` | Invoice posted; receivable and initial journal entries created (SUB-0008 §6) |
| `payment.succeeded.v1` | Payment confirmed; cash/clearing journal entry created (SUB-0005 §4) |
| `payment.allocated.v1` | Allocation applied to a receivable |
| `refund.succeeded.v1` | Refund confirmed; reversal journal entry created (SUB-0005 §8) |
| `credit_note.issued.v1` | Credit note posted; balanced credit/reversal entries created (SUB-0005 §10) |
| `write_off.approved.v1` | Write-off approved and posted |
| `settlement.received.v1` | Settlement evidence received; fee/net entries created (§6) |
| `revenue_schedule.activated.v1` / `.adjusted.v1` / `.completed.v1` | Recognition schedule lifecycle transitions (SUB-0005 §11) |
| `reconciliation.match_proposed.v1` / `.confirmed.v1` / `.exception_raised.v1` | Reconciliation engine outcomes (§9) |

Full event schemas are defined in SUB-0013.

## 12. Example journal entries

**Invoice finalized ($1,200.00 subscription charge, USD):**

| Account | Debit | Credit |
|---|---:|---:|
| Accounts Receivable | 1,200.00 | |
| Deferred Revenue (or Revenue, if recognized immediately) | | 1,200.00 |

**Payment succeeded (full payment of the above invoice):**

| Account | Debit | Credit |
|---|---:|---:|
| Cash/Clearing | 1,200.00 | |
| Accounts Receivable | | 1,200.00 |

**Refund of $200.00 against the above payment:**

| Account | Debit | Credit |
|---|---:|---:|
| Refunds Payable / Revenue reversal | 200.00 | |
| Cash/Clearing | | 200.00 |

**Settlement received ($1,180.00 net after $20.00 gateway fee):**

| Account | Debit | Credit |
|---|---:|---:|
| Bank/Undeposited Funds | 1,180.00 | |
| Gateway Fee Expense | 20.00 | |
| Cash/Clearing | | 1,200.00 |

Every example above is illustrative of the required balance invariant (§2); exact chart-of-accounts mapping is tenant-configurable and finalized in SUB-0012/SUB-0017.

## 13. Immutable ledger principles

1. Journal entries are immutable once posted; corrections use a reversing entry, never an edit or delete (PRIN-05).
2. Every posting event balances per currency at the database-constraint level (§2).
3. A posting event's source document reference (Invoice, Payment, Refund, CreditNote, Settlement) is mandatory — no journal entry exists without an evidenced origin.
4. Reversal and adjustment entries link explicitly to the entry they correct via `CORRECTS`/`REVERSES` (SUB-0006 §4), preserving full lineage through the Revenue Lifecycle Graph.

## 14. Acceptance criteria

1. Every posting transaction's debits equal credits per currency; the database rejects any transaction that does not balance.
2. Customer/account balance is always derivable from and reconciles exactly with its constituent posted transactions.
3. A refund never modifies the original payment's journal entries in place — only a linked reversal exists.
4. Revenue recognized never exceeds the invoiced/collected amount for a given performance obligation at any point in time.
5. A reconciliation exception is visible with evidence within the defined SLO and does not silently self-resolve without a recorded match or explicit dismissal.
6. An ERP export rejection never silently alters the platform's posted source document.
7. Every journal entry is traceable to its source document through the Revenue Lifecycle Graph.

## Decisions Requiring Product Owner Approval

| ID | Decision needed | Status |
|---|---|---|
| DEC-021 | Applicable revenue recognition standard(s) (ASC 606 / IFRS 15 / other) and allocation method for multi-element arrangements | Open |
| DEC-022 | Chart-of-accounts default mapping and per-tenant customization scope | Open |
| DEC-023 | Reconciliation exception SLO and escalation ownership | Open |

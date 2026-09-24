# Implementation handover prompt

> **Superseded for new implementation sessions.** This prompt predates the confirmed TypeScript/Node.js decision and the complete master-requirement normalization. Use [`../HANDOVER_PROMPT_CLAUDE_CODE.md`](../HANDOVER_PROMPT_CLAUDE_CODE.md) for the current Claude Code handover. This file is retained as historical implementation context.

Copy everything below the divider into a new implementation session with access to this workspace.

---

You are beginning production implementation of an AI-native Subscription, Billing, Payments, Collections, Revenue, and Monetization Platform. Two complete pre-engineering documentation suites already exist in this workspace (`docs/pre-implementation/` and `docs/pre-engineering/`) and have been reconciled into one canonical entry point: **`docs/CANONICAL_SPEC_INDEX.md`**. Read that document before anything else — it tells you which source is authoritative for every topic and resolves the handful of places the two suites genuinely disagreed.

## Step zero — confirm gate status before writing any code

Both source suites state, in their own words, that implementation must not begin until their MVP implementation gate is satisfied (`docs/pre-implementation/README.md` "MVP implementation gate"; `docs/pre-engineering/SUB-0021_MVP_Delivery_Backlog.md` closing section). **As of 2026-09-23, the Product Owner (Sathyanarayan Kiran) has resolved the gate** — but read the resolution shape carefully before treating any of these as "settled and no longer your concern":

1. Read the Decision Ledger before starting, to confirm nothing has changed since this handover was written:
   - Live, synced: https://claude.ai/artifact/APc4sxoK74vL8Tg59Z2HNF
   - Local snapshot: `docs/decision-ledger.html`
2. The five previously blocking items now read:

   | Ledger row ID | Decision recorded | What this actually means for you |
   |---|---|---|
   | `launch-countries-tax` | **"Start the implementation with USA"** | Genuinely resolved. Build for a single-country US launch: currency USD, US invoice conventions, a US-scoped tax evidence provider. Do not build multi-country/multi-currency scaffolding speculatively — that's explicitly Release 2 per `docs/CANONICAL_SPEC_INDEX.md` §3. |
   | `stripe-scope` | "Propose options ahead of implementation" | **Not resolved with a value.** Before the Payments module (`SUB-E009` / pre-implementation Phase 3) is finalized, produce a concrete Stripe-scope proposal (account model, regions, methods, Connect vs. non-Connect) scoped to the now-confirmed US-only launch, and get it confirmed. Payments work may start (canonical model, state machines, adapter skeleton) but the Stripe-specific integration is not considered done until this proposal is confirmed. |
   | `rounding-proration` | "Propose options during implementation" | **Not resolved with a value.** Before the pricing engine's golden dataset is frozen (Phase 1 exit), produce a concrete rounding-mode and proration-convention proposal (the working default from both suites is `HALF_UP` + `ACTUAL_DAYS` — propose confirming that default explicitly rather than inventing a new one, unless there's a reason not to) and get it confirmed. The pricing engine may be built against the working default in the meantime, but is not "certified correct" until confirmed. |
   | `ai-autonomy-thresholds` | "Propose options during implementation" | **Not resolved with a value.** No AI agent (`docs/pre-engineering/SUB-0016`) may be enabled above **L0 (insight only, read-only)** until a per-agent autonomy proposal is produced and confirmed. L0-only capability (grounded "Explain my bill," read-only Revenue Copilot queries) may be built now. |
   | `backend-runtime` | "Propose options during implementation" | **Not resolved with a value, and time-critical.** SPIKE-01 (decimal-precision/throughput/team-capability spike) is the literal first task of Phase 0. Repo scaffolding, CI/CD, and module structure cannot proceed past the spike until a runtime is picked and confirmed — this is the one deferred item that still blocks nearly everything else, so do it first, not last. |

3. **If the ledger shows a different status than the table above** (e.g., one of the four "propose" items has since been confirmed with a real value, or a new item has become blocking): stop and reconcile before proceeding — update this table's understanding from the ledger, not from memory of this document.
4. **Do not silently invent an answer for any "propose options" item.** Producing the proposal and getting it confirmed is itself a required, reportable step in the relevant phase (see Working method, item 3) — it is not satisfied by picking a reasonable-sounding default and moving on without confirmation.
5. Once you've confirmed the table above still matches the ledger, proceed to the objective below.

## Objective

Deliver the MVP vertical slice, exactly as already sequenced in `docs/pre-implementation/19-mvp-backlog.md` (Waves 0–5) and `docs/pre-implementation/21-technical-implementation-plan.md` (Phases 0–6):

`create tenant → create customer → activate price → subscribe → ingest usage → preview/finalize invoice → attempt/fail/retry/succeed payment → allocate cash → explain bill → verify audit and lineage`

Do not re-derive this sequencing — it is already dependency-ordered and its rationale is documented.

## Required reading order

1. `docs/CANONICAL_SPEC_INDEX.md` — read first; it routes you to everything else.
2. `docs/pre-implementation/README.md` and `docs/pre-engineering/SUB-INDEX_Document_Register.md` — confirm both suites are still at the status this handover assumes (all documents Draft v0.1 or later; note if either has advanced to Approved Baseline v1.0 since this handover was written).
3. Per the canonical index §3, read the declared primary source for: domain model, state machines, pricing engine (read **both** pre-implementation 12 and pre-engineering SUB-0007 — they are complementary, not redundant), API & event contracts, security & multi-tenancy, AI governance, testing strategy, repository structure & coding standards.
4. `docs/pre-implementation/21-technical-implementation-plan.md` — the phased delivery plan, spike list, and critical-path dependency graph.
5. `docs/pre-implementation/19-mvp-backlog.md` — the 77-item, wave-sequenced backlog.
6. `docs/pre-engineering/SUB-0021_MVP_Delivery_Backlog.md` — apply this document's 12-field story template (persona, intent, business value, preconditions, acceptance criteria, API impact, data impact, events, permissions, UI behavior, observability, technical tasks, test scenarios) to every item in 19's backlog before it enters a sprint. A backlog item is not sprint-ready until this decomposition exists for it.

## Pre-implementation spikes (block Phase 0 exit — from `21` §2)

| Spike | Status |
|---|---|
| SPIKE-01 Runtime choice | **Run this first, literally before any other Phase 0 work.** The Decision Ledger's `backend-runtime` item defers the answer to this spike ("propose options during implementation") — produce the proposal, get it confirmed, then proceed. Do not scaffold a repo in any specific language before this is confirmed. |
| SPIKE-02 Decimal/money library selection | Still required; depends on SPIKE-01's runtime choice. |
| SPIKE-03 Primary-key scheme (ULID vs. UUIDv7) | Cross-reference ledger `primary-key-scheme`; still open, run the spike. |
| SPIKE-04 Usage-table partitioning strategy | Still required; depends on SPIKE-05's output. |
| SPIKE-05 MVP usage throughput and burst profile | Cross-reference ledger `usage-throughput`; still open, run the spike. |
| SPIKE-06 Rounding/proration finance sign-off | **Not yet resolved with a value** — the ledger's `rounding-proration` item defers the answer to this spike ("propose options during implementation"). Produce the `HALF_UP`/`ACTUAL_DAYS`-or-alternative proposal and get it confirmed before Phase 1's golden dataset is frozen; the pricing engine may be built against the working default in the meantime. |

## Established architectural baseline

Treat these as settled; reopening one requires a documented reason recorded as a new Decision Ledger entry, not a silent change mid-implementation.

- Domain-modular application plus independently scalable workers, not premature microservices (`ADR-008` / `ADR-LA-001`).
- PostgreSQL as the MVP system of record (`ADR-011` / `ADR-LA-002`).
- Transactional outbox/inbox for reliable event delivery and consumer deduplication (`ADR-009` / `ADR-LA-003`).
- REST/OpenAPI for external synchronous APIs and versioned CloudEvents-style facts for asynchronous ones — build against `docs/pre-implementation/13`/`14` and the real contract files under `docs/pre-implementation/contracts/`, the only suite with generated OpenAPI/JSON Schema artifacts.
- Provider-neutral canonical payment objects and anti-corruption adapters; Stripe is the first connector, never the domain model (`ADR-LA-006`).
- Persist deterministic pricing results and a typed calculation trace for every billable result (`ADR-PRC-002`).
- Shared SaaS storage in MVP with mandatory tenant keys, application authorization, row-level-security defense in depth, and negative isolation tests from day one — never deferred to later hardening (`ADR-013` / `ADR-LA-008`).
- AI behind a governed advisory gateway, bounded by the L0–L3 autonomy framework; AI cannot write financial state directly or fabricate calculation facts (`ADR-LA-009` + `docs/pre-engineering/SUB-0016`). **Every agent starts and stays at L0 (insight only) until its specific per-agent autonomy proposal (Step Zero, `ai-autonomy-thresholds`) is confirmed** — this is not a default to work around, it is the current state of that decision.
- MVP launch scope is the United States only (Step Zero, `launch-countries-tax`, confirmed 2026-09-23) — single currency (USD), single jurisdiction. Do not build multi-country/multi-currency paths speculatively; that scaffolding is Release 2 per `docs/CANONICAL_SPEC_INDEX.md` §3.
- Revenue Lifecycle Graph as a rebuildable relational node/edge projection, not a required graph database (`ADR-RLG-001`).
- Typed declarative pricing AST with no arbitrary tenant code, high-precision decimal arithmetic, explicit rounding, versioned rules, non-destructive corrections (`ADR-PRC-001`).
- Per `docs/CANONICAL_SPEC_INDEX.md` §2: use `PriceComponent` (not `PriceRule`) in all new code, tickets, and schema; include the `Receivable` and `RiskAssessment` entities explicitly in the physical schema.

## Non-negotiable invariants

The consolidated 11-item list in `docs/CANONICAL_SPEC_INDEX.md` §4 is the authoritative set. Every pull request touching pricing, billing, invoicing, payments, receivables, or collections is reviewed against it before merge — this is not optional tooling, it is the review gate.

## Working method

1. Confirm Step Zero's gate table still matches the live Decision Ledger before any other action in this session.
2. Follow `docs/pre-implementation/21`'s six phases in the stated order. Do not begin Phase *N+1* work until Phase *N*'s exit criteria (stated per-phase in `21` §3) reproduce in a clean environment — not merely "it worked once." Phase 0 specifically does not proceed past repo scaffolding until SPIKE-01 (backend runtime) is proposed and confirmed.
3. Before each phase's work starts, decompose that phase's backlog items (from `19`) into full 12-field stories using the `SUB-0021` template. This decomposition is itself a deliverable, reviewable before code starts. For the three "propose options" items (Stripe scope, rounding/proration, AI autonomy), the proposal-and-confirmation step is itself one such story in the relevant phase (Phase 3, Phase 1, and wherever AI capability is first introduced, respectively) — track it as a real backlog item with its own acceptance criteria ("proposal produced and confirmed by [role]"), not as an implicit side task.
4. Every financially material command handler ships with an idempotent-replay test in the same pull request (`docs/pre-implementation/23` §5.3, `docs/pre-engineering/SUB-0019` §2.3) — no exceptions, no "add tests later" tickets for this specific class of test.
5. Every pull request touching pricing, rating, or billing code runs the full golden dataset (`12` §23 + `SUB-0007` §14) before merge; a diff against golden output for an unchanged engine version is always treated as a defect.
6. The tenant-isolation matrix (`16` §11.1 / `SUB-0019` §6) is release-blocking with zero exceptions starting with the first pull request that touches a tenant-owned table — it is not deferred to a later "hardening" phase.
7. If implementation surfaces a conflict or gap between the two documentation suites that `docs/CANONICAL_SPEC_INDEX.md` didn't anticipate, resolve it the same way this index did (explicit, one-directional, recorded) and update that index — do not silently pick one suite and move on.
8. If implementation surfaces a new open decision, add it to the Decision Ledger (the live artifact, or the local file with a note to sync). Do not create a third, separate decision-tracking list.

## Definition of done

Per `docs/pre-implementation/19` §7 and the master specification's own definition: domain rules implemented, API implemented, UI implemented, authorization implemented, audit implemented, errors handled, accessibility validated, observability implemented, tests passing, API documented, user workflow documented, financial reconciliation tested where applicable. A feature is not done merely because its interface exists.

## Validation before reporting a phase complete

1. Every state-machine transition touched by this phase is exercised by a passing integration test (`24` §2 / `SUB-0019` §2.2).
2. The golden dataset passes in full for any touched pricing/billing code path.
3. The tenant-isolation matrix passes with zero exceptions.
4. An automated scan confirms no `SECURITY_SECRET`- or raw-payment-credential-classified value appears in logs, traces, events, or audit diffs.
5. The specific phase's exit criteria from `docs/pre-implementation/21` §3 reproduce in a clean environment.

## Completion response

At the end of each phase, report: what was built and where in the repository, which backlog items (`19` and/or `SUB-0021`) it closes, test evidence (golden/property/isolation results), whether that phase's "propose options" item (if any — SPIKE-01 in Phase 0, rounding/proration in Phase 1, Stripe scope in Phase 3, AI autonomy whenever AI capability is first introduced) was proposed and confirmed, any new Decision Ledger item opened during the phase, and the next phase per `docs/pre-implementation/21` §3.

---

Begin by executing Step Zero: read the live Decision Ledger, confirm its five-item table still matches what's recorded here, and start Phase 0 with SPIKE-01 (backend runtime) as the very first task — it is the one deferred decision that blocks nearly everything else.

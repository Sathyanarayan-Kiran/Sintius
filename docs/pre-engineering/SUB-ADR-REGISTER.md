# SUB-ADR-REGISTER — Architectural Decision Records

**Document ID:** SUB-ADR-REGISTER
**Title:** Architectural Decision Records
**Version:** 0.1 (Draft)
**Status:** Living document — updated after every new artifact
**Owner:** Principal Software Architect
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23 (through Gate 4: SUB-0019–SUB-0021 — all 22 numbered documents complete)
**Related Documents:** [SUB-INDEX Document Register](SUB-INDEX_Document_Register.md), [SUB-GLOSSARY](SUB-GLOSSARY.md)

Each ADR uses: Decision, Context, Alternatives, Benefits, Risks, Rationale, Consequences. ADR-001–007 derive from domain-level choices made in Gate 1–2 documents; ADR-008–018 are the master prompt's eleven mandatory architecture-topic decisions, formally authored in SUB-0011 (Gate 3) and summarized in this register (§"Mandatory architecture-topic decisions" below).

## Recorded decisions (Gate 1–2 domain-level ADRs)

### ADR-001 — Bounded-depth relational projection for the Revenue Lifecycle Graph

- **Decision:** Store RLG nodes/edges as typed relational projection tables with bounded-depth traversal, not a dedicated graph database, at MVP.
- **Context:** SUB-0006 requires forward/backward lineage traversal from Product to Journal Entry; the primary queries are short, typed lifecycle paths, not deep graph algorithms.
- **Alternatives:** dedicated graph database from day one; live cross-table joins with no projection; event-store-as-graph-source.
- **Benefits:** lower operational overhead, transactional projection updates, familiar tenant-isolation controls, simple rebuild/backup.
- **Risks:** deep or highly connected traversals may become expensive at scale.
- **Rationale:** primary product queries are bounded-depth and known-type; specialized graph infrastructure should follow measured need, not anticipated need.
- **Consequences:** query depth and result size are capped by design; public contracts (SUB-0013) are storage-neutral so a future graph-database migration would not break API consumers.
- **Recorded in:** SUB-0006 §8.

### ADR-002 — Invoice state is three independent dimensions, not one composite enum

- **Decision:** Document state, receivable state, and delivery state are tracked as three separate fields, never merged into one status.
- **Context:** An invoice can simultaneously be posted, partially paid, and delivery-failed — a single enum cannot represent this without contradictions or an unbounded cross-product of values.
- **Alternatives:** one composite status enum; a status plus free-text qualifier.
- **Benefits:** each dimension has a clean, independently testable state machine (SUB-0005 §3); the UI (SUB-0015) can compose a human-readable label without the data model itself being ambiguous.
- **Risks:** requires disciplined UI composition so users are not confused by three separate badges.
- **Rationale:** collapsing distinct lifecycles into one field is a recurring source of billing-system defects industry-wide.
- **Consequences:** every downstream document (API, UX, tests) must treat the three dimensions as independently queryable and independently tested.
- **Recorded in:** SUB-0005 §3.

### ADR-003 — Payment and Payment Attempt are separate state machines

- **Decision:** A logical Payment (one intended amount/currency) and its Payment Attempts (one interaction with one provider/rail each) have independent state machines.
- **Context:** A single payment intent may require multiple provider attempts (retry after decline, gateway failover); collapsing them into one state machine would either lose attempt-level history or force the logical payment's state to oscillate with each attempt.
- **Alternatives:** one combined Payment/Attempt state machine; attempts modeled only as a log with no formal state machine.
- **Benefits:** retries are safe and auditable without corrupting the logical payment's canonical state; an `UNKNOWN` attempt outcome is representable without forcing the logical payment into an incorrect terminal state.
- **Risks:** two state machines must be kept consistent by explicit rules (SUB-0005 §4–§5), adding design and test surface.
- **Rationale:** this separation is the concrete mechanism that prevents duplicate charges under retry (BR-002).
- **Consequences:** every payment-processing implementation must reference both state machines and their consistency rules together, never one in isolation.
- **Recorded in:** SUB-0005 §4–§5.

### ADR-004 — Contract, Entitlement, and Revenue Schedule are reserved domain concepts from MVP

- **Decision:** These three entities exist in the domain model and data model from MVP, even though their full lifecycle/UX/workflow support is Release 2 or Enterprise scope (SUB-0003).
- **Context:** Retrofitting these concepts later risks breaking canonical identifiers already referenced by Subscription, Invoice, and Payment records.
- **Alternatives:** omit these entities entirely until their release horizon; model them as generic extensible metadata instead of first-class entities.
- **Benefits:** SUB-0004's domain model, SUB-0006's lifecycle chain, and future SUB-0012 physical schema never require a breaking migration to introduce these concepts.
- **Risks:** minor schema overhead for capabilities not yet in active use.
- **Rationale:** matches PRIN-14/PRIN-05 — forward compatibility without premature feature-building.
- **Consequences:** SUB-0012 must define these tables now even though SUB-0021's MVP backlog will not build full workflows around them yet.
- **Recorded in:** SUB-0004 §5.5, §5.6, §5.12; SUB-0003 §8.

### ADR-005 — "Tiered" is not a third pricing formula; Volume and Graduated are the two canonical tier behaviors

- **Decision:** The engine implements exactly two tiered-pricing formulas (Volume: one rate for all chargeable units; Graduated: per-slice rates), and every `PriceRule` declaring a tiered model must select one of the two explicitly.
- **Context:** The master prompt lists "tiered," "graduated," and "volume" as three separate pricing models, but "tiered" alone has no independent formula distinct from these two.
- **Alternatives:** invent a third generic "tiered" formula with a configurable selector; treat "tiered" as a synonym for Graduated only.
- **Benefits:** avoids a redundant, ambiguous third code path; keeps the pricing catalog's formulas unambiguous and testable.
- **Risks:** a reader expecting three distinct formulas must be redirected to this clarification.
- **Rationale:** industry practice (and the sibling billing-engine research) converges on exactly these two tier behaviors; inventing a third would only create configuration ambiguity ("which kind of tiered is this?").
- **Consequences:** SUB-0007's golden examples (§14, examples 3–6) explicitly demonstrate both behaviors against identical tier definitions so the distinction is testable, not just asserted.
- **Recorded in:** SUB-0007 §3.3.

### ADR-006 — Four-way separation of Billing, Cash, Revenue, and Accounting

- **Decision:** Billing (legal charge), Cash (money movement), Revenue (recognition timing), and Accounting (ledger record of all three) are modeled and tracked as four distinct concerns with distinct lifecycles, never conflated into "the invoice is the revenue."
- **Context:** A posted invoice does not mean revenue is recognized, and a successful payment does not mean revenue is recognized — conflating these is a common and serious defect class in billing systems.
- **Alternatives:** treat invoice posting as the recognition event (cash-basis-like simplification); treat payment success as the recognition event.
- **Benefits:** supports accrual-basis accounting and deferred revenue correctly from the domain model outward; avoids a costly later redesign when Enterprise-horizon revenue recognition (SUB-0010 §7) is implemented.
- **Risks:** requires care in every downstream document (UX, API) not to imply "billed = earned" in labels or summaries.
- **Rationale:** this is the specific mechanism that keeps SUB-0000's anti-goal ("not an ERP clone") consistent with also correctly supporting revenue recognition for Enterprise customers.
- **Consequences:** SUB-0004's `RevenueSchedule` entity and SUB-0010's four-way separation must be referenced consistently by SUB-0011 (architecture), SUB-0012 (data model), and SUB-0015 (UX) — no later document may present a simplified "invoice = revenue" model.
- **Recorded in:** SUB-0010 §1.

### ADR-007 — Reconciliation exceptions reuse the Revenue Lifecycle Graph's broken-chain finding shape

- **Decision:** A reconciliation discrepancy (SUB-0010 §9) is represented using the identical finding shape (rule/version, affected typed IDs, evidence, severity, owner, resolution) as an RLG broken-chain finding (SUB-0006 §9), rather than a separate, differently structured exception type.
- **Context:** Both problems are structurally the same: an expected relationship between two financial facts did not materialize or does not match.
- **Alternatives:** build a separate reconciliation-exception data model and UI pattern independent of the RLG findings model.
- **Benefits:** one operator-facing pattern (queue, severity model, resolution workflow) serves both use cases; engineering builds and tests one finding pipeline, not two.
- **Risks:** the shared model must remain generic enough to carry both usage-billing gaps and settlement-mismatch evidence without becoming overloaded.
- **Rationale:** avoids duplicating a nontrivial piece of operator tooling for what is conceptually the same class of problem.
- **Consequences:** SUB-0015 (UX) designs one findings/queue pattern reused by both the Revenue Lifecycle Graph screen and any reconciliation-specific view.
- **Recorded in:** SUB-0010 §9.

## Mandatory architecture-topic decisions (authored in Gate 3, SUB-0011)

All eleven master-prompt-mandated architecture ADRs are now formally recorded in [SUB-0011 System Architecture](SUB-0011_System_Architecture.md) §9, using the same Decision/Context/Alternatives/Benefits/Risks/Rationale/Consequences format as ADR-001–007 above. Summarized here for register completeness; full text lives in SUB-0011.

| Topic | ADR ID | Decision summary |
|---|---|---|
| Modular monolith vs. microservices | ADR-008 | Modular monolith with independently scalable workers at MVP; module boundaries enforced regardless of deployment topology |
| Event streaming platform choice | ADR-009 | Transactional outbox now; Kafka-compatible transport once volume warrants it |
| Workflow orchestration engine | ADR-010 | Database-backed durable jobs now; Temporal-style engine when volume/complexity justify it |
| Operational database choice | ADR-011 | PostgreSQL as the sole operational database |
| Ledger model (double-entry implementation) | ADR-012 | Application-enforced double-entry over PostgreSQL constraints, not a specialized ledger database |
| Multi-tenancy isolation model | ADR-013 | Shared database with mandatory tenant keys and RLS defense in depth; dedicated deployment as an enterprise option |
| Financial consistency model | ADR-018 | Strong consistency for posting operations, eventual consistency for projections |
| Search technology | ADR-014 | PostgreSQL-native search initially; dedicated search service only when scale/relevance evidence requires it |
| Analytics storage | ADR-015 | Lightweight semantic layer at MVP; dedicated analytical store when Release 2 reporting scope is built |
| Idempotency implementation mechanism | ADR-016 | Dedicated idempotency-record table plus unique business constraints, not solely client-side deduplication |
| Historical/effective-dated versioning storage strategy | ADR-017 | Immutable version rows with content hash plus optimistic concurrency, not temporal-table auto-versioning |

No mandatory architecture-topic ADR remains in "Planned" status as of Gate 3 completion.

## Change log

| Date | Change |
|---|---|
| 2026-09-23 | Initial population — ADR-001 through ADR-004 recorded from Gate 1; mandatory architecture-topic ADRs listed as Planned pending SUB-0011. |
| 2026-09-23 | ADR-005 through ADR-007 recorded from Gate 2 (SUB-0007–SUB-0010). |
| 2026-09-23 | ADR-008 through ADR-018 — all eleven mandatory architecture-topic ADRs — recorded from Gate 3 (SUB-0011); no ADR remains Planned. |
| 2026-09-23 | Gate 4 (SUB-0019–SUB-0021) reviewed for new architecture/domain decisions; none met the ADR threshold (Gate 4 documents operationalize prior decisions — test strategy, engineering blueprint, backlog conversion — rather than introducing new architectural choices). Register is stable at 18 ADRs (ADR-001–018) as the suite reaches Draft v0.1 completion. |

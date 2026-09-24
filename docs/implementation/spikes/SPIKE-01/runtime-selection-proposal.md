# SPIKE-01 — Backend runtime selection proposal

**Status:** Accepted by Product Owner  
**Date:** 2026-09-23  
**Decision Ledger row:** `backend-runtime`  
**Recommendation:** TypeScript on Node.js 24 LTS for the MVP backend and workers

## 1. Decision

The Product Owner confirmed **TypeScript on Node.js 24 LTS** on 2026-09-23. The alternatives evaluated were:

1. **TypeScript / Node.js 24 LTS — recommended**
2. Kotlin/JVM on JDK 25 LTS
3. Go

The local Decision Ledger now records the confirmed selection and a note to synchronize it to the live artifact when that artifact is accessible. Runtime-specific application scaffolding is therefore unblocked.

## 2. Step Zero verification

The local snapshot `docs/decision-ledger.html` was inspected. Its five blocking rows match the implementation handover exactly:

| Row | Local value |
|---|---|
| `launch-countries-tax` | Start the implementation with USA |
| `stripe-scope` | Propose options ahead of implementation |
| `rounding-proration` | Propose options during implementation |
| `ai-autonomy-thresholds` | Propose options during implementation |
| `backend-runtime` | Propose options during implementation |

The live Claude artifact could not be accessed using either the available interactive browser or direct page retrieval. This confirmation is therefore provisional against the local snapshot. No deferred item is treated as concretely resolved.

## 3. Engineering-ready spike story

**Story ID:** `SPIKE-01`  
**Epic:** `SUB-E001` Platform Foundation

- **Persona:** Principal Software Architect and platform engineering lead.
- **Intent:** Select one backend runtime that protects exact commercial arithmetic while supporting the MVP delivery sequence and independently scalable workers.
- **Business value:** Unblocks repository structure, CI, decimal-library selection, hiring profile, generated server contracts, and every Phase 0 implementation story without silently accepting money-precision risk.
- **Preconditions:** canonical specifications and implementation handover exist; candidate runtimes are TypeScript/Node, Kotlin/JVM, and Go; the Product Owner permits a proposal during implementation.
- **Acceptance criteria:**
  - Given the three candidates, when the same exact arithmetic workload runs, then all produce the same checksum with no binary floating-point commercial arithmetic.
  - Given correctness, throughput, domain-safety, operational, contract-generation, and delivery criteria, when the proposal is reviewed, then one candidate is recommended with risks and mandatory guardrails.
  - Given Product Owner confirmation, when the Decision Ledger is updated, then runtime-specific scaffolding may begin.
  - Until confirmation is recorded, no production runtime scaffold is created.
- **API impact:** Determines generated OpenAPI server target and backend serialization/tooling, but does not alter the canonical API contract.
- **Data impact:** No schema change. All candidates must map PostgreSQL `numeric(38,18)` without binary floating-point conversion.
- **Events:** None.
- **Permissions:** Product Owner confirms; Architecture owns evidence; Finance reviews arithmetic policy in SPIKE-06.
- **UI behavior:** None; frontend remains React/Next.js/TypeScript under every option.
- **Observability:** Benchmark records runtime version, workload, checksum, elapsed time, operations/second, environment, and limitations.
- **Technical tasks:** implement dependency-free cross-runtime benchmark; run three warm measurements; assess architecture/toolchain fit; write recommendation; obtain confirmation; record the decision.
- **Test scenarios:** cross-runtime checksum equality; tier/allowance/proration/discount/minimum/cap/rounding workload; repeat runs; explicit failure if invalid numeric assumptions occur.

## 4. Evaluation criteria

| Criterion | Weight | Why it matters |
|---|---:|---|
| Exact decimal/fixed-point correctness and misuse resistance | 30% | The platform prohibits binary floating point for commercial values. |
| Domain and state-machine modeling | 15% | Pricing ASTs, effective versions, legal transitions, and typed errors dominate complexity. |
| Batch/worker throughput and parallel scaling | 15% | Usage rating and billing workers must scale independently. |
| MVP delivery speed and team accessibility | 20% | The platform must reach the Phase 3 vertical slice before broadening scope. |
| PostgreSQL, OpenAPI, testing, and observability ecosystem | 10% | Contracts and financial integration tests are core engineering workflow. |
| Operational simplicity and resource profile | 10% | MVP intentionally avoids unnecessary infrastructure. |

Team capability data was not available. The recommendation assumes a small product team benefits materially from one language across browser, BFF, domain modules, workers, contract generation, and architecture tooling. If the committed backend team is substantially stronger in Kotlin/JVM, that fact can legitimately reverse the recommendation.

## 5. Benchmark design

The dependency-free harness is documented in [`README.md`](README.md), with source programs under `benchmarks/`. Each candidate performs the same 500,000-rating workload three times after a warm-up:

- quantity and 1,000-unit allowance;
- three graduated tiers;
- rates stored at 18 decimal places;
- `17/31` date-proration factor;
- 7.25% discount;
- $2 minimum and $200 cap;
- `HALF_UP` conversion to cents;
- a cumulative checksum.

This tests exact arithmetic mechanics and CPU direction only. It deliberately excludes database, framework, network, JSON, tracing, contention, and third-party decimal-library behavior. It cannot replace SPIKE-02 or SPIKE-05.

## 6. Results

| Candidate | Exact representation used | Median operations/sec | Checksum | Correctness result |
|---|---|---:|---:|---|
| TypeScript/Node proxy | Node `BigInt`, scale 18 | 1,841,445 | 2,675,064,066 | Pass |
| Kotlin/JVM proxy | Java `BigInteger`, scale 18 | 753,772 | 2,675,064,066 | Pass |
| Go | `math/big.Int`, scale 18 | 387,597 | 2,675,064,066 | Pass |

Raw results and limitations are recorded in [`benchmark-results.json`](benchmark-results.json). Node was approximately 2.4× the JVM proxy and 4.8× Go in this specific single-process fixed-point microbenchmark. This is not a general runtime-performance claim: the Go implementation uses allocation-heavy standard-library big integers, the JVM run used Java rather than compiled Kotlin, and production behavior will be dominated partly by I/O and PostgreSQL transactions.

The important correctness result is that all candidates can implement the required arithmetic exactly. Runtime selection is therefore driven by misuse resistance and delivery/operational fit, not by basic feasibility.

## 7. Candidate analysis

### Option A — TypeScript / Node.js 24 LTS

**Advantages**

- One language and contract type system across Next.js clients, BFF, modules, workers, code generation, and architecture-lint tooling.
- The existing repository design already specifies the TypeScript layout and generated TypeScript contract paths.
- Excellent async I/O fit for APIs, PostgreSQL, outbox dispatch, provider adapters, and webhook delivery.
- Exact fixed-point arithmetic is viable; this benchmark passed and produced the highest directional single-process throughput.
- Independently deployable workers and horizontal process sharding address CPU-bound work without changing domain boundaries.
- Node 24 is an LTS release; the Node project recommends production use of Active or Maintenance LTS releases and lists Node 24 support through April 2028: [Node release schedule](https://nodejs.org/en/about/previous-releases), [Node 22→24 migration](https://nodejs.org/en/blog/migrations/v22-to-v24).

**Disadvantages / risks**

- JavaScript `number` is binary floating point and is dangerously easy to introduce unless types and lint rules make it impossible in commercial code.
- `BigInt` is integer-only, not a complete decimal domain abstraction, and normal JSON serialization requires an explicit boundary representation.
- CPU parallelism needs multiple processes or worker threads; Node documents worker threads as the mechanism for parallel JavaScript execution: [Node worker threads](https://nodejs.org/download/release/v22.15.0/docs/api/worker_threads.html).
- A third-party decimal library or rigorously implemented fixed-point wrapper is still required and must pass SPIKE-02.

**Mandatory guardrails if selected**

1. `platform/money` is the only way domain code creates or manipulates Money, DecimalRate, Quantity, or Percentage.
2. Public and persistence boundaries use strings or `{amount_minor, currency}`; never JSON numbers for commercial values.
3. ESLint/architecture rules ban `number` in commercial value-object constructors, arithmetic functions, price AST operands, and database numeric mappings.
4. PostgreSQL `numeric` values are read as strings and parsed through checked constructors.
5. Runtime overflow/scale/rounding is explicit and traced; no implicit coercion between `bigint` and `number`.
6. Rating/billing workers run as separately scalable processes; no heavy calculation executes on an API event loop.
7. SPIKE-02 must select a decimal strategy and pass the complete golden/property dataset before pricing implementation is certified.

### Option B — Kotlin/JVM on JDK 25 LTS

**Advantages**

- Java `BigDecimal` is immutable arbitrary-precision decimal with explicit scale and rounding control, and Oracle describes it as suitable for currency calculations: [Java math package](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/math/package-summary.html), [BigDecimal](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/math/BigDecimal.html).
- Kotlin interoperates directly with Java and therefore with `BigDecimal`: [Kotlin Java interoperability](https://kotlinlang.org/docs/java-interop.html).
- Sealed types, value classes, exhaustive matching, and strong JVM tooling fit typed pricing ASTs and state machines well.
- Mature enterprise PostgreSQL, transaction, testing, metrics, and service frameworks.
- JDK 25 is the current LTS release according to Oracle: [Java downloads](https://www.oracle.com/java/technologies/downloads/).

**Disadvantages / risks**

- Separate backend and frontend languages increase repository/toolchain/codegen complexity and reduce full-stack mobility.
- Larger memory/startup footprint than Go and typically Node for small services; container sizing must be measured.
- Kotlin compiler/Gradle toolchain is not installed in the current environment, so the benchmark used Java `BigInteger` as a JVM arithmetic proxy rather than Kotlin production code.
- Kotlin's convenient `BigDecimal` operators can carry defaults that conflict with the specification; the official `/` operator documentation states a HALF_EVEN behavior, so commercial arithmetic must use the platform wrapper rather than raw operators: [Kotlin BigDecimal division](https://kotlinlang.org/api/core/kotlin-stdlib/kotlin/div.html).

**When to choose instead**

Choose Kotlin/JVM if the committed backend team is already materially stronger in Kotlin/Java, if enterprise JVM operations are an organizational standard, or if compile-time domain modeling is valued above a unified TypeScript stack enough to accept a slower initial platform build.

### Option C — Go

**Advantages**

- Simple deployment artifact, quick startup, strong standard tooling, low operational overhead.
- Goroutines and channels offer a strong concurrency model; official documentation emphasizes lightweight concurrent execution: [Effective Go](https://go.dev/doc/effective_go).
- Standard `database/sql` supports transactions, cancellation, and managed connection pooling: [Go database documentation](https://go.dev/doc/database/), [transactions](https://go.dev/doc/database/execute-transactions).

**Disadvantages / risks**

- The standard library provides arbitrary-precision integer/rational primitives, not a purpose-built immutable commercial decimal value type: [math/big](https://pkg.go.dev/math/big).
- Mutable `big.Int` APIs make aliasing/allocation mistakes easier without a strict wrapper.
- The benchmark's standard-library exact arithmetic path was the slowest and most variable candidate; this does not disqualify Go, but it removes performance as an automatic reason to prefer it for this domain.
- Less expressive algebraic domain modeling than Kotlin and less contract/code sharing than TypeScript.
- Choosing Go would require rewriting the currently proposed TypeScript-oriented repository/codegen layout more substantially than Kotlin.

**When to choose instead**

Choose Go if the committed engineering team is Go-first and measured production-like worker benchmarks show a clear operational advantage after a decimal library/wrapper is selected.

## 8. Recommendation

Select **TypeScript on Node.js 24 LTS** for the MVP backend, BFF, and worker implementations, with React/Next.js/TypeScript for the web applications.

Rationale:

1. All candidates passed the exact arithmetic feasibility check, so Node is not excluded on correctness grounds.
2. The platform's modular/worker architecture allows CPU-bound rating and billing to scale as separate processes.
3. A unified language materially reduces MVP coordination cost across OpenAPI/event generation, BFF, portal/admin clients, module tooling, and architecture-lint enforcement.
4. The pre-implementation repository specification already provides an implementation-ready TypeScript shape.
5. Node 24 LTS is already installed in the workspace and is a production-supported line.
6. The largest Node risk—accidental binary floating-point money—is controllable only if the mandatory guardrails above are implemented in Phase 0 and verified by SPIKE-02. The recommendation is invalid without those controls.

The recommendation does **not** certify pricing throughput or the decimal implementation. SPIKE-02 still selects the exact decimal/money implementation; SPIKE-05 defines throughput/burst targets; those results can trigger a later extraction or specialized rating worker without forcing the core domain API to change.

## 9. Decision and implications

### Proposed ADR — TypeScript/Node for the MVP backend

- **Decision:** Use strict TypeScript on Node.js 24 LTS for the modular backend application and independently scalable workers.
- **Alternatives considered:** Kotlin/JVM on JDK 25 LTS; Go.
- **Advantages:** unified product stack, fastest contract/tooling path, installed supported runtime, strong I/O model, directional exact-arithmetic benchmark headroom.
- **Disadvantages:** no native decimal type, easy accidental `number` misuse, explicit CPU-worker/process strategy required.
- **Rationale:** best balance of MVP delivery speed and sufficient correctness/performance when protected by mandatory financial types and tests.
- **Implications:** SPIKE-02 becomes a release-blocking selection of the decimal/money strategy; repository scaffolding follows deliverable 22's TypeScript layout; worker deployments are separate processes; commercial arithmetic lint rules are installed before the first money path.

## 10. Confirmation gate

Required confirmation statement:

> Confirm TypeScript on Node.js 24 LTS as the MVP backend runtime, subject to the mandatory money/decimal guardrails and SPIKE-02 passing the complete golden dataset.

If confirmed:

1. Update the authoritative Decision Ledger row `backend-runtime` with the concrete value and confirmer/date.
2. Scaffold the TypeScript monorepo from deliverable 22.
3. Run SPIKE-02 immediately and implement `platform/money` before any commercial module.
4. Continue Phase 0 story decomposition and foundation code in the dependency order from backlog 19.

If declined, select Kotlin/JVM or request team-capability evidence; no runtime-specific scaffold has to be discarded because none has been created.

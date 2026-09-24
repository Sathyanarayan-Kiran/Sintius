# Coding standards

**Version:** 0.1
**Status:** Proposed MVP baseline
**Related:** [Repository structure](22-repository-structure.md), [Pricing engine specification](12-pricing-engine-specification.md), [API specification](13-api-specification.md), [Event taxonomy](14-event-taxonomy.md), [Security architecture](15-security-architecture.md)

## 1. Purpose

These standards are deliberately narrow: they codify the rules that protect the platform's critical invariants (PRD §8) and are most likely to be violated by an individual code change made without full context, not a general style guide. General style (formatting, linting, naming conventions for non-financial code) is enforced by automated formatter/linter configuration and is not repeated here.

## 2. Money

1. **Never use binary floating point for any commercial value.** All money uses `platform/money`'s fixed-precision type (integer minor units + ISO 4217 currency for settled/display amounts; `numeric(38,18)`-equivalent decimal for intermediate rates), matching deliverable 12 §13 and deliverable 07 §1. A `float`/`double` type must never appear in a type signature that touches Money, Quantity, or Percentage.
2. **Arithmetic across mismatched currencies is a compile-time or immediate-runtime error**, never a silent coercion.
3. **Rounding happens exactly where the pricing specification says it happens** (deliverable 12 §13: once per component/line output, `HALF_UP` default) — a developer may not introduce an additional ad hoc rounding step "to make totals look right." If totals don't reconcile, the bug is upstream, not fixed by adding a rounding call at the point of display.
4. **Every money value crossing the API boundary serializes per deliverable 13 §12** (`{amount_minor, currency}`), enforced by the generated contract types (deliverable 22 §7) — hand-written serialization of a money field is not permitted.
5. **A negative money amount requires an explicit type/field indicating why** (credit, refund, reversal) — an untyped negative number flowing through billing/receivables code is treated as a defect, per deliverable 12 §12 "amount cannot become negative; credits are explicit corrective charge types."

## 3. Time

1. **Every instant is stored and transmitted as UTC** (`timestamptz`/RFC 3339 `Z`); business dates use a plain date type with an explicit associated time zone field where relevant (deliverable 07 §1, deliverable 13 §12) — never a naive local-time value with an implicit assumed zone.
2. **`requested_at`, `effective_at`, and `recorded_at` (or their state-machine-specific equivalents like `occurred_at`) are distinct fields and are never collapsed into one** — code that infers one from another is a defect (deliverable 08 §7, deliverable 14 §3).
3. **Proration and calendar arithmetic use the account's business time zone and the `ACTUAL_DAYS` date-count convention exactly as specified** (deliverable 12 §11) — DST transitions must not change a service-day count; this is a mandatory unit test for any date-arithmetic change, not an incidental one.
4. **No code path uses the system clock (`now()`) inside deterministic pricing/rating logic.** Rating takes `effective_at`/`service_period` as explicit input (deliverable 12 §14 prohibited-behavior list: "current clock access" is disallowed inside the rule engine); only the orchestration layer that invokes rating may read the clock, and it passes the value in explicitly.
5. **Every date/time displayed to a user states or defaults to business time zone with UTC available on demand** (deliverable 17 §8.3) — a raw UTC timestamp shown to a non-technical user without zone context is a UX defect, not just a nicety.

## 4. Tenant context

1. **No function signature in `modules/*/application` or `modules/*/domain` accepts `tenant_id` as an untyped parameter sourced from a request body.** It is injected exclusively from `platform/tenant-context`, resolved once at the authentication boundary (deliverable 16 §1, deliverable 15 §4.1). A code reviewer must reject a change that reads `tenant_id` from `req.body` anywhere below the API entry layer.
2. **Every repository query against a tenant-owned table includes the tenant filter as a structural part of the query-building helper**, not as an ad hoc `WHERE` clause a developer might forget to add (deliverable 16 §2 Layer 1) — new query helpers are built on a shared tenant-scoped base, not written from scratch per module.
3. **Every background job payload carries a signed/trusted tenant field, re-validated at the start of every transaction the job performs**, not only at enqueue time (deliverable 16 §1, ADR-LA-008).
4. **A test that asserts cross-tenant access is denied is mandatory for any new endpoint or query path** touching a tenant-owned table — this is enforced by a CI check requiring at least one isolation-test reference per new route (ties to deliverable 16 §11.1).

## 5. Idempotency

1. **Every command that produces a financial or lifecycle-changing effect requires an idempotency key on its handler signature** — a handler for such a command that does not accept/require one is a defect caught by an architecture-lint rule (deliverable 22 §8) checking the command's declared classification against its signature.
2. **The idempotency check and the domain effect commit in the same transaction** (deliverable 13 §8) — a handler must never commit the domain effect and then separately write the idempotency record, because a crash between the two steps would silently reintroduce the duplicate-effect risk the pattern exists to prevent.
3. **A handler must be written to be safely callable twice with the same key/input and produce the identical stored result on the second call** — this is verified by a required "replay produces identical result" unit test for every command handler in this category (deliverable 12 §16, deliverable 24 §4).
4. **Retry logic in any client/worker code never generates a new idempotency key for what is logically the same attempt** — a new key is only generated for a genuinely new business intent (e.g., a new `Payment`, not a retried attempt of an existing one, per deliverable 10 §4).

## 6. Events

1. **A domain event is written only from inside the same transaction as the state change it describes**, using `platform/outbox-client` (ADR-LA-003) — no code path publishes an event through a direct broker/queue call outside a transaction.
2. **Event payloads are constructed from the module's typed event schema (`modules/*/domain/events`, generated from `contracts/events/`), never a hand-assembled untyped object** — this prevents payload drift from the registered JSON Schema (deliverable 14 §9).
3. **No event payload includes a field classified `SECURITY_SECRET` or raw payment credential** (deliverable 14 §8) — a payload-content lint/test scans every emitted event type's schema for disallowed field patterns as part of CI.
4. **Consumers are idempotent by construction**: every consumer handler checks its inbox/checkpoint state before applying an event's effect, using the same pattern for every module rather than a bespoke dedup check per consumer (deliverable 03 §8).
5. **A consumer never assumes cross-aggregate ordering** — if a handler's correctness depends on another aggregate's event having already been processed, it must explicitly check that precondition (via state read or `causation_id`) rather than relying on delivery order (deliverable 14 §5).

## 7. Errors

1. **Every API error response is constructed through `platform/problem-model`**, producing the canonical shape from deliverable 13 §11 — a handler must not return a bespoke error body.
2. **A rejected command creates no partial financial effect.** If a validation failure is discovered after some work has begun within a transaction, the transaction rolls back completely; "fix it up afterward" compensating code is not an acceptable substitute for correct transactional scoping.
3. **`detail` text is safe-for-display by construction** — no error-message string interpolates raw exception messages, stack traces, or data from another tenant; the problem-model helper enforces an allowlist of safe fields per error `code`.
4. **A `404` for "not found" and a `404` for "exists but you're not authorized to know that" use the identical response shape** (deliverable 13 §11.4) — a developer must not special-case the message text differently for the two cases in a way that reintroduces existence leakage.
5. **An `UNKNOWN`/ambiguous external-system outcome (provider timeout, ambiguous webhook) is modeled as its own explicit state**, never silently mapped to either success or failure "to keep the code simple" (deliverable 10 §3).

## 8. Logs

1. **Every log line is structured (not a free-text `printf`-style string) and includes `tenant_id`, `correlation_id`, and, where applicable, `causation_id`** via `platform/observability` — a raw `console.log`/`println` in application code outside test/dev scaffolding is a lint failure.
2. **No log statement includes a field classified `RESTRICTED_FINANCIAL` or `SECURITY_SECRET` in raw form** (deliverable 15 §9.2) — the observability helper redacts these by field-classification metadata, not by developer discipline alone; a developer manually string-concatenating a monetary value into a log message bypasses this protection and is treated as a security defect, not a style nit.
3. **Log level reflects operational actionability, not developer convenience** — `ERROR` is reserved for conditions requiring operator attention; expected/handled business rejections (e.g., a declined payment) log at `INFO`/`DEBUG` with structured reason codes, not `ERROR`, to keep alerting signal meaningful (deliverable 05 §9).
4. **High-cardinality values (customer email, free-text usage dimensions) are never used as metric labels**, only as structured log fields where appropriate and permitted by data classification (deliverable 04 §6 "no high-cardinality PII in metrics").

## 9. Migrations

1. **Every migration is owned by exactly one module** (deliverable 22 §3, §8) and lives under that module's `infra/migrations/` directory — a migration touching another module's tables is rejected by architecture-lint.
2. **Migrations follow expand/migrate/contract sequencing** (deliverable 07 §10): add the new column/table nullable or defaulted → backfill in a restartable, checksummed, tenant-bounded job → enforce the new constraint only after backfill is verified complete → remove the old shape in a later migration, never in the same deploy as the expand step for anything at production scale.
3. **A migration that adds a `NOT NULL` constraint to an existing large table populates and validates in stages**, never a single blocking `ALTER TABLE ... SET NOT NULL` against an unbacked column at scale (deliverable 07 §10).
4. **A financially material migration (touching invoice, payment, ledger, or idempotency tables) requires a paired reconciliation script** comparing source/target control totals or counts, run and recorded as part of the migration's review, not merely "it applied without error" (deliverable 07 §10 "Financial migration uses source/target control totals... dry runs, and signed cutover evidence").
5. **Every migration is reversible or explicitly documented as irreversible with a stated reason** before merge — a silent one-way migration on a table with financial or audit data is not acceptable without an explicit, reviewed exception.

## 10. Accessibility

1. **Every new interactive component ships with keyboard operability and a screen-reader-accessible label as part of the same change, not a follow-up ticket** (deliverable 17 §6.2, §6.4).
2. **Status/state/risk indicators that use color always pair color with text or icon** — a pull request introducing a color-only status dot for a new field is rejected in review (deliverable 17 §6.4, §8.1, §8.4).
3. **Every chart or visualization ships with an accessible data-table alternative in the same change** (deliverable 17 §6.4, deliverable 18 §1).
4. **Focus management is explicit for every modal/drawer/dialog**: focus moves into it on open, is trapped within it, and returns to the triggering control on close — verified by an automated accessibility test (axe-core or equivalent) as part of the component's test suite, not manual QA alone.
5. **WCAG 2.2 AA is the release bar for both Admin and Portal** (deliverable 01 §9); a known AA violation blocks release of the screen it affects unless an explicit, time-bound, tracked exception is approved.

## 11. Cross-cutting review checklist

A pull request touching financially material code (pricing, billing, invoicing, payments, receivables, collections) is not approvable without the reviewer confirming:

1. No `float`/`double` in the diff's money/quantity/percentage paths (§2).
2. Tenant context is sourced only from `platform/tenant-context`, never a request body field (§4).
3. Idempotency key handling is present and covered by a replay test for any new financial command (§5).
4. The domain-event write (if any) is in the same transaction as the state change (§6).
5. Errors use `platform/problem-model` and introduce no new existence-leak or raw-detail exposure (§7).
6. No raw financial/secret value appears in a new log statement (§8).
7. Any accompanying migration follows expand/migrate/contract and, if financially material, ships with a reconciliation script (§9).
8. Any new interactive UI element meets the accessibility bar in §10 within the same change.

## 12. Acceptance criteria

1. A CI lint rule exists and fails the build for at least one representative violation per section (§2–§10) — these are automated gates, not merely documented expectations.
2. The cross-cutting review checklist (§11) is embedded in the pull-request template for the repository so it cannot be silently skipped.
3. Every financially material command handler in the codebase has a corresponding idempotent-replay test (§5.3) before it is considered done per deliverable 19 §7's definition of done.
4. No merged change introduces a `console.log`/unstructured log statement in application code outside test scaffolding (§8.1), verified by lint.
5. Accessibility automated tests run in CI for every screen listed in deliverable 18 and block merge on a new AA violation (§10.5).

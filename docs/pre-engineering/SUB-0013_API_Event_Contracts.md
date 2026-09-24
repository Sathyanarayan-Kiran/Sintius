# SUB-0013 — API & Event Contracts

**Document ID:** SUB-0013
**Title:** API & Event Contracts
**Version:** 0.1 (Draft)
**Status:** Draft
**Owner:** Principal Software Architect
**Reviewers:** Billing and Rating Architect, Payments Architect, Security Architect, QA/Test Architect
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23
**Dependencies:** [SUB-0004](SUB-0004_Domain_Model.md)–[SUB-0011](SUB-0011_System_Architecture.md), [SUB-0012](SUB-0012_Data_Architecture_ERD.md)
**Related Documents:** SUB-0014 Security, Privacy & Compliance Architecture (planned), SUB-0016 AI & Agent Governance Specification (planned)

## 1. REST conventions and URL patterns

- Resource collections are plural, kebab-case: `/customers`, `/payment-methods`.
- A financial state transition is an explicit command sub-resource, never a generic `PATCH` with a status field: `POST /invoices/{id}/finalize`, never `PATCH /invoices/{id} {"status":"posted"}` — this is the concrete mechanism preventing a client from bypassing the state machines in SUB-0005 (BR-010, PRIN-07 — API parity with UI means the API expresses the same guarded commands the UI would).
- Path segment `{id}` is always the platform-generated ID (SUB-0012 §1), never a guessable sequence; business-key lookup is a query filter (`?invoice_number=INV-20381`), not a second path scheme.

## 2. OpenAPI and versioning

- The full API surface is published as an OpenAPI 3.1 document, generated client SDKs included (SUB-0020, planned).
- Version is a URL path segment (`/v1/...`); a breaking change requires a new major version served alongside the prior one for a published deprecation window (Decision, §12).
- Non-breaking: new optional request field, new response field, new endpoint, new optional filter, new value in a field documented as an **open enum**. Breaking: field removal/rename, type/semantic change, tightened validation rejecting previously valid requests, default-behavior change. Canonical domain-state enums (subscription state, invoice document state, payment state — SUB-0005) are **closed**; extensible fields (e.g., collection action channel) are **open**.

## 3. Authentication and authorization

- Authentication: OIDC/SAML for human sessions (Admin, Portal), OAuth2 client-credentials or scoped API key for server-to-server integration, short-lived signed tokens for narrow subscriber actions (e.g., a payment link) — full detail in SUB-0014.
- **Tenant derivation rule (non-negotiable):** `tenant_id` is resolved exclusively from the authenticated credential/session context, never accepted as an untrusted request body/query field. A body field present for idempotency-hash stability is validated against, never substituted for, the resolved tenant; mismatch returns `403 tenant_mismatch`.
- Authorization combines RBAC with optional ABAC (SUB-0014); a financially sensitive command additionally checks maker-checker policy (SUB-0000 PRIN-08) before the domain transaction begins.

## 4. Pagination, filtering, sorting

- Cursor-based pagination only for tenant-scoped collections: `?limit=50&cursor=<opaque>`, response `{ "data": [...], "next_cursor": ..., "has_more": true }` — never a bare array, and no offset/page-number pagination (avoids expensive counts under row-level security and keeps results stable under concurrent writes).
- Filtering: exact match `field=value`; documented range/set operators (`created_at.gte=`, `status.in=`); only indexed, documented filters are accepted.
- Sorting: `?sort=-created_at,invoice_number`; default sort always includes a deterministic tiebreaker so pagination cursors are stable.

## 5. Idempotency

- Every endpoint that creates a financial or lifecycle-changing effect requires `Idempotency-Key` (SUB-0011 ADR-016).
- Server behavior: compute a canonical request hash; no prior record → process and store the outcome atomically with the domain transaction; same key + same hash → return the original response verbatim; same key + different hash → `409 idempotency_key_reused_with_different_payload`; a concurrent in-flight duplicate → `409 request_in_progress` with `Retry-After`.
- `usage-events` ingestion additionally uses source-event identity `(tenant_id, source, source_event_id)` as its natural idempotency key (SUB-0012 §4.5); `Idempotency-Key` is accepted but the source-event uniqueness constraint is authoritative.

## 6. Correlation IDs

Every request carries or receives `X-Correlation-Id`; a command issued as a consequence of an upstream event/command additionally carries `X-Causation-Id`. Both propagate into the domain command, the outbox event envelope (§9), audit records, provider calls where supported, and structured logs (SUB-0011 §12).

## 7. Optimistic locking

Every mutable aggregate resource returns `ETag: "<row_version>"`. State-changing requests should send `If-Match`; a stale value returns `412 Precondition Failed` with the current resource. Domain aggregates are never mutated via generic `PATCH` (§1), so concurrency conflicts always surface through a named command endpoint with the resource's current state attached.

## 8. Errors and retries

- All errors use an RFC 9457-shaped problem body: `type`, `title`, `status`, `code`, `detail` (safe for display, never another tenant's data or a stack trace), `correlation_id`, optional field-level `errors[]`.
- `404` for "not found" and `404` for "exists but you're not authorized to know that" use the identical shape and latency profile — no existence leakage across tenants (SUB-0014).
- An `UNKNOWN`/ambiguous external outcome (SUB-0009 §2.4/§2.6) returns `202`/`409 reconciliation_required`, never an ordinary retryable error that could tempt a client into a duplicate-attempt retry loop.
- Standard status codes: `400` malformed, `401` unauthenticated, `403` unauthorized/tenant-mismatch, `404` not found/no-leak, `409` state/idempotency/concurrency conflict, `412` precondition failed, `422` semantically invalid, `429` rate limited, `500`/`503` server/dependency fault.

## 9. MVP endpoint catalog

| Resource group | Representative endpoints | Governing spec |
|---|---|---|
| `/customers` | `GET/POST /customers`, `GET /customers/{id}` | SUB-0004 §5.2 |
| `/accounts` | `GET/POST /accounts`, `GET /accounts/{id}/balance` | SUB-0004 §5.2, SUB-0010 §3 |
| `/products` | `GET/POST /products`, `POST /products/{id}/versions`, `POST /product-versions/{id}/publish` | SUB-0004 §5.3 |
| `/plans` | `GET/POST /plans`, `GET /plans/{id}` | SUB-0004 §5.3 |
| `/prices` (rate cards) | `GET /rate-cards/{id}`, `POST /rate-cards/{id}/submit-approval`, `POST /rate-cards/{id}/activate`, `POST /pricing/validate`, `POST /pricing/simulations` | SUB-0007 §5, §11–§12 |
| `/subscriptions` | `POST /subscriptions`, `POST /subscriptions/{id}/submit`, `/activate`, `/pause`, `/resume`, `/cancel`, `/terminate`, `POST /subscriptions/{id}/preview-change` | SUB-0005 §2 |
| `/usage-events` | `POST /usage-events`, `POST /usage-events:batch`, `POST /usage-events/{id}/corrections` | SUB-0004 §5.7 |
| `/invoices` | `POST /billing-runs`, `POST /invoices/{id}/finalize`, `/void`, `POST /invoices/{id}/credit-notes`, `POST /invoices/{id}/write-off` | SUB-0005 §3, SUB-0008 §6 |
| `/payments` | `POST /payments`, `POST /payments/{id}/attempts`, `/cancel`, `POST /payments/{id}/refunds` | SUB-0005 §4–§5 |
| `/payment-methods` | `POST /accounts/{id}/payment-methods`, `POST /payment-methods/{id}/verify`, `DELETE /payment-methods/{id}` | SUB-0009 §2.3 |
| `/refunds` | `GET /refunds/{id}` | SUB-0005 §8 |
| `/credits` | `GET /accounts/{id}/credit-balance`, `POST /accounts/{id}/credits` | SUB-0010 §5 |
| `/collections` | `GET /accounts/{id}/collection-summary`, `GET/POST /collection-cases`, `POST /collection-cases/{id}/actions/{action_id}/execute` | SUB-0009 §4–§7 |
| `/webhooks` | `GET/POST /webhook-endpoints`, `GET /webhook-endpoints/{id}/deliveries`, `POST .../replay` | §10 below |

Full OpenAPI operation definitions (request/response schemas, permissions) are elaborated during Gate 4 backlog conversion (SUB-0021); this table fixes the contract shape and governing behavior now so downstream planning has a stable target.

## 10. Signed outbound webhooks

- Payload: identical CloudEvents-style envelope as §11's domain events; delivery adds `Webhook-Id`, `Webhook-Timestamp`, `Webhook-Signature` (`v1,<HMAC-SHA256>`), supporting dual-secret rotation.
- Delivery is at-least-once with bounded exponential backoff (default 72-hour window), after which a delivery is marked `FAILED` and surfaced to the merchant operator; consumers deduplicate by `Webhook-Id`.
- Replay (`POST /webhook-endpoints/{id}/deliveries/{delivery_id}/replay`) re-sends the exact persisted envelope under a new delivery ID — it never regenerates or mutates the underlying domain fact.

## 11. Domain events

Envelope (CloudEvents-style): `id`, `source`, `type` (`com.subrevos.<context>.<past_tense_fact>.v<N>`), `time`, `tenant_id`, `aggregate_type`/`aggregate_id`/`aggregate_version`, `correlation_id`/`causation_id`, `actor`, `occurred_at`/`recorded_at` (distinct — see SUB-0006 §10 for why), `data_classification`, `data`.

| Event | Producer | Consumers | Ordering scope | Replay | Dead-letter |
|---|---|---|---|---|---|
| `customer.created.v1` | Customer context | Search/RLG projectors, merchant webhooks | Per aggregate | Internal replay + webhook replay (§10) | Per-consumer DLQ, operator-visible |
| `subscription.created.v1` | Subscriptions context | Billing, RLG, merchant webhooks | Per subscription | Same | Same |
| `subscription.changed.v1` | Subscriptions context | Billing, Entitlements, RLG, merchant webhooks | Per subscription | Same | Same |
| `subscription.cancelled.v1` | Subscriptions context | Billing, Collections, RLG, merchant webhooks | Per subscription | Same | Same |
| `usage.received.v1` | Usage ingress (public, aggregate-level — see SUB-0006 rationale for coarser public granularity) | Merchant webhooks | Per subscription item | Same | Same |
| `usage.rated.v1` | Rating context (internal) | Billing | Per aggregate/rated result | Internal replay only | Internal DLQ |
| `invoice.generated.v1` (draft) | Billing context | RLG (internal) | Per invoice | Internal | Internal DLQ |
| `invoice.finalized.v1` | Billing context | Receivables, Revenue & Accounting, RLG, merchant webhooks | Per invoice | Same | Same |
| `payment.attempted.v1` | Payments context (internal) | Collections | Per payment | Internal | Internal DLQ |
| `payment.failed.v1` | Payments context | Collections, RLG, merchant webhooks | Per payment | Same | Same |
| `payment.succeeded.v1` | Payments context | Receivables, RLG, merchant webhooks | Per payment | Same | Same |
| `refund.completed.v1` | Payments context | Revenue & Accounting, RLG, merchant webhooks | Per payment | Same | Same |

Each event's full JSON Schema is registered and version-controlled (SUB-0012's storage of the outbox table supports this); a schema change that would break a currently-registered consumer fails CI before merge, matching the deprecation-window discipline in §2.

### 11.1 Ordering, delivery, replay, dead-lettering (cross-cutting rules)

- **Ordering:** guaranteed only within one `(tenant_id, aggregate_type, aggregate_id)` stream — never globally.
- **Delivery:** at-least-once everywhere; every consumer is idempotent by construction (inbox/checkpoint pattern, SUB-0011 §7).
- **Retry:** bounded exponential backoff per consumer; a repeatedly failing event moves to a per-consumer dead-letter queue with reason and attempt history, visible to operators with a safe replay control — dead-lettering never blocks delivery to unrelated consumers.
- **Public vs. internal separation:** every event type is explicitly classified public (webhook-eligible) or internal; Collections/risk-scoring events (SUB-0009 §5) are never webhook-eligible, consistent with keeping sensitive scoring detail behind an authenticated pull API (`/accounts/{id}/collection-summary`) rather than a push stream.

## 12. Acceptance criteria

1. Every endpoint in §9 has a documented permission requirement, idempotency requirement (where financially material), and error-response shape.
2. Every financial command endpoint requires `Idempotency-Key` and is covered by a duplicate-request contract test.
3. Every domain-state-changing endpoint's legal preconditions match SUB-0005's transition tables exactly.
4. No response schema contains a bare JSON number for a monetary or quantity field — money/quantity always serialize as the typed shape defined in SUB-0007 §13/SUB-0012 §1.
5. A cross-tenant ID probe against any endpoint returns the standard non-leaking `404` shape with no measurable latency signal above documented tolerance.
6. Webhook payload schemas are identical in structure to the corresponding domain fact schema, differing only by delivery envelope headers.
7. Collections/risk-scoring events never appear in the webhook-eligible classification (automated registry check).

## Decisions Requiring Product Owner Approval

| ID | Decision needed | Status |
|---|---|---|
| DEC-028 | API deprecation window length before the first breaking change | Open |
| DEC-029 | Default and maximum `usage-events:batch` size under real ingestion load | Open |
| DEC-030 | Whether GraphQL is offered alongside REST for read-heavy admin composition (Release 2 candidate) | Open |

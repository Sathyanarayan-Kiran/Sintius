# API specification

**Version:** 0.1
**Status:** Proposed MVP contract baseline
**Related:** [Domain model](03-domain-model.md), [Data model / ERD](07-data-model-erd.md), state machines [08](08-subscription-state-machine.md)–[11](11-collection-state-machine.md), [Pricing engine specification](12-pricing-engine-specification.md)
**Machine-readable contracts:** [`contracts/openapi/mvp-vertical-slice.yaml`](contracts/openapi/mvp-vertical-slice.yaml)

## 1. Purpose and scope

This specification governs the external synchronous API surface for the MVP vertical slice: customers, accounts, products/plans/rate cards, subscriptions, usage events, invoices, payments, payment methods, credits, notifications, and webhooks. It reflects the state machines and pricing semantics already approved in deliverables 08–12; it does not introduce new domain behavior.

Financial commands (finalize invoice, attempt payment, refund, credit, write-off) are explicit action endpoints with their own permissions, not implied by generic `PATCH`/`PUT` on a resource. This mirrors ADR-LA-005 (REST/OpenAPI for synchronous commands, versioned facts for asynchronous ones).

## 2. Design principles

1. **Resources for read/query; commands for state-changing intent.** A resource collection (`GET /invoices`) is CRUD-shaped for reads only. Mutations that correspond to a domain transition use a named action sub-resource (`POST /invoices/{id}/finalize`), never an overloaded `PUT`.
2. **The API mirrors canonical state, not provider state.** Payment/invoice/subscription fields use the vocabulary from deliverables 08–11; Stripe- or gateway-specific values never appear in public response bodies.
3. **Every mutating request is authorized, idempotent where retry risk exists, and audited.** This is enforced at the BFF/API layer (deliverable 05 §4) before a domain command is constructed.
4. **Contracts are additive by default.** Breaking changes require a new API version per §5.
5. **No untrusted body field can assert identity or tenant.** Tenant, actor, and permission scope come only from authenticated context (deliverable 04 §3, ADR-LA-008).

## 3. Authentication and tenant derivation

| Caller | Mechanism | Tenant derivation |
|---|---|---|
| Merchant operator / finance / support (Admin web) | OIDC/SAML session via IdP, short-lived access token, MFA per policy | Resolved from `UserMembership` for the authenticated subject; a user with memberships in multiple tenants selects an active tenant context per session, carried as a signed claim, not a request parameter |
| Merchant developer (server-to-server) | OAuth 2.0 client-credentials or scoped API key bound to one tenant | Tenant is a property of the credential; a credential is never valid across tenants |
| Merchant developer (console/user-delegated) | OIDC authorization-code flow with PKCE | Same as Admin web |
| Subscriber (Customer Portal) | Portal session (email/passwordless or configured IdP) scoped to one Account | Tenant and Account derived from portal session; an `account_id` in a request body is validated against, never substituted for, the session's account |
| Subscriber (signed payment link) | Short-lived, single-purpose signed token (JWS) | Tenant, account, and permitted action embedded and verified server-side; no broader session is granted |
| Platform scheduler / internal workers | Workload identity (mTLS or signed service token) | Tenant carried as a trusted, signed field per job, re-validated every transaction (ADR-LA-008) |

**Rule (non-negotiable):** `tenant_id` supplied in a request body or query string is never trusted. If present for convenience or idempotency-hash stability, it MUST match the authenticated context or the request is rejected with `403 tenant_mismatch`. This is the concrete mechanism satisfying deliverable 16 §"untrusted request body."

Every request requires:

- `Authorization: Bearer <token>` or equivalent signed credential;
- `X-Correlation-Id` (optional on input; always echoed and generated if absent);
- `Idempotency-Key` (required on defined mutating endpoints; see §8).

## 4. Authorization and permission examples

Authorization combines RBAC (role → permission) with optional ABAC (resource attribute conditions) and maker-checker (deliverable 15 will define the full model; this section fixes the API-visible contract).

| Permission | Example roles granted (illustrative; role catalog owned by deliverable 15) | Enforcement point |
|---|---|---|
| `billing:invoice:preview` | Billing Administrator, Finance Controller | Domain command authorization + row scope |
| `billing:invoice:finalize` | Billing Administrator (below threshold), Finance Controller (any) | Command authorization + maker-checker policy evaluation |
| `pricing:rate_card:activate` | Pricing Manager (proposer), Finance Controller (approver) | Two-party approval; proposer cannot self-approve |
| `payments:payment:refund` | Finance Controller; Billing Administrator below configured threshold | Command authorization + approval threshold |
| `subscription:change:backdate` | Finance Controller only | Elevated permission per deliverable 08 §11 |
| `collections:case:approve_exception` | Collections Manager | Separation of duties from the agent who recommended it |
| `portal:subscription:change` | Subscriber Admin (self-service, policy-scoped) | Account-membership check + merchant self-service policy |
| `audit:read` | Auditor | Read-only, tenant-scoped, does not imply write on any domain object |

Authorization failure responses distinguish "not authorized" (`403`) from "does not exist for you" (`404`) per resource-sensitivity policy defined in deliverable 15; cross-tenant existence MUST NOT be inferable from status code or timing (see §12 and deliverable 16).

Maker-checker endpoints expose current status via `GET .../approval-status` and never allow the same authenticated actor identity to both submit and approve when `separation_of_duties = true` on the governing `ApprovalPolicy`.

## 5. Versioning and compatibility policy

- The API is versioned in the URL path: `/v1/...`. A breaking change requires a new major path (`/v2/...`); both are served during a published deprecation window.
- **Non-breaking (no version bump):** adding an optional request field, adding a response field, adding an enum value to a field documented as "open enum" (§11.5), adding a new endpoint, adding a new optional filter.
- **Breaking (requires new version):** removing/renaming a field, changing a field's type or semantic meaning, changing an enum to "closed" validation behavior, tightening request validation in a way that rejects previously accepted requests, changing default behavior for existing callers.
- Every response includes `X-Api-Version` and, for resources with a schema version distinct from the endpoint version, a `schema_version` field mirroring event schema versioning (deliverable 14).
- Deprecation is announced with `Sunset` and `Deprecation` HTTP headers at least one full deprecation-window in advance (window length is a product decision tracked as OD-013 below).
- Contract tests (deliverable 24) run the published OpenAPI document against both provider (server) and consumer (generated client/SDK) expectations before release.

## 6. Resource and command naming

| Convention | Rule | Example |
|---|---|---|
| Collection | Plural noun, kebab-case | `/usage-events`, `/payment-methods` |
| Resource ID | Path segment `{id}` is the platform ID (ULID/UUID per deliverable 07 §1), never a sequence-guessable integer | `/invoices/{invoice_id}` |
| Business key lookup | Query filter, not path substitution, to avoid two identity schemes per resource | `/invoices?invoice_number=INV-20381` |
| Command | `POST /{collection}/{id}/{verb}`; verb is an imperative that matches a named domain transition | `POST /invoices/{id}/finalize`, `POST /subscriptions/{id}/pause` |
| Sub-resource creation | Nested collection only when the child cannot exist independently of the parent's authorization scope | `POST /accounts/{id}/payment-methods` |
| Query action (no side effect) | `POST` allowed for complex read/query bodies too large for query strings, but MUST NOT mutate state | `POST /pricing/quotes` (deliverable 12 §19) |
| Expansion target | Dot-path in `expand` parameter, not a separate nested route | `?expand=account,lines.charge` |

Commands never accept a client-chosen target state string as their sole authorization; the verb + preconditions encode the legal transition, and the server validates against the canonical state machine (deliverables 08–11).

## 7. Correlation and causation IDs

- Every request carries or receives `X-Correlation-Id` (a request/process-spanning ID) and, for commands issued as a consequence of another event, `X-Causation-Id` referencing the upstream event or command ID.
- Both propagate into the domain command, the outbox event envelope (deliverable 14 §3), audit records, provider calls where the rail supports it, and structured logs, per ADR-LA (deliverable 05 §9).
- Response bodies for asynchronous/job-creating endpoints include `correlation_id` so a client can join it to a later webhook delivery.

## 8. Idempotency keys and request-hash conflicts

Applies to every endpoint that creates a financial or lifecycle-changing effect: subscription commands, `usage-events` ingestion, invoice finalize/credit/write-off, payment create/attempt/refund, collection actions.

**Request:**

```
POST /subscriptions/{id}/change-quantity
Idempotency-Key: 8f14e45f-...
```

**Server behavior:**

1. Compute `canonical_request_hash` over the normalized method, path, and body (excluding volatile headers).
2. Look up `(tenant_id, idempotency_scope, idempotency_key)` per deliverable 07 `IdempotencyRecord`.
3. No record → process the command, persist the outcome and hash atomically with the domain transaction, return `201`/`200`.
4. Record exists, same hash → return the original stored response verbatim (same status code) without re-executing side effects.
5. Record exists, different hash → `409` with problem type `idempotency_key_reused_with_different_payload`; the original request is not affected.
6. Record in `processing` state beyond a bounded window (concurrent duplicate in flight) → `409 request_in_progress` with `Retry-After`.

`Idempotency-Key` is a client-generated UUID; it is scoped per endpoint family (`idempotency_scope`), so the same key on two different endpoints does not collide. Idempotency records expire per tenant policy (default 7 days) but never before the domain effect they protect is durably observable.

`usage-events` ingestion uses source-event identity (`tenant_id, source, source_event_id`) as its natural idempotency key per deliverable 03 §"Meter and Usage"; `Idempotency-Key` is accepted but the source-event uniqueness constraint is authoritative.

## 9. Optimistic concurrency

- Every mutable aggregate resource returns `ETag: "<row_version>"` (matching `row_version` in deliverable 07 §1).
- State-changing requests SHOULD send `If-Match: "<row_version>"`. If provided and stale, the server returns `412 Precondition Failed` with the current resource so the client can re-fetch and retry; if omitted, the server still uses its own expected-version check internally (deliverable 08 §4) but cannot guarantee the client observed the same version it is changing.
- `PATCH` is not used for domain aggregates; concurrency conflicts are surfaced through command endpoints, consistent with §6.
- `429`/`412` responses are always safe to retry after re-reading current state; they never leave a partial domain effect (ADR-LA-001, single transactional boundary).

## 10. Pagination, filtering, sorting, field selection, and expansion

| Concern | Convention |
|---|---|
| Pagination | Cursor-based: `?limit=50&cursor=<opaque>`; response includes `next_cursor` (null when exhausted) and `has_more`. Offset pagination is not supported for tenant-scoped collections above a small bound, to avoid expensive counts and to keep results stable under concurrent writes. |
| Default/max limit | Default `limit=25`, maximum `limit=200`Unless a resource documents a lower bulk-sensitive ceiling (for example `usage-events` batch fetch). |
| Filtering | `field=value` for exact match; documented operators use suffix, e.g. `created_at.gte=`, `status.in=OPEN,ACTIVE`. Only indexed, documented filters are supported — arbitrary filter expressions are rejected to protect query plans and tenant isolation. |
| Sorting | `?sort=-created_at,invoice_number` (`-` prefix = descending); default sort is always deterministic (includes a tiebreaker key) so pagination cursors are stable. |
| Field selection | `?fields=id,status,total_amount` restricts response fields for bandwidth-sensitive UIs; server-computed permission redaction still applies after selection. |
| Expansion | `?expand=account,lines.charge` inlines referenced resources up to a bounded depth (default max depth 2) to avoid uncontrolled fan-out; unexpanded references are always present as `{ "id": "...", "type": "...", "href": "..." }`. |
| List response envelope | `{ "data": [...], "next_cursor": "...", "has_more": true }`; never a bare array, so pagination metadata can be added without breaking clients. |

## 11. Canonical problem/error model

All error responses use an RFC 9457 (`application/problem+json`)–shaped body with platform-specific extensions:

```json
{
  "type": "https://api.example.com/problems/invoice-not-finalizable",
  "title": "Invoice cannot be finalized",
  "status": 409,
  "code": "INVOICE_NOT_FINALIZABLE",
  "detail": "Draft contains a stale tax quote that must be revalidated before finalization.",
  "correlation_id": "c-01HZY...",
  "errors": [
    { "path": "$.tax_quote_id", "code": "TAX_QUOTE_EXPIRED", "message": "Tax quote expired 2026-09-20T10:00:00Z." }
  ]
}
```

### 11.1 Rules

1. `type` is a stable, dereferenceable identifier for the problem category; `code` is the same concept in a machine-friendly enum form for clients that cannot fetch URIs.
2. `status` always matches the HTTP status code.
3. `errors[]` carries field-level validation detail using JSON Pointer `path`; absent for problems that are not field-scoped (e.g., authorization failures).
4. `detail` is safe for display to an authorized operator; it never includes another tenant's data, secrets, stack traces, or raw provider payloads.
5. `correlation_id` is always present and matches `X-Correlation-Id`.

### 11.2 Standard status code usage

| Status | Meaning | Example |
|---|---|---|
| `400` | Malformed request / schema validation failure | Missing required field |
| `401` | No valid authentication | Expired token |
| `403` | Authenticated but not authorized, or tenant mismatch | Role lacks `billing:invoice:finalize` |
| `404` | Resource does not exist within caller's authorized scope | Unknown invoice ID, or cross-tenant ID (no existence leak) |
| `409` | Legal-state conflict, idempotency conflict, or concurrency conflict without `If-Match` | Finalizing an already-voided invoice |
| `412` | `If-Match` precondition failed | Stale `row_version` |
| `422` | Semantically invalid though well-formed (business-rule rejection) | Tier gap in submitted rate card |
| `429` | Rate limit exceeded | See §13 |
| `500` | Unexpected server fault | Logged with correlation ID; no domain effect committed |
| `503` | Dependent capability degraded; safe to retry | Provider adapter circuit open |

### 11.3 Canonical reason codes for financial rejections

Payment- and collection-specific reason codes reuse the canonical taxonomy from deliverable 10 §6 verbatim in the `code` field (e.g., `INSUFFICIENT_FUNDS`, `MANDATE_REQUIRED`) so a client does not need a second mapping table.

### 11.4 Cross-tenant non-leakage

A request for an ID that exists in another tenant returns the same `404` shape, in the same latency distribution class, as a genuinely unknown ID. This is a tested control (deliverable 16 isolation test matrix), not only a documentation note.

### 11.5 Enum openness

Every response enum field is documented as **open** (clients must tolerate unknown future values and treat them as a safe default/"unknown" bucket) or **closed** (a fixed, versioned set; a new value is a breaking change). Canonical domain-state enums (subscription state, invoice document state, payment state) are **closed** and match deliverables 08–11 exactly; provider-adjacent or extensible fields (e.g., collection action `channel`) are **open**.

## 12. Money, quantity, time, date, and enum encoding

| Type | Wire representation | Rule |
|---|---|---|
| Money | `{ "amount_minor": 4284000, "currency": "INR" }` | Integer minor units + ISO 4217; never a bare float. Matches deliverable 07 §1. |
| Quantity | `{ "value": "150.000000000000", "unit": "API_CALL" }` | Decimal encoded as a **string**, not JSON number, to prevent client-side float coercion; scale per meter definition (deliverable 12 §7). |
| Percentage | `{ "value": "7.500", "basis": "PERCENT" }` | String decimal; explicit basis avoids 0.075 vs. 7.5 ambiguity. |
| Instant | RFC 3339 UTC, e.g. `"2026-09-30T14:00:00Z"` | Always UTC on the wire; business time zone is a separate labeled field where relevant (e.g., `billing_timezone`). |
| Business date | `"2026-09-30"` (ISO 8601 date, no time) | Used for `due_date`, `invoice_date`, and other business-calendar dates per deliverable 09 §10. |
| Duration/period | ISO 8601 duration (`"P1M"`) or explicit `{ "start": ..., "end": ... }` with documented inclusivity | Effective periods are always `[start, end)`; the field description states this explicitly rather than relying on convention. |
| Enum | Upper-snake-case string matching the domain vocabulary exactly (e.g., `"ACTIVE"`, `"PARTIALLY_PAID"`) | No translation layer between API and domain state names — this is a deliberate simplicity choice; localized display labels are a UI concern (deliverable 17). |
| IDs | ULID/UUID string | Opaque to clients; never parsed for embedded meaning. |

## 13. Batch and asynchronous job patterns

### 13.1 Synchronous batch (bounded size)

`POST /usage-events:batch` accepts up to a documented maximum (default 500) events in one call, validates and persists them in one durable operation, and returns a per-item result array so partial acceptance is explicit:

```json
{
  "results": [
    { "source_event_id": "evt-1", "status": "ACCEPTED", "usage_event_id": "01HZY..." },
    { "source_event_id": "evt-2", "status": "REJECTED", "code": "SCHEMA_INVALID", "detail": "..." },
    { "source_event_id": "evt-3", "status": "DUPLICATE", "usage_event_id": "01HZX..." }
  ]
}
```

A batch is never all-or-nothing at the HTTP layer; each item's disposition is independently correct per deliverable 03 §"Meter and Usage." The overall HTTP status is `200` whenever the batch itself was processed (even with per-item rejections); a `4xx`/`5xx` at the batch level means the batch itself could not be processed at all.

### 13.2 Asynchronous job resource

Long-running or bulk operations (rating-run reprocessing, bulk export, migration dry run) use a job resource pattern:

```
POST /billing-runs                     -> 202 { "job_id": "...", "status": "PENDING", "status_url": "/jobs/{job_id}" }
GET  /jobs/{job_id}                    -> { "status": "RUNNING", "progress": {...}, "result_url": null }
GET  /jobs/{job_id}                    -> { "status": "COMPLETED", "result_url": "/billing-runs/{id}" }
```

Jobs are restartable/resumable (ADR-LA-004), expose control totals and checkpoint progress per deliverable 05 §9, and their creation request accepts an `Idempotency-Key` so a retried `POST` attaches to the existing job rather than starting a duplicate run.

## 14. Rate limits and retry guidance

- Limits are tenant- and credential-scoped, tiered by endpoint sensitivity (usage ingestion has a much higher ceiling than pricing activation).
- Every response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- `429` responses include `Retry-After` (seconds) and use exponential-backoff guidance in `detail`.
- Clients MUST NOT retry a non-idempotent command without the original `Idempotency-Key`; retry guidance in documentation states this explicitly next to every financial command.
- `UNKNOWN`-outcome conditions (deliverable 10 §3) are surfaced as `202`/`409 reconciliation_required` rather than an ordinary retryable error, so clients do not loop into duplicate-attempt risk.

## 15. Signed outbound webhooks and replay

Outbound webhooks notify merchant systems of domain facts (`subscription.created`, `invoice.finalized`, `payment.succeeded`, etc., per deliverable 14). They are **facts**, not commands, and their contract intentionally matches the event taxonomy envelope.

### 15.1 Delivery

- `WebhookEndpoint` (deliverable 07) stores URL, subscribed event types, and a signing-secret reference (secret manager, never stored in plaintext in the primary schema).
- Each delivery is a `POST` with:
  - `Webhook-Id`: delivery ID (distinct from the underlying event ID, since one event may fan out to multiple endpoints);
  - `Webhook-Timestamp`: signing time;
  - `Webhook-Signature`: `v1,<base64 HMAC-SHA256(secret, "{id}.{timestamp}.{body}")>`, supporting secret rotation via multiple concurrently valid signatures during a rotation window;
  - body: the same versioned CloudEvents-style envelope defined in deliverable 14 §2.
- Receivers MUST verify the signature and timestamp tolerance (default ±5 minutes) before processing, mirroring the platform's own inbound provider-webhook rules (deliverable 10 §5).

### 15.2 Delivery guarantees and retry

- Delivery is at-least-once with exponential backoff (documented schedule) up to a bounded retry window (default 72 hours), after which the delivery is marked `FAILED` and surfaced to the merchant operator.
- Consumers are expected to deduplicate by `Webhook-Id`/event `id`, matching the platform's own inbound idempotency posture (§8; deliverable 14 §3).
- A delivery log per endpoint is queryable: `GET /webhook-endpoints/{id}/deliveries` with status, attempt count, response code, and timestamps.

### 15.3 Replay

`POST /webhook-endpoints/{id}/deliveries/{delivery_id}/replay` re-sends a specific past delivery unchanged (same event ID, new `Webhook-Id` for the delivery), for merchant-side recovery after an outage. Replay never regenerates or mutates the underlying domain fact; it re-delivers the persisted envelope from the outbox. Replay is permissioned (`integrations:webhook:replay`) and rate-limited to prevent abuse.

## 16. Resource catalog (MVP)

Each entry lists the primary endpoints; full request/response schemas live in the OpenAPI document. Action endpoints map 1:1 to the transition tables in deliverables 08–11.

### 16.1 Customers and accounts

```
GET    /customers                       list, filter by name/external ref/segment
POST   /customers                       create
GET    /customers/{id}
PATCH  /customers/{id}                  non-financial profile fields only
GET    /customers/{id}/accounts

GET    /accounts
POST   /accounts
GET    /accounts/{id}
GET    /accounts/{id}/balance           derived receivable summary (deliverable 03 §"Receivables")
GET    /accounts/{id}/timeline          Customer 360 event feed (permission-filtered)
```

### 16.2 Products, plans, rate cards (Catalog & Pricing)

```
GET    /products
POST   /products
GET    /products/{id}
POST   /products/{id}/versions                      create draft ProductVersion
GET    /product-versions/{id}
POST   /product-versions/{id}/submit-review
POST   /product-versions/{id}/publish                 maker-checker gated

GET    /offers | POST /offers | GET /offers/{id}
GET    /plans   | POST /plans   | GET /plans/{id}

GET    /rate-cards/{id}
POST   /rate-cards/{id}/submit-approval
POST   /rate-cards/{id}/activate                       maker-checker gated (deliverable 12 §18)
POST   /pricing/validate
POST   /pricing/simulations
POST   /pricing/quotes                                 non-mutating (deliverable 12 §19)
GET    /calculation-traces/{id}                         permission: pricing:trace:read
```

### 16.3 Subscriptions

```
GET    /subscriptions
POST   /subscriptions                                   -> creates in DRAFT
GET    /subscriptions/{id}
POST   /subscriptions/{id}/submit                        DRAFT -> PENDING_ACTIVATION
POST   /subscriptions/{id}/activate
POST   /subscriptions/{id}/convert-trial
POST   /subscriptions/{id}/items                         add item
DELETE /subscriptions/{id}/items/{item_id}                end item (not a hard delete)
POST   /subscriptions/{id}/items/{item_id}/change-quantity
POST   /subscriptions/{id}/change-plan
POST   /subscriptions/{id}/pause
POST   /subscriptions/{id}/resume
POST   /subscriptions/{id}/suspend
POST   /subscriptions/{id}/reinstate
POST   /subscriptions/{id}/cancel                        supports scheduled cancel_at
POST   /subscriptions/{id}/terminate                     elevated permission
POST   /subscriptions/{id}/renew
GET    /subscriptions/{id}/changes                       SubscriptionChange history
POST   /subscriptions/{id}/preview-change                non-mutating proration/impact preview
```

Every command above accepts `Idempotency-Key`, `If-Match`, `effective_at`, `reason_code`, and returns the updated resource with `ETag`, matching deliverable 08 §4's transition contract field-for-field.

### 16.4 Usage events

```
POST   /usage-events                       single event
POST   /usage-events:batch                 bounded batch (§13.1)
GET    /usage-events/{id}
GET    /usage-events?subscription_item_id=&meter_id=&event_time.gte=&event_time.lte=
POST   /usage-events/{id}/corrections      references original, never mutates it (deliverable 03 §"Meter and Usage")
GET    /usage-aggregates/{id}
```

### 16.5 Invoices

```
GET    /invoices
GET    /invoices/{id}
POST   /billing-runs                       async job (§13.2); produces draft invoices
POST   /invoices/{id}/recalculate           DRAFT only
POST   /invoices/{id}/submit-approval
POST   /invoices/{id}/finalize              -> POSTED (deliverable 09 §6)
POST   /invoices/{id}/void
POST   /invoices/{id}/credit-notes          issue corrective document (deliverable 09 §8)
POST   /invoices/{id}/write-off
POST   /invoices/{id}/disputes
GET    /invoices/{id}/lines/{line_id}       expandable line with calculation-trace link
GET    /invoices/{id}/document?format=pdf|html|json
```

### 16.6 Payments and payment methods

```
GET    /payments | GET /payments/{id}
POST   /payments                            create logical payment + first attempt (deliverable 10 §4)
POST   /payments/{id}/attempts               explicit retry
GET    /payments/{id}/attempts/{attempt_id}
POST   /payments/{id}/cancel
POST   /payments/{id}/refunds
GET    /refunds/{id}

GET    /accounts/{id}/payment-methods
POST   /accounts/{id}/payment-methods         accepts provider token only, never raw PAN (deliverable 10 §8)
POST   /payment-methods/{id}/verify
DELETE /payment-methods/{id}                  -> REVOKED, not a hard delete
```

### 16.7 Credits

```
GET    /accounts/{id}/credit-balance
POST   /accounts/{id}/credits                 manual credit grant (reason required; approval per threshold)
GET    /credits/{id}
```

### 16.8 Collections (supporting the MVP differentiator, deliverable 01 §"Payment & Collections Intelligence")

```
GET    /accounts/{id}/collection-summary      upcoming amount, risk band, preferred channel, next best action
GET    /collection-cases
GET    /collection-cases/{id}
POST   /collection-cases/{id}/actions/{action_id}/execute
POST   /collection-cases/{id}/hold
POST   /collection-cases/{id}/promises
```

### 16.9 Notifications

```
GET    /notifications?account_id=
GET    /notification-templates
POST   /notification-templates                versioned; publish is a separate action endpoint
POST   /notification-templates/{id}/publish
```

### 16.10 Webhooks

```
GET    /webhook-endpoints
POST   /webhook-endpoints
GET    /webhook-endpoints/{id}/deliveries
POST   /webhook-endpoints/{id}/deliveries/{delivery_id}/replay
POST   /webhook-endpoints/{id}/test-delivery
```

### 16.11 Entitlements (forward-compatible stub, not MVP-mandatory)

```
GET    /accounts/{id}/entitlements
```

Reserved per deliverable 01 non-goals; the route exists in the OpenAPI document as `x-horizon: R2` and returns `501` until entitlements ship, so client SDKs and downstream product integrations can target a stable shape early.

## 17. MVP vertical-slice example walkthrough

Matches PRD §11 release-acceptance scenario end-to-end:

1. `POST /customers`, `POST /accounts` → operator creates commercial parties.
2. `POST /rate-cards/{id}/activate` → pricing manager + finance controller approve an already-validated rate card (maker-checker via `ApprovalRequest`).
3. `POST /subscriptions` → `POST /subscriptions/{id}/submit` → `POST /subscriptions/{id}/activate` → subscription reaches `ACTIVE` with a pinned commercial snapshot.
4. `POST /usage-events:batch` → usage ingested with per-item disposition.
5. `POST /billing-runs` → async job aggregates, rates, and produces a draft invoice; `GET /jobs/{job_id}` polled to completion.
6. `POST /invoices/{id}/finalize` → invoice `POSTED`, receivable created, `invoice.finalized.v1` fact emitted (deliverable 14).
7. `POST /payments` → attempt created; provider webhook received on the platform's inbound endpoint (not shown here — internal, per deliverable 10 §5) drives the attempt to `SUCCEEDED`; `GET /payments/{id}` reflects canonical state once the callback is applied.
8. `GET /invoices/{id}/lines/{line_id}` with `?expand=charge.calculation_trace` → "why is this charge ₹7,842?" (master prompt §15) answered from persisted trace, never generated.
9. `GET /accounts/{id}/collection-summary` → confirms no outstanding risk once paid.
10. `GET /accounts/{id}/timeline` and the outbound `invoice.finalized`/`payment.succeeded` webhooks (§15) close the loop for merchant systems.

Every step above is idempotent-safe to retry per §8 and traceable end-to-end through the Revenue Lifecycle Graph (deliverable 06).

## 18. Architecture decisions

### ADR-API-001 — Command sub-resources instead of generic PATCH for financial transitions

- **Decision:** Domain transitions are explicit `POST .../{verb}` endpoints (§6) rather than a generic `PATCH` accepting a target `status`.
- **Alternatives:** generic resource `PATCH` with a `status` field; GraphQL mutations per transition.
- **Advantages:** self-documenting permission surface, request/response shape matches transition-specific inputs (deliverable 08 §4), impossible to "PATCH into" an illegal state by client error.
- **Disadvantages:** more endpoints to document and generate clients for; slightly more ceremony for simple field edits.
- **Rationale:** the state machines (08–11) are the product's core financial-control surface; a generic PATCH would re-open the state-machine-bypass risk the domain model explicitly forbids.
- **Implications:** OpenAPI tagging groups actions by resource; SDK generation produces named methods (`subscription.pause()`) rather than generic `update()`.

### ADR-API-002 — Cursor pagination only for tenant-scoped collections

- **Decision:** No offset/page-number pagination on multi-tenant collections.
- **Alternatives:** offset pagination; total-count-inclusive pagination.
- **Advantages:** stable results under concurrent writes, avoids expensive `COUNT(*)` under RLS, consistent with append-heavy tables (usage, audit).
- **Disadvantages:** clients cannot jump to an arbitrary page number; some admin UI patterns need adaptation.
- **Rationale:** matches the append-only/high-volume nature of usage, audit, and ledger-adjacent tables (deliverable 07 §7).
- **Implications:** Admin UI (deliverable 17) uses infinite-scroll/next-page patterns, not numbered pagination, for these collections.

### ADR-API-003 — Decimal quantities as strings on the wire

- **Decision:** All `Quantity`/`Percentage` values serialize as JSON strings, never numbers.
- **Alternatives:** JSON numbers with documented precision; a custom numeric wire format.
- **Advantages:** eliminates an entire class of floating-point corruption bugs on JS/JSON clients, matches the pricing engine's fixed-precision mandate (deliverable 12 §13, invariant "never use binary floating point").
- **Disadvantages:** clients must parse decimals explicitly; slightly less ergonomic for casual scripting.
- **Rationale:** the platform's most severe possible defect class is a silent monetary rounding error; the API contract must not reintroduce the risk the pricing engine eliminated internally.
- **Implications:** all official SDKs ship a decimal type; contract tests include a case asserting no numeric-typed monetary/quantity field exists anywhere in the schema.

## 19. Acceptance criteria

1. Every endpoint in §16 has an OpenAPI operation with request/response schemas, error responses, and required permission documented.
2. Every financial command endpoint requires `Idempotency-Key` in its OpenAPI definition and is covered by a duplicate-request contract test (§8).
3. Every domain-state-changing endpoint's legal preconditions match the transition tables in deliverables 08–11 exactly; a contract test exercises at least one illegal-transition rejection per state machine.
4. No response schema contains a bare JSON number for a monetary or quantity field.
5. A cross-tenant ID probe against any documented endpoint returns the standard non-leaking `404` shape (§11.4) with no measurable latency signal above documented tolerance.
6. Webhook payload schemas are identical in structure to the corresponding domain fact schema in deliverable 14, differing only by the delivery envelope headers.
7. The MVP vertical-slice walkthrough (§17) is executable end-to-end against the reference environment and produces the exact sequence of webhook deliveries documented.
8. Sunset/deprecation headers are present and tested for any endpoint marked deprecated in the OpenAPI document.

## 20. Open decisions

| ID | Decision needed | Owner | Needed before |
|---|---|---|---|
| OD-013 | API deprecation window length (e.g., 6 vs. 12 months) | Product + Developer Experience | v1 GA / first breaking change |
| OD-014 | Default and maximum `usage-events:batch` size under real ingestion load | Engineering | Load-test spike (deliverable 05 §11) |
| OD-015 | Whether GraphQL is offered alongside REST for read-heavy admin UI composition, per master prompt §54 "optionally GraphQL" | Architecture | Post-MVP roadmap review |

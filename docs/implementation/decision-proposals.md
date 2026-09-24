# Implementation decisions (D1–D12)

**Status:** All twelve recommendations **accepted by the Product Owner on 2026-09-24** ("accept all"). D6 and D7 are also recorded in the [Decision Ledger](../decision-ledger.html) (`rounding-proration`, `primary-key-scheme`); the others are recorded here.
**Also resolved on 2026-09-24:** TypeScript type checking (`tsc`) is in the gate. Fastify 5 is the HTTP framework. The CI provider is still being explored (requirements in D12).

The **Recommendation** column is the accepted decision. The option tables are kept as the rationale.

Each item lists options, a recommendation and what confirming it unblocks. Where current code already embodies a choice, the item says so. "Accept as recommended" is a valid answer for any item.

## Summary

| ID | Decision | Recommendation (accepted) | Blocks |
|---|---|---|---|
| D1 | Publish-side dead-letter policy | A: keep per-stream blocking; add per-consumer DLQs separately | Outbox completion (BL-001-03) |
| D2 | `Idempotency-Key` format | A: RFC 9562 UUID at the HTTP boundary | API contract freeze |
| D3 | Self role changes | A: no self-grant or self-revoke; add a last-administrator guard | Role administration (BL-002-03) |
| D4 | Approval permissions | C: generic decide permission plus policy-declared approver permissions | Maker-checker for pricing, refunds, write-offs |
| D5 | Money/decimal (SPIKE-02) | C: `platform/money` on BigInt fixed-point, decimal.js as test oracle only | All pricing, billing, payments |
| D6 | Rounding/proration (SPIKE-06) | HALF_UP + ACTUAL_DAYS (finance sign-off) | Pricing certification |
| D7 | Primary keys (SPIKE-03) | A: UUIDv7 in PostgreSQL `uuid` columns | Schema freeze |
| D8 | Identity-provider adapters | `jose` for OIDC/JWKS and workload JWTs; SAML federated through the IdP | P0-004 completion, production login |
| D9 | 12-persona permission matrix | A: I draft it with per-cell provenance, you review | P0-005 completion, every new route |
| D10 | Active-tenant selection | B long term (signed session claim); A (header) interim | Admin web session design |
| D11 | Platform operator identity | A: separate platform audience and platform roles | Provisioning in production |
| D12 | CI requirements | Any provider meeting the listed requirements | P0-010 release gate evidence |

## D1. Publish-side dead-letter policy

**Current behaviour:** when the outbox dispatcher cannot publish an event after its retry budget, the event is dead-lettered. Later events of the same aggregate stream wait behind it until an authorized operator requeues or skips it with a reason. The resolution is audited. Other streams are unaffected.

**Spec context:** `14-event-taxonomy.md` §5 describes dead-lettering at the *consumer* (per-consumer DLQ, operator replay, "never blocks the outbox dispatcher from delivering to other consumers"). Publish-side failure is a separate case: the broker itself refused the event, so no consumer has seen it.

| Option | Behaviour | Trade-off |
|---|---|---|
| **A (current)** | Publish dead letter blocks its own stream until an operator acts | Preserves per-aggregate order (required by §5). One stuck stream needs a person; alerting on `blockedStreams` covers it. |
| B | Park the event and keep publishing later events of the stream | Stream keeps flowing, but consumers see version N+1 before N. That breaks the ordering guarantee for financial aggregates. |
| C | A for financially material classifications, B for operational events | More configuration. The benefit is small at MVP volume. |

**Recommendation: A**, plus per-consumer DLQs as specified in §5 when the first real consumer is built. Those never block other consumers.

## D2. `Idempotency-Key` format

**Current behaviour:** accepts 16–128 URL-safe characters. `13-api-specification.md` §8 says "a client-generated UUID".

| Option | Behaviour | Trade-off |
|---|---|---|
| **A** | HTTP boundary accepts only RFC 9562 UUIDs (any version), normalized to lowercase; internal callers use the same rule | Matches the spec exactly and gives client SDKs one clear rule. Existing tests use UUID-shaped keys already. |
| B | Keep lenient 16–128 characters | Accepts more client libraries, but deviates from the published contract. |
| C | UUID for public HTTP, lenient for internal workload commands | Two rules to document and test. |

**Recommendation: A.** It is a small change in the executor's key validation plus a golden test.

## D3. Self role changes

**Current behaviour:** an actor with `tenant:role:assign` cannot grant or revoke their own roles. This was my addition; the spec is silent.

| Option | Behaviour | Trade-off |
|---|---|---|
| **A (current)** | No self-grant, no self-revoke; add a guard that the last active `tenant_administrator` cannot be removed by anyone | Prevents self-escalation and lock-out. A lone admin needs a second admin or support break-glass (BL-002-05). |
| B | Allow self-revoke only | Lets people drop privileges, but a lone admin can lock the tenant out unless the last-admin guard is also added. |
| C | Allow self-changes through maker-checker | Flexible, but depends on approval persistence and adds UX friction. |

**Recommendation: A**, with the last-administrator guard added.

## D4. Approval permissions

**Current behaviour:** generic `approval:request:propose` and `approval:request:decide`, with separation of duties enforced per policy. Master spec §62 needs rules like "Pricing activation → Product + Finance approval" and "Write-off > threshold → Controller approval", which need specific approver roles per action.

| Option | Behaviour | Trade-off |
|---|---|---|
| A (current) | Generic decide permission only | Cannot express "Product **and** Finance must approve". |
| B | One permission per governed action (`pricing:activation:approve`, `payments:refund:approve`, ...) | Explicit, but the permission catalog grows with every governed action, and multi-role rules still need extra logic. |
| **C** | Generic `approval:request:decide` plus an `ApprovalPolicy` that lists the required approver permissions, and how many of each, per action type | Expresses §62 examples directly; policy is tenant-configurable data in `approval_policy`; the catalog stays small. |

**Recommendation: C.** It needs a small `approval_policy` schema extension (required approver permissions) in the approval PostgreSQL tranche.

## D5. Money and decimal strategy (SPIKE-02)

**Requirements** (`12-pricing-engine-specification.md` §13):
- no binary floating point;
- quantities up to `numeric(38,12)`, rates and intermediates at least `numeric(38,18)`;
- `HALF_UP` to the currency minor unit;
- deterministic largest-remainder allocation;
- overflow, excess scale and divide-by-zero reject rather than coerce;
- must survive the golden dataset, including JPY, INR and 3-decimal currencies.

| Option | Description | Trade-off |
|---|---|---|
| A | `decimal.js` wrapped in a `Money`/`Decimal` value type | Mature and well tested. Precision is configured in significant digits, not scale, so scale and overflow rules still need a wrapper. Global configuration needs care (use `Decimal.clone`). |
| B | `big.js` wrapped | Smaller and simpler. Same wrapper needs as A. Fewer functions (no `ln`/`exp`, which pricing does not need). |
| **C** | `platform/money`: an immutable fixed-point type on native `BigInt` with an explicit scale | Zero runtime dependencies, exact and deterministic, and fast. Bounds checks and scale rules are natural at 38 digits. We own the arithmetic, so it must be proven by the SPIKE-02 golden and property suite. |
| D | `dinero.js` v2 | Money-focused API, but its release status and scale model need verification before relying on it. |

**Boundary representation (applies to every option):**
- JSON carries decimal **strings** (`"123.45"`) plus an ISO 4217 code;
- PostgreSQL uses `numeric` with the `pg` parser returning strings;
- a lint rule plus an architecture check reject `number` in money types.

**Recommendation: C.** Use `decimal.js` only as a **dev-only oracle** in property tests, so every operation is cross-checked against an independent implementation. This keeps money arithmetic dependency-free and fully under our tests. On confirmation I will implement `platform/money` and the golden and property suite first, then pricing.

## D6. Rounding and proration (SPIKE-06)

The working proposal is `HALF_UP` to the currency minor unit and `ACTUAL_DAYS` proration. The alternatives are banker's rounding (`HALF_EVEN`) and 30/360 day counts. This needs **finance sign-off**, not an engineering choice.

**Recommendation:** confirm HALF_UP + ACTUAL_DAYS for the US/USD MVP, keeping the mode as versioned tenant/currency policy so it can change later without code changes.

## D7. Primary-key scheme (SPIKE-03)

**Current state:** IDs are `text` (for example `evt_<uuid>`), and tenant IDs are caller-chosen slugs.

| Option | Description | Trade-off |
|---|---|---|
| **A** | UUIDv7, application-generated, stored as PostgreSQL `uuid` (16 bytes) | Time-ordered, so it gives good B-tree insert locality. PostgreSQL 18 also generates it natively. Standard format. |
| B | ULID stored as `text` (26 characters) | Readable and sortable, but a larger index than `uuid`; stored in `uuid` it becomes UUID-like anyway. |
| C | A with type prefixes only at the API edge (`ten_…`, `inv_…`) | Friendlier for support and logs. Prefixes must be stripped and validated at the boundary. |

**Recommendation: A.** Tenants get a UUIDv7 primary key plus a separate unique, human-readable slug. Prefixes (C) remain an optional presentation layer. Migrations switch `text` keys to `uuid` before the schema freeze. SPIKE-03 still runs a short insert/index benchmark to confirm.

## D8. Identity-provider adapters

The authentication service already enforces issuer, audience, lifetime, MFA and revocation. Only cryptographic verification is missing.

| Concern | Options | Recommendation |
|---|---|---|
| OIDC token and JWKS verification | `jose` library (remote JWKS with caching and key rotation); `openid-client` (full relying-party flows); vendor SDK | **`jose`** in the API. Add `openid-client` later only for the admin-web login flow. |
| SAML | `@node-saml/node-saml` in-process; or federate SAML through the IdP so the platform only sees OIDC | **Federate through the IdP.** This keeps XML-signature handling out of our code. |
| Workload identity | Signed short-lived JWT (`private_key_jwt` or client credentials) verified with `jose`; mTLS | **Signed JWT for MVP**, with mTLS added at the infrastructure layer later. |
| IdP product | Hosted (Entra ID, Okta, Auth0, Cognito) or self-hosted (Keycloak) | **Your call.** It must support OIDC, MFA, SAML federation for enterprise tenants and client credentials. |

**Recommendation:** confirm `jose` and SAML federation now. The adapter can be built and tested against a local JWKS immediately, independent of the IdP product.

## D9. Permission matrix for the 12 personas

Master spec §61 lists 12 personas but no grants.

| Option | Description |
|---|---|
| **A** | I draft a persona × permission matrix in the repo. Each cell is marked *spec-derived* (with its source: API spec §4, UX IA, SUB-0014) or *proposed*. Unreviewed cells stay denied until you or finance approve them. |
| B | Start with five roles (Tenant Admin, Finance Controller, Billing Admin, Auditor, Support read-only) and add personas later |
| C | No default roles; tenants define all roles themselves |

**Recommendation: A.** Only spec-derived grants ship by default.

## D10. Active-tenant selection

**Current behaviour:** a principal with one membership uses it implicitly. With several memberships, the `X-Active-Tenant` header must name one of them. It is verified against the signed membership list and is never an authority on its own. The API spec says the active tenant is "carried as a signed claim, not a request parameter".

| Option | Description |
|---|---|
| A (current) | Header selecting among signed memberships |
| **B** | Token exchange: the session token carries exactly one active-tenant claim; switching tenants issues a new token |
| C | Tenant in the URL path (`/v1/tenants/{id}/…`) |

**Recommendation:** B once the IdP (D8) is chosen, keeping A as the interim so development is not blocked. Both are safe because membership is always verified.

## D11. Platform operator identity

**Current state:** interactive principals must belong to at least one tenant. Platform staff who provision tenants have no identity model, and the platform authorizer is a deny-by-default port.

| Option | Description |
|---|---|
| **A** | A separate platform audience (`sintius-platform`) with platform roles (`platform:tenant:provision`, `platform:tenant:lifecycle`, `outbox:dead_letter:resolve`). Principals hold no tenant memberships. MFA is always required. |
| B | An internal "platform" tenant whose roles grant platform permissions |

**Recommendation: A.** It keeps a tenant role from ever implying platform power, as the handover requires.

## D12. CI requirements (provider under evaluation)

Any provider works if it can:
- run Node 24 and a PostgreSQL 17 service container on a loopback port;
- run `npm ci`, then `npm run typecheck`, `check:architecture`, `check:roadmap`, `check:requirements`, `npm test`, `db:migrate` and `test:postgres` in that order, with `SINTIUS_*_DATABASE_URL` pointing at the service;
- keep the TAP output and the regenerated requirement coverage as build artifacts (the P0-010 "CI evidence capture");
- block merges on failure;
- run secret scanning (GitHub push protection already applies to this repository).

GitHub Actions is the lowest-effort fit because the repository is already on GitHub, but this is left open as requested.

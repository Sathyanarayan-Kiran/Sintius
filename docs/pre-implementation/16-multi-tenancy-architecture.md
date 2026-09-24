# Multi-tenancy architecture

**Version:** 0.1
**Status:** Proposed MVP baseline
**Related:** [Logical architecture](05-logical-architecture.md) (ADR-LA-008), [Data model / ERD](07-data-model-erd.md) §8, [Security architecture](15-security-architecture.md) §6

## 1. Tenant identity and trusted context propagation

A tenant is the security, configuration, and data-isolation boundary for one merchant organization (deliverable 03 §2). `tenant_id` is a platform-generated identity, never client-chosen, and is established once at `Tenant` provisioning.

**Trusted context propagation rule:** `tenant_id` enters the system exactly once per request/job, at the authentication or job-dispatch boundary, from a source the platform itself controls or has cryptographically verified:

| Entry path | Trusted source of `tenant_id` |
|---|---|
| Human session (Admin, Portal) | `UserMembership` resolved from the authenticated subject; session claim signed by the platform after that resolution |
| API credential (OAuth client, API key) | Bound to exactly one tenant at credential-issuance time |
| Signed payment link | Embedded in the signed token payload, verified server-side |
| Internal job / scheduler | Signed/trusted field set by the enqueuing transaction, re-validated at every subsequent transaction boundary (not just at dispatch) |
| Inbound provider webhook | Resolved from the stored `Gateway`/`Connector`→tenant mapping using the provider's own account/merchant identifier, never from a tenant field inside the webhook payload |

From that point forward, `tenant_id` is carried as trusted request/job context and injected into every query, command, cache key, event envelope, and log line by shared middleware/repository code — never re-read from a request body, query string, or event payload field that a caller could set (deliverable 13 §3, deliverable 15 §4.1). If a body or payload does carry a `tenant_id` for convenience (e.g., idempotency-hash stability), it is validated to *match* the trusted context and the request is rejected on mismatch; it never *substitutes* for the trusted context.

```mermaid
sequenceDiagram
  participant Caller
  participant AuthN as AuthN boundary
  participant Ctx as Trusted request context
  participant Repo as Repository / query layer
  participant DB as PostgreSQL (RLS)

  Caller->>AuthN: Request (credential; optional tenant_id in body)
  AuthN->>Ctx: Resolve tenant_id from verified credential only
  Ctx->>Ctx: If body tenant_id present and != resolved -> reject
  Ctx->>Repo: Invoke with trusted tenant_id (not a parameter callers can pass)
  Repo->>DB: SET LOCAL app.tenant_id = trusted value (per transaction)
  DB->>DB: RLS policy requires tenant_id = current_setting('app.tenant_id')
  DB-->>Repo: Rows filtered/constrained to tenant
```

## 2. Shared application/database model with row-level-security defense in depth

- **Model:** shared application processes and a shared PostgreSQL cluster in MVP (ADR-LA-008), with every tenant-owned table carrying non-null `tenant_id` and tenant-scoped unique/foreign keys (deliverable 07 §6, §8).
- **Layer 1 — mandatory repository filter:** every generated/hand-written query includes `WHERE tenant_id = :trusted_tenant_id` as a structural requirement of the repository layer, not an opt-in clause. Architecture tests fail the build if a query against a tenant-owned table is constructed without it.
- **Layer 2 — row-level security (defense in depth):** PostgreSQL RLS policies enforce `tenant_id = current_setting('app.tenant_id')::uuid` on every tenant-owned table for the application database role. `app.tenant_id` is set via `SET LOCAL` at the start of each transaction from the trusted context in §1, and reset by the transaction boundary — it cannot leak across pooled connections or requests.
- **Layer 3 — narrow, audited service roles:** migration, projector-rebuild, and platform-analytics roles that must see across tenants are distinct database roles, separately credentialed, never the same role application request handlers use, and every use is logged (§7).
- Both layers must independently deny a cross-tenant read/write; a test suite (§11) asserts the application filter *and*, separately (by temporarily bypassing the application filter in a test harness), that RLS alone would have blocked the same query.

## 3. Tenant-aware keys, constraints, caches, queues, jobs, search, object paths, exports, logs/traces, rate limits

| Surface | Tenant-awareness mechanism |
|---|---|
| Database keys/constraints | `tenant_id` in every primary business-key uniqueness constraint and every foreign key relationship (deliverable 07 §1, §6) |
| Cache (Redis) | Key prefix `tenant:{tenant_id}:...`; a cache miss or eviction never falls back to an unscoped or wrong-tenant key; TTLs prevent stale cross-tenant-looking data from outliving a tenant closure |
| Queues / background jobs | Every job payload carries the trusted `tenant_id` (§1) set at enqueue time from the originating transaction context, never inferred by the worker from unrelated state |
| Search index | Tenant filter is a mandatory, server-injected clause on every query against the index, identical discipline to §2's database filter; the index itself is logically partitioned (tenant-prefixed document ID or index alias) so a misconfigured query fails closed |
| Object storage paths | `s3://.../{tenant_id}/{context}/{object_id}`; signed URLs are scoped to one object and expire quickly; a listing operation is never exposed unscoped |
| Exports | Every export job is created within one tenant's trusted context and its output artifact is stored/labeled under that tenant's object-storage prefix; a platform-wide export uses a distinct, separately authorized de-identified pipeline (§8) rather than reusing the per-tenant export path with a widened filter |
| Logs / traces | Every structured log line and trace span includes `tenant_id` as a required field; log/trace query tooling defaults to a single-tenant scope and requires an explicit, audited elevated role to query across tenants |
| Rate limits | Rate-limit counters are keyed by `(tenant_id, credential)`; one tenant's traffic cannot exhaust another tenant's quota (noisy-neighbor control, §6) |

## 4. Provisioning, suspension, closure, retention, migration, backup/restore, tenant-scoped export

### 4.1 Tenant lifecycle

Reuses `PROVISIONING → ACTIVE → SUSPENDED → CLOSED` from deliverable 03 §5.

| Transition | Trigger | Effect |
|---|---|---|
| `PROVISIONING → ACTIVE` | Onboarding checklist complete (legal entity/settings/initial admin user) | Tenant becomes reachable via normal auth paths |
| `ACTIVE → SUSPENDED` | Billing/compliance/fraud policy or merchant-requested pause | API/portal access denied except read-only/export paths permitted by policy; scheduled jobs (billing runs, dunning) pause; existing data untouched |
| `SUSPENDED → ACTIVE` | Resolution of the suspending condition, authorized reinstatement | Full access restored; suspended-period gap is visible in audit/timeline, never silently erased |
| `ACTIVE/SUSPENDED → CLOSED` | Contract termination / offboarding | Not deletion — see §4.3 |

Closing is never deletion (deliverable 03 §5 invariant); it stops active operation while preserving records under the retention policy in effect at closure time.

### 4.2 Provisioning

Provisioning creates the `Tenant` row, default roles, an initial admin `UserMembership`, and baseline configuration (locale, timezone, default currency, retention policy) in one transaction, so a partially provisioned tenant is never externally reachable.

### 4.3 Closure and retention

- At closure, a tenant enters a defined retention window (tenant-configurable within a platform-enforced minimum/maximum) during which data remains recoverable on authorized request.
- After the retention window, financial/audit records follow the legal retention floor from deliverable 15 §9.3 regardless of tenant closure — closing a tenant does not shorten a legally required retention period.
- Non-financial, non-audit data may be purged after the window per the governed erasure workflow (deliverable 15 §9.3), logged as its own auditable action.

### 4.4 Migration (tenant-level)

- A tenant's data can be exported and, for dedicated-deployment upgrades (§9), migrated to an isolated cluster using the same expand/migrate/contract discipline as schema migrations (deliverable 07 §10), with source/target control totals and reconciliation before cutover.
- Tenant migration is planned, scheduled, and communicated — never a silent background move for a tenant with active financial processing.

### 4.5 Backup and restore

- Backups are taken at the shared-cluster level (point-in-time recovery per deliverable 01 §9 RPO/RTO targets) plus tenant-scoped logical export capability for single-tenant restore drills without restoring the entire cluster.
- Restore drills explicitly test: (a) full-cluster restore preserves per-tenant isolation correctly, (b) a single-tenant logical restore does not affect other tenants' current state, (c) restored idempotency/allocation/journal-balance invariants hold (deliverable 07 §11).

### 4.6 Tenant-scoped export

- Every tenant can request a complete export of its own data (customer, subscription, invoice, payment, audit history) through a permissioned, audited job (deliverable 13 §13.2 job pattern), scoped exclusively to that tenant's trusted context — this is both a product capability (portability, deliverable 01) and a GDPR/data-portability control (deliverable 15 §9.3).

## 5. Noisy-neighbor controls and quotas

| Control | Mechanism |
|---|---|
| API rate limits | Per-tenant quota (deliverable 13 §14); a tenant's burst cannot degrade another tenant's p95 latency target (deliverable 01 §9) |
| Usage ingestion throughput | Per-tenant ingestion ceiling and backpressure; a single high-volume tenant's usage spike is isolated to its own processing lane where the architecture requires it (deliverable 05 §8 extraction triggers — usage ingress/rating is a first candidate for isolation exactly because of this risk) |
| Database connection/query budget | Connection pooling with per-tenant fairness where a tenant's expensive query pattern (e.g., a very large billing run) cannot starve others; statement timeouts bound worst-case impact |
| Background job fairness | Job schedulers apply weighted fairness across tenants for shared queues (billing runs, dunning, notifications) so one large tenant's run does not delay another's due-date-sensitive job |
| Storage/object quotas | Tenant-level storage quotas with alerting before hard limits, to catch runaway usage/export patterns early |

Extraction to a dedicated worker pool or dedicated deployment (§9) is the structural noisy-neighbor mitigation when quota/fairness controls are insufficient for a specific tenant's scale (ties to deliverable 05 §8 extraction triggers).

## 6. Encryption/key options and data-residency evolution

- MVP: shared-cluster encryption at rest (deliverable 15 §7.1) with platform-managed keys; every tenant's data is encrypted, but the key hierarchy is shared infrastructure, not per-tenant cryptographic isolation.
- **Enterprise option:** a tenant can be provisioned with a dedicated data-encryption key (or a fully dedicated deployment, §9) where contractual or regulatory requirements demand cryptographic tenant separation beyond RLS/application controls.
- **Residency evolution:** `Tenant.data_residency_region` is reserved from MVP schema (deliverable 15 §9.3) even though MVP operates a single region. A later region becomes a deployable target for new or migrated tenants without a breaking schema change — the field exists now so residency is a deployment-topology decision, not a data-model rewrite, when deliverable 25 defines regional deployment.

## 7. Cross-tenant platform operations and de-identified aggregate analytics

Some legitimate platform operations must see across tenants: capacity planning, fraud pattern detection, product analytics, and incident investigation. These use a structurally separate path from every per-tenant product API:

- A distinct service role (§2, Layer 3) with its own credential, never reused by request-handling code.
- A distinct, separately reviewed query/pipeline (deliverable 04 §6: "Cross-tenant operational analytics use a separate de-identified pipeline and service role; product APIs never gain implicit global access").
- Aggregate analytics outputs are de-identified (no per-tenant/customer-identifying dimension in the output) unless the specific operational purpose (e.g., a named incident investigation) is itself individually authorized and audited under §8's break-glass process.
- This path can never be reached through the normal API/domain command surface — it is a separate deployment artifact (internal tool/pipeline), which is itself the control that prevents "implicit global access" from silently appearing in a future product feature.

## 8. Time-bound audited support access and break glass

Reuses deliverable 15 §11.3 controls, stated here from the tenant-isolation perspective:

1. Support/operator access to a specific tenant's data requires an explicit grant scoped to that tenant, time-bound (default short TTL, e.g., hours not days), tied to a ticket/reason.
2. MFA re-authentication is required to activate the grant, distinct from the operator's normal session.
3. Every query/action taken under the grant is logged with the grant ID, reason, and tenant, queryable by the tenant's own auditor role for full transparency (subject to platform security-sensitive redactions).
4. The grant expires automatically; there is no standing "god mode" role that bypasses per-tenant scoping without an active, logged grant.
5. Break-glass (emergency access bypassing normal approval latency) is a stricter, more heavily alerted variant of the same mechanism — used only when normal grant approval cannot complete in time for an active incident, and always followed by mandatory post-incident review.

## 9. Dedicated enterprise deployment path

- The MVP shared-tenancy model (§2) is designed so a tenant can be "extracted" to a dedicated deployment (isolated database cluster, and optionally isolated application tier) without changing its `tenant_id`, business keys, or event/API contracts — because every contract is already tenant-scoped and storage-neutral (ADR-LA-008, deliverable 06 ADR-RLG-001 "public contracts are storage-neutral").
- Triggers for dedicated deployment: contractual isolation requirement, regulatory residency requirement, scale/noisy-neighbor limits reached (§5), or a customer-specific compliance attestation need.
- Migration path reuses §4.4's tenant migration discipline; the receiving dedicated cluster runs the identical schema/RLS model, so isolation guarantees are additive (dedicated infrastructure plus the same application-level controls), never a downgrade.

## 10. Configuration inheritance/override rules

- Platform-level defaults (permission catalog, event schema versions, default rounding policy, default retention floor) are defined once and inherited by every tenant.
- Tenant-level configuration (roles composed from the permission catalog, approval policies, retention window within platform bounds, notification templates, rate-card content) overrides platform defaults only within explicitly permitted bounds — a tenant cannot, for example, configure a retention window shorter than the legal minimum floor (deliverable 15 §9.3), and cannot disable RLS/tenant-isolation controls under any configuration.
- Configuration changes are versioned and audited identically to other material mutations (deliverable 03 §"Audit and Approval"); "which override was active when this invoice was calculated" is answerable from the same effective-dated versioning discipline used for pricing (deliverable 12 §6).

## 11. Isolation test matrix and incident containment

### 11.1 Isolation test matrix (mandatory, automated, release-blocking)

| Test | Asserts |
|---|---|
| Cross-tenant read via direct object ID | Returns non-leaking `404` (deliverable 13 §11.4), not data, not a distinguishable error |
| Cross-tenant write attempt (forged/mismatched tenant context) | Rejected before any domain transaction begins |
| RLS-only enforcement (application filter bypassed in test harness) | Database layer alone blocks the cross-tenant row |
| Cache key collision | A tenant cannot read another tenant's cached value even under a crafted matching business key |
| Event/outbox cross-tenant leakage | A consumer processing tenant A's stream never receives or applies a tenant B event |
| Search cross-tenant query | An unscoped or crafted query never returns another tenant's document |
| Object storage path traversal | A signed URL or path manipulation cannot reach another tenant's object prefix |
| Support/break-glass scope enforcement | An active grant for tenant A cannot be used to query tenant B |
| Rate-limit isolation | Saturating tenant A's quota does not measurably affect tenant B's latency/availability |
| Job/worker context forgery | A worker cannot process a job whose trusted tenant context fails re-validation at the transaction boundary |
| Restore drill isolation | A single-tenant logical restore does not alter or expose other tenants' current state |

### 11.2 Incident containment

- A suspected or confirmed cross-tenant isolation breach is a Security Incident Response (deliverable 15 §11.2) top-severity trigger.
- Containment playbook: identify blast radius (which tenants/records), revoke/rotate any implicated credential or grant, apply an emergency access restriction if the breach is ongoing, notify affected tenants per legal/contractual obligation, and run the full isolation test matrix (§11.1) plus a targeted regression test for the specific defect class before restoring normal operation.
- Every containment action is itself audited, and the post-incident review feeds both the security risk register (deliverable 15 §12) and this document's test matrix (a newly discovered gap becomes a new mandatory test).

## 12. Architecture decisions

### ADR-MT-001 — RLS as defense in depth, not the sole isolation control

- **Decision:** Tenant isolation is enforced at both the application repository layer (mandatory filter) and the database layer (RLS); neither is relied upon alone.
- **Alternatives:** RLS-only (trust the database exclusively); application-filter-only (no RLS); database-per-tenant (see ADR-MT-002).
- **Advantages:** a bug in either layer alone does not cause a breach; RLS catches application-layer mistakes, and the mandatory-filter architecture test catches queries that might otherwise rely solely on RLS being correctly configured.
- **Disadvantages:** two layers to maintain and test; RLS policy correctness must be verified independently (an RLS bug is not visible from application-level testing alone).
- **Rationale:** cross-tenant leakage is the platform's highest-impact realistic failure mode (deliverable 15 §12 RISK-SEC-001); a single point of failure is unacceptable at this severity.
- **Implications:** the isolation test matrix (§11.1) explicitly includes an RLS-only test that bypasses the application filter, so the two layers are verified independently, not just in combination.

### ADR-MT-002 — Shared cluster with tenant keys in MVP; dedicated deployment as an explicit later option

- **Decision:** Repeats and extends ADR-LA-008: shared database/application in MVP, with the schema and contracts designed so dedicated deployment (§9) requires no breaking change later.
- **Alternatives:** database-per-tenant or schema-per-tenant from MVP; fully shared with no per-tenant structural boundary at all.
- **Advantages:** operational simplicity and fast provisioning now, without foreclosing the enterprise isolation option; avoids the migration-tooling burden of thousands of per-tenant schemas at MVP scale.
- **Disadvantages:** noisy-neighbor and isolation-bug blast radius are structurally larger than database-per-tenant until a tenant is extracted (§9).
- **Rationale:** MVP tenant count and scale do not yet justify per-tenant infrastructure cost/operational complexity; the risk is mitigated by ADR-MT-001's defense-in-depth isolation rather than physical separation.
- **Implications:** capacity planning and the isolation test matrix (§11.1) are the primary compensating controls; the extraction triggers in §9/deliverable 05 §8 are monitored, not theoretical.

## 13. Acceptance criteria

1. Every tenant-owned table has RLS enabled and a policy requiring `tenant_id` equality; a schema-linting check fails the build if a new tenant-owned table lacks this.
2. The full isolation test matrix (§11.1) passes on every release candidate and is release-blocking, not advisory.
3. No production code path constructs a query against a tenant-owned table without the mandatory repository-level tenant filter (architecture test, ties to deliverable 05 §7 "architecture tests forbid cross-module table access").
4. A tenant can be suspended and reinstated without any data loss or corruption, verified by an automated scenario test.
5. A tenant-scoped export completes and contains exactly that tenant's records, verified by control-total comparison against the source database.
6. A restore drill (full-cluster and single-tenant logical) demonstrates isolation is preserved post-restore (§4.5, §11.1).
7. Break-glass access grants expire automatically and are fully reconstructable from audit evidence for any historical grant.
8. The dedicated-deployment migration path (§9) has been exercised at least once in a non-production environment before it is offered as a contractual option.

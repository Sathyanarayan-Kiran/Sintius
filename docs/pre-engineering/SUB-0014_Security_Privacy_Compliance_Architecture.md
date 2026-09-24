# SUB-0014 — Security, Privacy & Compliance Architecture

**Document ID:** SUB-0014
**Title:** Security, Privacy & Compliance Architecture
**Version:** 0.1 (Draft)
**Status:** Draft — states architectural alignment, not certification
**Owner:** Security Architect
**Reviewers:** Compliance Architect, Principal Software Architect, Payments Architect, AI/ML Architect
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23
**Dependencies:** [SUB-0011](SUB-0011_System_Architecture.md), [SUB-0012](SUB-0012_Data_Architecture_ERD.md), [SUB-0013](SUB-0013_API_Event_Contracts.md)
**Related Documents:** SUB-0015 UX Information Architecture (planned), SUB-0016 AI & Agent Governance Specification (planned)

## 1. Scope statement

This document defines architectural controls. It states **alignment** with PCI DSS scope minimization, SOC 2, ISO 27001, and GDPR/regional privacy law; it does not itself constitute certification, an audit, or a legal compliance determination. Certification requires an external assessment against the deployed system (Decision, §14).

## 2. Authentication

| Mechanism | Used for |
|---|---|
| OIDC (authorization code + PKCE) | Human console/Portal login |
| SAML SSO | Enterprise merchant workforce federation |
| MFA | Every privileged human session; step-up MFA additionally required for maker-checker approval and break-glass activation |
| OAuth2 client-credentials / scoped API key | Server-to-server merchant integration, bound to exactly one tenant |
| Workload identity (mTLS or short-lived signed token) | Internal services/workers/schedulers — never long-lived static service credentials |
| Signed payment link | Narrow subscriber action, single-purpose JWS, short TTL, no broader session granted |

**Tenant derivation** repeats SUB-0013 §3: `tenant_id` is resolved exclusively from verified credential/session context; an untrusted body field can never assert or override it.

## 3. RBAC and ABAC

- RBAC: roles bind to a platform-defined permission catalog; tenants compose roles without code changes.
- ABAC layers narrow an RBAC grant with attribute conditions (e.g., a Collections Analyst may act only on cases below an exposure threshold).
- Enforcement occurs at the domain command boundary — the UI hides actions a user cannot perform, but the API is the actual control point (PRIN-07).
- **Resource-level (object) authorization** re-validates tenant and ownership scope on every fetch/mutation independent of the RBAC check — this is the platform's control against Broken Object Level Authorization (§8).

## 4. Tenant isolation

Reuses SUB-0011 ADR-013 as the architectural decision; this section states the concrete control per data path.

| Path | Control |
|---|---|
| Database | Non-null `tenant_id` on every tenant-owned row (SUB-0012 §1); mandatory application-level filter; row-level security as defense in depth, enforced independently — a test bypassing the application filter must still be blocked by RLS alone |
| Cache | Tenant-prefixed keys; fail-closed on key mismatch, never a cross-tenant fallback |
| Events/outbox | Mandatory `tenant_id` on every envelope (SUB-0013 §11); a consumer rejects/quarantines a mismatched-tenant event |
| Search index | Tenant-scoped filter enforced server-side, never trusted from a client query parameter |
| Object storage | Tenant-prefixed paths, short-lived signed URLs scoped to one object |
| Exports | Every export job is tenant-bound at creation; a platform-wide export uses a separate, de-identified pipeline with its own service role — product APIs never gain implicit global access |
| Observability | Tenant-safe labels; production log/trace search defaults to single-tenant scope, requiring an audited elevated role to query across tenants |
| Support access | Time-bound, MFA-gated, ticket-linked, fully audited (§10) |
| AI gateway | Every model/tool call carries trusted tenant context; retrieval/grounding is tenant-filtered before assembly, not after (SUB-0016) |

## 5. Encryption and key management

- **In transit:** TLS 1.2+ everywhere, including internal service-to-service traffic; certificate validation is never disabled.
- **At rest:** full database and object-storage encryption; `RESTRICTED_FINANCIAL`/`SECURITY_SECRET`-classified values (§7) use envelope encryption with purpose-scoped data encryption keys where the deployment model requires cryptographic tenant separation (dedicated deployment path).
- **Key hierarchy:** root/master keys held in a KMS; application services never handle raw key material, only KMS-mediated operations. Signing keys (webhook HMAC, JWT signing) are distinct from data encryption keys with independent rotation schedules.

## 6. Secrets management

| Secret type | Storage | Rotation |
|---|---|---|
| Provider credentials (Stripe, tax, email) | Secrets manager, referenced by ID from Connector config (SUB-0017) | Scheduled + immediate on suspected compromise |
| Webhook signing secrets | Secrets manager | Dual-secret rotation window (SUB-0013 §10) |
| Internal service credentials | Workload identity, short TTL | Automatic |
| Database credentials | Secrets manager, least-privilege per service role | Scheduled; break-glass credentials rotate immediately after each use |

## 7. Data classification

| Class | Examples | Handling |
|---|---|---|
| `SECURITY_SECRET` | API keys, signing secrets, provider credentials | Secrets manager only; never database/log/event payload |
| `RESTRICTED_FINANCIAL` | Invoice lines, balances, payment tokens, tax identifiers | Encrypted, tenant-scoped, redacted in logs/traces |
| `CONFIDENTIAL_BUSINESS` | Pricing, usage, contracts, contacts | Tenant isolation, least privilege, retention controls |
| `INTERNAL_OPERATIONAL` | Trace IDs, job state, non-sensitive metrics | Tenant-safe labels; no high-cardinality PII in metric labels |
| `PUBLIC` | Published docs, SDK examples | Review before publication; synthetic data only |

Every schema field and event field (SUB-0012, SUB-0013) maps to exactly one class, set at design time.

## 8. Payment tokenization and PCI DSS scope minimization

- Raw PAN, CVV, and full bank credentials are never accepted by platform APIs (SUB-0009 §2.3) — collection happens exclusively through provider-hosted fields/SDKs. The platform stores only tokens, safe display metadata, fingerprint hash, and mandate reference.
- **Architectural alignment stated, not certified:** this design is intended to keep the platform's cardholder-data-environment footprint at SAQ-A-equivalent scope. Actual PCI DSS scope determination requires a Qualified Security Assessor engagement against the deployed environment.

## 9. API and application security

| Threat | Control |
|---|---|
| SSRF (merchant-configured webhook/callback URLs) | Egress allowlist proxy, DNS-rebind protection, timeout/size limits |
| Injection | Parameterized queries/ORM bindings only; the pricing rule language (SUB-0007 §4) is a typed AST interpreter, never code execution |
| XSS | Framework default output encoding, strict Content-Security-Policy |
| CSRF | Bearer-token API auth (no ambient cookie auth) eliminates classic CSRF for the API; any cookie-based portal session uses `SameSite=Strict` plus a CSRF token as defense in depth |
| Broken object-level authorization | Resource-level re-check on every fetch/mutation (§3) |
| Replay | Idempotency keys (SUB-0013 §5) for legitimate retries; signature + timestamp tolerance + provider-event-ID dedup (SUB-0009 §2.6) for inbound provider events |
| Mass assignment | Explicit allowlisted request DTOs per endpoint; domain aggregates never bind directly from raw request bodies |
| Rate limiting / abuse | Per-tenant, per-credential quotas tiered by endpoint sensitivity |

## 10. Privileged operations and secure administrative actions

- **Maker-checker:** configurable approval for pricing activation, refunds/credits/write-offs above threshold, termination, backdating, and collection exception approval (SUB-0000 PRIN-08). The proposer cannot approve their own request when separation-of-duties policy applies — enforced at the domain command layer, not merely a UI convention.
- **Break-glass / time-bound support access:** a grant scoped to one tenant, time-bound (short TTL), MFA-gated to activate, fully logged (query/action), and automatically expiring. There is no standing role that bypasses per-tenant scoping without an active, logged grant.
- **Manual financial state repair** (e.g., marking a payment externally paid) requires a distinct permission, mandatory evidence attachment, and approval — never available without external settlement evidence.

## 11. Audit logging

- Every material mutation writes an `AuditEvent` (SUB-0012 §4.9) in the same transaction as the domain change — a domain effect without a corresponding audit record cannot occur.
- The application database role has `INSERT`-only privilege on the audit table; no `UPDATE`/`DELETE` grant exists.
- AI-originated actions additionally record model, prompt/context reference, tool invoked, policy decision, human approval (if any), and outcome (SUB-0016).
- Audit read/export access is itself a permissioned, logged action, preventing silent bulk exfiltration of audit history.
- Structured logs redact `RESTRICTED_FINANCIAL`/`SECURITY_SECRET` values by a uniform logging middleware, not per-call-site developer discipline.

## 12. Threat model summary (STRIDE)

| Entry point | Primary threats | Primary controls |
|---|---|---|
| Public API | Spoofing, tampering, information disclosure, elevation of privilege | OIDC/OAuth2, tenant derivation from credential (§2), RBAC/ABAC (§3), RLS (§4) |
| Customer Portal | Session hijack, unauthorized subscription change | Account-scoped session, signed short-lived links, audited self-service mutations |
| Inbound provider webhooks | Spoofing, tampering, replay | Signature verification, timestamp tolerance, provider-account mapping, event-ID dedup |
| Outbound merchant webhooks | Tampering, replay by compromised endpoint | HMAC signing with rotation, TLS-only delivery |
| AI gateway | Prompt injection, exfiltration via tool misuse, elevation via tool call | Model/tool allowlist, grounding-only context, tenant-filtered retrieval, no direct financial write path (SUB-0016) |
| Support/operator tooling | Elevation of privilege, cross-tenant disclosure | Time-bound break-glass, full audit, least-privilege scoped views (§10) |

## 13. Compliance alignment statement

| Framework | Architectural alignment stated here | Evidence still required |
|---|---|---|
| PCI DSS scope minimization | Tokenization-only design (§8) | QSA scope validation against the deployed environment |
| SOC 2 | Access control, change management (audit, approvals), encryption, availability design (SUB-0018) | Formal control narrative, operating-effectiveness evidence over an observation period, independent auditor engagement |
| ISO 27001 | Asset classification (§7), risk register (below), key/secret management (§5–§6) | Formal ISMS documentation, management review cadence, certification audit |
| GDPR / regional privacy laws | Data classification, retention, erasure/pseudonymization workflow, residency hooks (SUB-0012 §8) | Legal review of lawful basis, DPIA where required, jurisdiction-specific launch decisions |

## 14. Risk register

| ID | Threat | Likelihood | Impact | Mitigation | Residual risk decision |
|---|---|---|---|---|---|
| RISK-001 | Cross-tenant data leakage via a missed tenant filter | Medium | Critical | RLS defense in depth + mandatory application filter + automated negative isolation tests | Accepted with continuous automated test coverage |
| RISK-002 | Payment credential exposure through logging/tracing | Low–Medium | Critical | Redaction middleware, never-accept-raw-PAN API design | Accepted with automated log-content scanning as a release gate |
| RISK-003 | Prompt injection leading to an unauthorized-looking AI recommendation | Medium | High | Grounding isolation, tool authorization identical to the human path, mandatory approval for financial actions (SUB-0016) | Accepted; AI cannot itself cause a financial effect without independent authorization |
| RISK-004 | Webhook signing-secret compromise enabling forged inbound events | Low | High | Signature + timestamp + account-mapping validation, secret rotation, quarantine on ambiguity | Accepted with rotation SLA |
| RISK-005 | Insider/support over-access across tenants | Low | High | Time-bound break-glass, least-privilege scoped views, full audit | Accepted with audit review cadence |
| RISK-006 | Idempotency/approval-workflow bypass causing a duplicate or unauthorized financial effect | Low | Critical | Idempotency contract tests, maker-checker enforcement, release-blocking financial-invariant test suite | Accepted with mandatory test gate |

## 15. Security requirements by module

| Module | Key requirement |
|---|---|
| Identity & Tenant | Tenant derivation exclusively from verified context (§2); MFA on every privileged session |
| Catalog & Pricing | Maker-checker on activation; typed rule language with no code execution (§9) |
| Subscriptions | Elevated permission for backdating/termination (SUB-0005 §2) |
| Usage & Rating | Source-event dedup as the primary injection/duplication control (SUB-0012 §4.5) |
| Billing & Invoicing | No update/delete grant on posted invoice lines (SUB-0012 §4.6) |
| Payments | No raw credential storage; provider adapter isolation (§8) |
| Collections | No protected attributes in risk scoring (SUB-0009 §5); separation of duties on exception approval |
| Revenue & Accounting | No update/delete grant on journal entries (SUB-0012 §4.8) |
| AI gateway | Governed per SUB-0016; every tool call requires the same authorization a human action would need |
| Integration framework | Credential storage exclusively in secrets manager; egress allowlist for outbound callbacks |

## 16. Acceptance criteria

1. Every entry point in §12 has a documented control set and at least one automated test covering its primary threat.
2. No `SECURITY_SECRET`- or raw-payment-credential-classified field appears in logs, traces, events, or audit diffs (automated scan).
3. Tenant-isolation negative tests pass for every data path in §4.
4. Every maker-checker-governed action type has an automated test proving the maker cannot self-approve.
5. The AI gateway cannot invoke a financially material action without a distinct, independently authorized command.
6. Every risk-register entry (§14) has an assigned owner and residual-risk decision before the Gate 4 implementation gate.
7. No compliance claim in §13 asserts certification without actual audit status backing it.

## Decisions Requiring Product Owner Approval

| ID | Decision needed | Status |
|---|---|---|
| DEC-031 | Break-glass audit review cadence and anomaly-alerting threshold | Open |
| DEC-032 | Target certification roadmap (SOC 2 Type I/II timing, ISO 27001 scope) | Open |
| DEC-033 | Penetration testing cadence and scope before first production launch handling live payment data | Open |

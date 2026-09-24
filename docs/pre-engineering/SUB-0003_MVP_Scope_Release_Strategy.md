# SUB-0003 — MVP Scope & Release Strategy

**Document ID:** SUB-0003
**Title:** MVP Scope & Release Strategy
**Version:** 0.1 (Draft)
**Status:** Draft
**Owner:** Enterprise Product Manager
**Reviewers:** CPO, Finance, Architecture, Engineering leadership
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23
**Dependencies:** [SUB-0001](SUB-0001_Product_Requirements_Document.md), [SUB-0002](SUB-0002_Competitive_Capability_Matrix.md)
**Related Documents:** SUB-0021 MVP Delivery Backlog (planned)

## 1. Release horizons

| Horizon | Definition |
|---|---|
| **MVP** | The smallest coherent, demonstrable, end-to-end commercial-to-cash vertical slice for mid-market B2B SaaS, sufficient to launch commercially and validate the platform's differentiators. |
| **Release 2 (R2)** | Capabilities that extend the MVP's commercial and operational reach — contracts, entitlements, advanced rating, payment orchestration, tax abstraction, leakage detection, multi-currency/entity, ERP integration, advanced collections workflows. |
| **Enterprise** | Capabilities required for large, regulated, or globally distributed customers — revenue recognition, marketplace settlement, advanced reconciliation, advanced CPQ, bounded AI agents at higher autonomy, regional deployment, configuration promotion, enterprise governance. |

## 2. Capability classification

Every core capability from SUB-0001 §9, plus every capability from SUB-0002 §2, is classified below. `Deferred` means intentionally out of scope for all three horizons pending future business justification (currently none — every capability has a horizon).

| Capability | MVP | R2 | Enterprise |
|---|:---:|:---:|:---:|
| Authentication (OIDC/SAML/MFA) | ✅ | | |
| Tenant management (shared, RLS-isolated) | ✅ | | |
| Tenant management (dedicated deployment) | | | ✅ |
| Customer/account | ✅ | | |
| Product catalog (versioned) | ✅ | | |
| Contracts / CPQ | | ✅ (basic) | ✅ (advanced) |
| Basic pricing (flat, per-seat, one-time, tiered, usage) | ✅ | | |
| Advanced pricing (matrix, attribute-based, dynamic, outcome-based, revenue share) | | ✅ | |
| Entitlements | | ✅ | |
| Subscriptions | ✅ | | |
| Basic usage metering | ✅ | | |
| Advanced metering (millions of events/minute, complex dimensions) | | ✅ | |
| Real-time rating | ✅ | | |
| Billing | ✅ | | |
| Invoicing | ✅ | | |
| Tax (evidence-only) | ✅ | | |
| Tax (native determination) | | ✅ | |
| Payments (Stripe adapter) | ✅ | | |
| Payment orchestration (multi-gateway routing) | | ✅ | |
| Dunning (basic) | ✅ | | |
| Collections intelligence (deterministic risk + Next Best Action) | ✅ | | |
| Collections (payment plans, advanced workflows) | | ✅ | |
| Credits | ✅ | | |
| Refunds | ✅ | | |
| Disputes | ✅ (case capture) | ✅ (full workflow) | |
| Revenue recognition | | | ✅ |
| Reconciliation (automated) | | ✅ | ✅ (advanced) |
| Accounting subledger (balanced postings) | ✅ | | |
| Analytics (basic reporting) | ✅ | | |
| Analytics (custom report builder, forecasting) | | ✅ | |
| AI (grounded explanation, L0–L1) | ✅ | | |
| AI (bounded agents, L2) | | ✅ | |
| AI (policy-executed actions, L3) | | | ✅ |
| Workflows (visual builder) | | ✅ | |
| Rules engine (basic) | ✅ | | |
| Integrations (Stripe, tax evidence, email) | ✅ | | |
| Integrations (ERP, CRM, broad marketplace) | | ✅ | ✅ |
| Reporting (semantic-layer KPIs) | ✅ | | |
| Customer portal | ✅ | | |
| Notifications (email) | ✅ | | |
| Notifications (SMS/WhatsApp/push) | | ✅ | |
| Audit | ✅ | | |
| Marketplace support | | | ✅ |
| Multi-currency/multi-entity | | ✅ | |
| Configuration promotion (dev/test/UAT/prod) | | | ✅ |
| Regional deployment | | | ✅ |

## 3. MVP vertical slice

The MVP must demonstrate this exact end-to-end path reproducibly in a clean environment:

`create tenant → authenticate → create customer/account → activate a supported price → create subscription → ingest usage → preview/finalize invoice → attempt/fail/retry/succeed payment → allocate cash → explain the bill → verify audit and lineage`

Every capability marked `✅` under MVP in §2 exists to make this path real, not merely present in isolation.

## 4. Prioritization rationale

1. **Foundation before feature.** Tenant isolation, authentication, idempotency, and audit are prerequisites for every other capability's correctness claim — they are staffed first regardless of feature-level business value, because an unsafe foundation invalidates every capability built on it.
2. **Money-adjacent capabilities are never scoped down for speed.** Billing, invoicing, payments, and collections retain their full MVP-classified behavior (including immutability, idempotency, and traceability) even under schedule pressure, per PRIN-04 (SUB-0000).
3. **The differentiator ships in MVP.** Collections Intelligence (deterministic risk scoring and Next Best Action) is MVP-classified, not deferred, because it is the platform's primary commercial proof point (SUB-0000 §6).
4. **Deferred capabilities are deferred by design, not by oversight.** Every non-MVP row in §2 has an explicit R2 or Enterprise horizon and a stated trigger for revisiting it (§6), so scope decisions are visible and reversible rather than silently forgotten.

## 5. MVP success criteria

| Criterion | Target |
|---|---|
| End-to-end vertical slice (§3) | Passes reproducibly in a clean environment, not as a one-off demo |
| Billing accuracy | ≥ 99.99% of finalized invoice lines match golden calculations (SUB-0019) |
| Duplicate financial effect rate | Zero |
| Tenant isolation | Full isolation test matrix passes with zero exceptions (SUB-0014, SUB-0019) |
| Payment & Collections Intelligence coverage | Every account with an open or upcoming invoice returns a risk band, preferred channel, and next action |
| Subscriber self-service completion | Portal supports the full explain → pay → change → cancel journey without a support contact for the golden-path scenario |

## 6. MVP exit criteria

The MVP is exit-ready (eligible for Release 2 planning) when:

1. Success criteria in §5 are met in production for at least one live commercial tenant.
2. Payment success rate, collection rate, and recovered-revenue metrics are baselined and trending in the expected direction.
3. No open Severity 1/2 financial-correctness defect exists.
4. At least one R2-classified capability has a documented trigger event observed (e.g., a customer requiring multi-currency, a tenant requiring dedicated deployment) justifying its prioritization.

## 7. Scope exclusions (explicit MVP non-goals)

- Full CPQ, negotiated contract authoring, or contract amendment workflows.
- ASC 606/IFRS 15 revenue recognition engine.
- Marketplace seller onboarding, split settlement, or commission accounting.
- Real-time multi-gateway payment routing (a connector abstraction and Stripe adapter only).
- Native tax determination or filing.
- Multi-entity consolidation, cross-ledger accounting, or regional data residency deployments.
- AI autonomy above L1 (advisory/recommendation) for any financially material action.
- Telecom-scale mediation throughput without a benchmarked and business-approved target (Decision DEC-004).

## 8. Technical debt intentionally accepted

| Debt item | Why accepted for MVP | Trigger to revisit |
|---|---|---|
| Shared-cluster tenancy (no per-tenant database) | Provisioning speed and operational simplicity at MVP tenant counts | Contractual/regulatory isolation requirement or measured noisy-neighbor limit (SUB-0011) |
| PostgreSQL-native search | Avoids operating a dedicated search cluster before relevance/scale evidence exists | Search latency or relevance regression at measured scale |
| Database-backed job scheduling instead of a dedicated workflow engine | Avoids premature operational complexity | Workflow volume/complexity crosses a measured threshold (SUB-0011 ADR) |
| Single-region deployment | No launch tenant requires data residency yet | First tenant with a hard residency requirement |
| AI limited to L0–L1 autonomy | Governance and evaluation maturity not yet proven at L2+ | Evaluation framework and policy engine pass governance review (SUB-0016) |

## 9. Risks of deferral

| Deferred capability | Risk if deferred too long | Mitigation |
|---|---|---|
| Revenue recognition | Enterprise prospects with ASC 606/IFRS 15 obligations cannot adopt the platform | Domain concepts (Revenue Schedule) are reserved from MVP so no data-model rework is needed later (SUB-0004) |
| Multi-currency/multi-entity | International or multi-brand customers are blocked | Currency and legal-entity keys exist in the MVP schema even though only one combination is active (SUB-0004, SUB-0012) |
| Payment orchestration (multi-gateway) | Regional payment-method gaps and single-provider risk | Canonical, provider-neutral payment model from MVP avoids a rewrite when the second adapter is added (SUB-0009) |
| Tax native determination | Manual tax handling burden for early customers | Tax evidence model captures inputs/results reproducibly, so a provider can be plugged in without re-deriving history (SUB-0008) |
| AI L2/L3 autonomy | Slower realization of "Autonomous Revenue Operations" differentiator | L0–L1 already deliver grounded explanation and preventive collections value; L2/L3 is an additive capability, not a blocking dependency (SUB-0016) |

## Decisions Requiring Product Owner Approval

| ID | Decision needed | Status |
|---|---|---|
| DEC-009 | Confirm MVP capability classification in §2 as final before backlog conversion (SUB-0021) | Open |
| DEC-010 | Approve MVP exit criteria (§6) as the gate for Release 2 planning kickoff | Open |

These are added to the Human Decision Register maintained authoritatively in [SUB-0001](SUB-0001_Product_Requirements_Document.md) §19.

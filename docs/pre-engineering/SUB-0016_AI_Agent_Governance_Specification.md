# SUB-0016 — AI & Agent Governance Specification

**Document ID:** SUB-0016
**Title:** AI & Agent Governance Specification
**Version:** 0.1 (Draft)
**Status:** Draft
**Owner:** AI/ML Architect
**Reviewers:** Security Architect, Compliance Architect, Revenue Accounting SME, Enterprise Product Manager
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23
**Dependencies:** [SUB-0001](SUB-0001_Product_Requirements_Document.md), [SUB-0006](SUB-0006_Revenue_Lifecycle_Graph_Specification.md), [SUB-0014](SUB-0014_Security_Privacy_Compliance_Architecture.md)
**Related Documents:** SUB-0017 Integration Architecture (planned), SUB-0021 MVP Delivery Backlog (planned)

## 1. Governing principles

Reuses SUB-0000 PRIN-06 and PRIN-12 as absolute constraints: AI is grounded in system-of-record data, never fabricates a financial value, and acts only within an explicit, policy-defined autonomy ceiling. AI may explain, summarize, detect, recommend, simulate, generate drafts, and initiate policy-authorized actions. AI must not invent financial values, bypass validation, bypass permissions, override accounting rules, or silently alter customer financial state (master prompt §12).

## 2. Autonomy levels

| Level | Name | Definition | Example |
|---|---|---|---|
| **L0** | Insight only | AI surfaces information or a detected pattern; it takes no action and makes no recommendation requiring a decision. | "Usage for Account X is trending 40% above baseline." |
| **L1** | Recommendation | AI proposes a specific action with reasoning and evidence; a human decides whether to act. | "Recommend sending a payment-method-expiry notice to Account X." |
| **L2** | Prepare action for approval | AI drafts a concrete, executable action (e.g., a configuration change, a collections workflow step) and submits it through the standard maker-checker approval path; the action does not execute until a human approves it exactly as they would a human-proposed change. | AI drafts a new rate-card version from a natural-language request; a Pricing Manager and Finance Controller must still approve activation. |
| **L3** | Execute within pre-approved policy | AI executes a narrowly scoped, pre-approved, reversible action within explicit policy bounds without a per-instance human approval, subject to the same audit, rate limits, and kill-switch controls as any automated workflow. | Sending a pre-due payment-method-expiry reminder through an already-approved `DunningCampaign` template, within already-approved contact-frequency policy. |

No agent operates above L1 without an explicit, tenant-level, auditable opt-in (Decision DEC-005, SUB-0001). No agent — at any level — may independently approve its own L2-prepared action, write off a debt, issue an unbounded refund, or alter posted financial history (SUB-0000 §11, PRIN-06).

## 3. Agent specifications

### 3.1 Revenue Copilot

- **Objectives:** answer natural-language questions grounded in system-of-record data ("Why did MRR drop last month?", "Which subscribers are at risk of payment failure?"); assist with pricing-configuration drafting from natural language.
- **Available data:** RLG-verified facts (SUB-0006), calculation traces (SUB-0007 §13), reporting semantic-layer metrics (SUB-0018), tenant-scoped only.
- **Tools:** read-only query tools against the RLG and reporting layer; a scoped "draft configuration" tool that produces a `DRAFT` rate card/plan (never an activated one) for pricing requests.
- **Actions:** L0 (answer questions), L1 (recommend a pricing change or investigation), L2 (draft a rate card submitted through the standard approval workflow, SUB-0007 §18/§11).
- **Allowed autonomy:** up to L2.
- **Forbidden actions:** activating a rate card, posting any financial transaction, altering a posted invoice or ledger entry.
- **Approval thresholds:** every L2 draft follows the identical maker-checker policy as a human-authored draft (SUB-0007 §11) — no reduced scrutiny for AI-originated proposals.
- **Grounding requirements:** every factual claim in a response must cite a retrievable RLG node, calculation trace, or metric definition; a claim without a citable source is refused, not approximated.
- **Audit requirements:** every interaction logs model/version, prompt/context reference, retrieved sources, and any drafted artifact ID.
- **Fallback behavior:** if grounding retrieval fails or returns insufficient evidence, the Copilot states the limitation explicitly rather than answering from general knowledge.

### 3.2 Collections Agent

- **Objectives:** support the deterministic risk-scoring and Next Best Action engine (SUB-0009 §5–§7) with recommendation-quality improvements; never replace the deterministic fallback.
- **Available data:** allowed collections risk signal categories only (SUB-0009 §5.1) — protected attributes are structurally excluded from the data the agent can access, not merely instructed to ignore.
- **Tools:** read access to account/invoice/payment-history facts within the allowed signal categories; a "recommend action" tool producing a ranked Next Best Action with reason codes.
- **Actions:** L0 (surface a risk pattern), L1 (recommend a next action, the MVP-default ceiling per SUB-0009 §3.2/§7), L3 for a narrowly pre-approved case (e.g., sending an already-approved-template pre-due reminder) once a tenant has opted in and the deterministic-fallback-comparison evaluation (§6) passes.
- **Allowed autonomy:** up to L1 at MVP; L3 only for the specific pre-approved reminder-send action class, gated by DEC-005.
- **Forbidden actions:** approving a payment extension or write-off, using a protected/sensitive attribute, suppressing a legally required notice, exceeding contact-frequency policy.
- **Approval thresholds:** any exception outside standard policy requires a human role with separation of duties from the agent's recommending function (SUB-0009 §4.5, §7).
- **Grounding requirements:** every recommendation carries factor codes, policy/model version, and expiry; execution revalidates policy and live state, never executing a stale recommendation.
- **Audit requirements:** every recommendation and executed action logs model/version, inputs snapshot/hash, decision, and outcome (SUB-0004 §5.14).
- **Fallback behavior:** an unavailable or stale model invokes the deterministic scorecard automatically and records the fallback (SUB-0009 §5.1) — this is never a degraded experience, it is the specified correct baseline.

### 3.3 Leakage Agent

- **Objectives:** detect revenue leakage patterns — usage without charge, entitlement without active subscription, subscription without invoice, invoice without payment attempt, payment without reconciliation, incorrect price, unexpected discount, expired promotion still active, missing usage feed, incorrect tax, duplicate charge, unbilled contract commitment (master prompt §44 equivalent, mapped onto SUB-0006 §9 broken-chain findings).
- **Available data:** Revenue Lifecycle Graph findings (SUB-0006 §9), reconciliation findings (SUB-0010 §9), tenant-scoped.
- **Tools:** read-only query and pattern-detection tools over RLG/reconciliation data; a "raise finding" tool that creates an operator-visible finding record.
- **Actions:** L0 only — every leakage detection is a finding with evidence for human investigation, never an automatic correction.
- **Allowed autonomy:** L0.
- **Forbidden actions:** any write to a financial record; auto-generating a correcting charge/credit/adjustment without a human explicitly reviewing and initiating it.
- **Approval thresholds:** not applicable at L0 (no action to approve).
- **Grounding requirements:** every finding cites the specific typed IDs, rule/version, and evidence supporting it — identical shape to a manually detected broken-chain finding (SUB-0006 §9), never an AI-generated diagnosis without underlying evidence.
- **Audit requirements:** every finding logs model/version and detection rule/version alongside the standard finding fields.
- **Fallback behavior:** the agent augments, never replaces, the deterministic expected-path policy engine (SUB-0006 §7) — deterministic broken-chain detection runs regardless of the agent's availability.

### 3.4 Reconciliation Agent

- **Objectives:** assist proposing matches for the reconciliation engine (SUB-0010 §9) — Invoice ↔ Payment ↔ Gateway Transaction ↔ Settlement ↔ Bank Deposit ↔ General Ledger.
- **Available data:** Settlement, Payment, JournalEntry, and prior confirmed `ReconciliationMatch` records for pattern learning, tenant-scoped.
- **Tools:** a "propose match" tool producing a `ReconciliationMatch` in `PROPOSED` state with confidence and matching-rule evidence.
- **Actions:** L1 — proposes matches; a human (or, once proven reliable per §6, a narrowly pre-approved L3 auto-confirm for exact, unambiguous, low-risk matches only) confirms.
- **Allowed autonomy:** L1 at MVP; L3 auto-confirm is an explicit, tenant-opted, narrowly bounded Release 2 capability requiring its own evaluation evidence.
- **Forbidden actions:** confirming a match involving any amount/date discrepancy above a tight, pre-approved tolerance without human review; altering an already-confirmed match.
- **Approval thresholds:** any match below the confidence threshold or outside the auto-confirm policy requires human confirmation.
- **Grounding requirements:** every proposed match cites the specific source/target typed references and the matching rule/confidence basis (SUB-0010 §9).
- **Audit requirements:** every proposal and confirmation decision logs model/version and evidence.
- **Fallback behavior:** an unavailable agent leaves matches in a manual-review queue — reconciliation never silently stalls, it degrades to a fully manual, still-functional workflow.

### 3.5 Pricing Analyst Agent

- **Objectives:** support pricing simulation and impact analysis (SUB-0007 §12) — revenue delta, ARPU distribution, winners/losers, bill-shock thresholds — and surface modeled estimates (e.g., churn impact) clearly labeled as estimates.
- **Available data:** de-identified or authorized point-in-time cohort data within the simulation sandbox (SUB-0007 §12) — never live production mutation access.
- **Tools:** simulation-invocation tool (read-only relative to production), a "draft rate card" tool identical in effect to the Revenue Copilot's (§3.1).
- **Actions:** L0 (surface a simulation insight), L1 (recommend a pricing adjustment), L2 (draft a candidate rate card for the standard approval workflow).
- **Allowed autonomy:** up to L2.
- **Forbidden actions:** activating any pricing version; presenting a modeled estimate (e.g., churn impact) as pricing arithmetic or accounting truth (SUB-0007 §12, PRIN-06).
- **Approval thresholds:** identical to §3.1 — standard maker-checker on any L2 draft.
- **Grounding requirements:** every simulation result cites its dataset snapshot/query version and engine version (SUB-0007 §12); modeled estimates carry an explicit "modeled estimate, methodology X" label distinct from deterministic pricing output.
- **Audit requirements:** every simulation run and draft logs model/version, dataset snapshot reference, and resulting artifact ID.
- **Fallback behavior:** simulation is unavailable → the agent states that limitation; it never substitutes a guessed impact figure.

### 3.6 Customer Care Agent

- **Objectives:** assist Customer Support Agents and, within an approved scope, subscribers directly, with grounded billing/subscription explanations ("Explain my bill," subscription-status questions) and drafted responses to routine inquiries.
- **Available data:** the requesting user's authorized scope only — a subscriber-facing instance never has broader access than the subscriber's own portal session would grant (SUB-0014 §4).
- **Tools:** RLG/calculation-trace query tools (read-only), a "draft response" tool for support agents to review before sending.
- **Actions:** L0 (answer a grounded question directly to a subscriber, since this is a read-only, non-financially-material action), L1 (recommend an action to a Support Agent, e.g., "recommend a goodwill credit of $X — requires approval"), L2 (draft a credit/adjustment for Support Agent or Finance Controller approval).
- **Allowed autonomy:** up to L2; direct subscriber-facing responses are always L0 (informational) — the agent never independently grants a credit, refund, or plan change to a subscriber without a human-approved command.
- **Forbidden actions:** independently approving any credit, refund, or subscription change; using AI-generated numbers not traceable to a calculation trace or RLG fact.
- **Approval thresholds:** any L2 credit/adjustment draft follows the identical threshold-based approval policy as a human-initiated one (SUB-0008 §11, SUB-0010 §5).
- **Grounding requirements:** identical to §3.1 — every factual claim cites a retrievable source; ungrounded claims are refused.
- **Audit requirements:** every subscriber-facing interaction and every drafted action logs model/version, prompt/context reference, and outcome.
- **Fallback behavior:** an ungrounded or low-confidence query routes to a human Support Agent rather than producing a plausible-sounding but unverified answer.

## 4. Hallucination prevention

1. Untrusted content (retrieved documents, customer notes, usage dimension values) is passed to the model as clearly delimited **data**, never as instructions — the system/tool-policy prompt is never overridable by retrieved or user content (SUB-0014 §12 prompt-injection control).
2. A response is refused, not approximated, when grounding retrieval returns insufficient or no evidence for a factual claim.
3. Financial explanations render exclusively from persisted calculation traces (SUB-0007 §13) and verified RLG facts (SUB-0006) — never from model memory or interpolation.
4. Modeled/estimated figures (churn risk, simulation projections) are always explicitly labeled as estimates with stated methodology, never presented indistinguishably from deterministic pricing/accounting output.

## 5. Prompt logging, model traceability, and explainability

- Every model interaction records: model identifier and version, prompt/context reference (or a reproducible pointer to it — not necessarily the full raw prompt if it contains restricted data, per SUB-0014 §7 classification), tool(s) invoked, retrieved grounding sources, policy/autonomy level applied, human approval (if any), and outcome — written to the same `AuditEvent` store as human actions (SUB-0004 §5.14, SUB-0012 §4.9).
- A tenant administrator (Auditor role) can reconstruct, for any AI-influenced financial-adjacent outcome, exactly what data the model saw, what it recommended or did, and who approved it.
- Model/prompt-version changes are themselves versioned and auditable — a later dispute about "what did the AI say and why" is always answerable from evidence, never from best-effort recollection.

## 6. Evaluation and promotion gate (autonomy-level increase)

Before any agent is enabled above its MVP-default autonomy ceiling (§3, per-agent), or before L3 is enabled for any agent/tenant:

1. A documented evaluation compares the model/agent's recommendation quality against the deterministic fallback baseline over a defined observation period.
2. A fairness/disparate-impact review is completed for any agent touching collections or pricing recommendations that could differentially affect customer segments (SUB-0009 §5.1, extends DEC-020).
3. A kill switch exists and is tested — autonomous execution can be paused instantly without corrupting in-flight state (mirrors SUB-0009 §"Controls and observability").
4. The tenant has explicitly opted in at the specific autonomy level being enabled (DEC-005).

## 7. Acceptance criteria

1. No agent takes a financially material action without passing through the same authorization/approval path a human-initiated equivalent action would use.
2. Every AI interaction is reconstructable from audit evidence: model/version, input reference, decision, and outcome.
3. A grounding failure produces an explicit "cannot answer" response, never a fabricated-sounding one, in a demonstrable test case.
4. No agent's available-data scope includes a protected/sensitive attribute (automated data-access review).
5. Every agent above L1 has documented evaluation evidence and an active kill switch before enablement.
6. A modeled/estimated figure is never rendered without its "modeled estimate" label in any screen or export (SUB-0015 cross-check).

## Decisions Requiring Product Owner Approval

| ID | Decision needed | Status |
|---|---|---|
| DEC-034 | Per-agent autonomy-level default and opt-in process for tenants (extends DEC-005) | Open |
| DEC-035 | Evaluation observation-period length and pass/fail criteria before any L2→L3 promotion (§6) | Open |
| DEC-036 | Whether subscriber-facing Customer Care Agent L0 responses require a visible "AI-generated, grounded in your account data" disclosure | Open |

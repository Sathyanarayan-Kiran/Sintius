# SUB-0015 — UX Information Architecture & Interaction Specification

**Document ID:** SUB-0015
**Title:** UX Information Architecture & Interaction Specification
**Version:** 0.1 (Draft)
**Status:** Draft
**Owner:** UX/Product Design Lead
**Reviewers:** Enterprise Product Manager, Principal Software Architect, Security Architect
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23
**Dependencies:** [SUB-0004](SUB-0004_Domain_Model.md)–[SUB-0014](SUB-0014_Security_Privacy_Compliance_Architecture.md)
**Related Documents:** SUB-0016 AI & Agent Governance Specification (planned), SUB-0021 MVP Delivery Backlog (planned)

## 1. Design intent

The product feels modern, premium, calm, responsive, understandable, fast, and transparent (SUB-0000 §13). It avoids dense ERP grids by default, unexplained financial values, unnecessary modal dialogs, hidden cancellation, and dark patterns. Every financial number is explainable; every material status has an obvious next action. Progressive disclosure governs density — complexity appears only when a user asks for it, never by default.

## 2. Primary navigation

Admin areas: **Home, Customers, Catalog, Pricing, Subscriptions, Usage, Billing, Payments, Collections, Revenue, Analytics, Workflows, Integrations, Developers, Settings.** The Subscriber Portal (§3.11) is a structurally distinct experience with its own shallow navigation, sharing only the underlying design language.

Global command/search bar: "Search customers, invoices, payments, subscriptions…" — permission-filtered before display (no existence leakage, SUB-0014 §3), keyboard-accessible (`Cmd/Ctrl+K`).

## 3. Screen specifications

Each screen states persona, purpose, information hierarchy, components, actions, permissions, error/empty/loading states, responsive behavior, keyboard behavior, accessibility.

### 3.1 Revenue Command Center (Home)

- **Persona:** Executive, Finance Controller, Billing Administrator.
- **Purpose:** answer "how much recurring revenue, how much is collected/overdue/at risk, where is revenue leaking, what changed since yesterday."
- **Information hierarchy:** KPI card row (ARR, MRR, NRR, GRR, Active Subscribers, Expansion/Churn MRR, Payment Success Rate, Collection Rate, DSO, Failed Payments, Recovered Revenue, Outstanding AR, Revenue at Risk) → trend charts → alerts feed → drill-down links.
- **Components/actions:** each KPI card links to a filtered Analytics view; alerts deep-link to the source object.
- **Permissions:** cards requiring `billing:read`/`collections:read` are omitted, not shown blank, for a role lacking them.
- **Error state:** a failed KPI card shows its own inline error/retry, not a full-page failure.
- **Empty state:** "No data yet for this tenant" for a new tenant, with a guided next action.
- **Loading state:** skeleton KPI cards, never a layout-shifting spinner.
- **Responsive:** below tablet width, KPI cards reflow 2-column then 1-column; charts default to their accessible table view.
- **Keyboard:** `g h` shortcut; KPI cards are tab-stops with Enter to drill down.
- **Accessibility:** every chart has a "View as table" control; trend indicators pair color with ▲/▼ icons and numeric delta text.

### 3.2 Customer 360

- **Persona:** Customer Support Agent, Billing Administrator, Finance Controller.
- **Purpose:** single-screen understanding of one customer's commercial and financial state.
- **Information hierarchy:** header (identity, ARR/MRR, balance, payment risk) → tabs (Overview, Subscriptions, Usage, Invoices, Payments, Contracts, Communications, Timeline) → right panel (Revenue Copilot suggested action, SUB-0016).
- **Components/actions:** each tab loads independently; the AI panel's "Act" button routes through the same authorized command a human action would use.
- **Permissions:** Contracts tab hidden entirely for a role without contract visibility.
- **Error state:** per-tab error boundary; other tabs remain usable.
- **Empty state:** a tab with no records shows a relevant next action (e.g., "Create subscription").
- **Loading state:** header skeleton + tab shell before content.
- **Responsive:** tabs collapse to a select control below tablet width; AI panel moves below the header.
- **Keyboard:** tabs are arrow-key navigable; `e` opens "Explain" on the active financial item.
- **Accessibility:** risk badge always paired with text, not color alone; AI panel is in a labeled landmark region.

### 3.3 Subscription Detail

- **Persona:** Billing Administrator, Customer Support Agent.
- **Purpose:** inspect and act on one subscription's canonical state (SUB-0005 §2).
- **Information hierarchy:** header (state badge, account link, next renewal, scheduled cancel_at) → items table → scheduled changes → billing schedule → change history timeline → action bar.
- **Components/actions:** action bar renders only state-machine-legal actions for the current state; "Terminate" appears under an overflow menu and only for a role holding the elevated permission.
- **Permissions:** backdating/termination actions omitted (not disabled) without the permission.
- **Error state:** action failures render the canonical problem detail inline near the action bar.
- **Empty state:** a `DRAFT` subscription with no items shows a guided "Add your first item" prompt.
- **Loading state:** header + item-table skeleton.
- **Responsive:** items and change history stack vertically; action bar becomes a bottom sheet.
- **Keyboard:** action bar buttons in visual tab order; `c` opens Cancel (documented shortcut, never the sole path).
- **Accessibility:** the state badge uses the exact canonical string as both visible text and `aria-label`.

### 3.4 Catalog

- **Persona:** Product Manager, Pricing Manager.
- **Purpose:** browse/manage the versioned product hierarchy (SUB-0004 §5.3).
- **Information hierarchy:** left tree (Portfolio → Family → Product) → right detail (version list with lifecycle badges, dependent Offers/Plans).
- **Components/actions:** "Diff" compares two versions field-by-field; publish readiness checklist on the selected version.
- **Permissions:** `+ New Product`/`Submit`/publish actions omitted without `catalog:*` permissions.
- **Error state:** version publish failure shows validation errors inline (overlap/gap detection).
- **Empty state:** a Family with no products shows "No products yet" with a create action.
- **Loading state:** tree skeleton + empty detail pane.
- **Responsive:** tree collapses to a breadcrumb-driven drill-down list below tablet width.
- **Keyboard:** tree uses standard ARIA `tree`/`treeitem` navigation.
- **Accessibility:** tree role state (`aria-expanded`/`aria-selected`) correctly reflects UI state.

### 3.5 Pricing Studio

- **Persona:** Pricing Manager, Finance Controller (approver).
- **Purpose:** compose, validate, simulate, and activate rate cards without code (SUB-0007).
- **Information hierarchy:** left (component palette) → center (visual pricing flow matching SUB-0007 §2's stage order) → right (properties of selected node) → bottom (simulator).
- **Components/actions:** `Simulate` with production cohort data requires a distinct permission from basic authoring; `Activate` is never directly available without approval — it routes to "Submit for approval."
- **Permissions:** approval-pending state shown until Finance Controller decides.
- **Error state:** validation errors (gap/overlap/currency mismatch) attach to the specific offending node on canvas.
- **Empty state:** a new rate card shows a guided empty canvas with "Add your first rule."
- **Loading state:** canvas skeleton.
- **Responsive:** explicitly desktop-first; shows a "best viewed on a larger screen" notice below a documented minimum width rather than a broken canvas.
- **Keyboard:** every canvas operation has a keyboard-operable equivalent panel (structured, non-drag node editor).
- **Accessibility:** each canvas node is a focusable element with a text description equivalent to its visual content.

### 3.6 Usage Explorer

- **Persona:** Billing Administrator, Customer Support Agent, Developer.
- **Purpose:** inspect ingested usage, disposition, aggregation, and rating outcomes.
- **Information hierarchy:** filter bar (meter, subscription item, window) → event/aggregate table with disposition badges → drill into one event's rating/charge lineage.
- **Components/actions:** row-level "view"/"why" opening the rating calculation trace or rejection reason.
- **Permissions:** detailed calculation traces require `pricing:trace:read`; raw dimension values may be redacted per role.
- **Error state:** filter validation errors (e.g., invalid window) inline near the filter bar.
- **Empty state:** "No usage received for this window" distinguished from "No usage matches this filter."
- **Loading state:** table skeleton with filter bar active.
- **Responsive:** table collapses to a card list with the same fields stacked.
- **Keyboard:** table row navigation via arrow keys, Enter opens detail drawer.
- **Accessibility:** disposition badges include text; "why" always yields a text explanation, never only an icon tooltip.

### 3.7 Invoice Detail

- **Persona:** Billing Administrator, Finance Controller, Customer Support Agent.
- **Purpose:** inspect, explain, and act on one invoice across its three independent state dimensions (SUB-0005 §3).
- **Information hierarchy:** header (number, amount, due date, document/receivable/delivery state badges, each individually labeled) → action bar (Collect, Send, Download, Credit, Dispute, Void, More) → expandable line items → "Explain this invoice" panel.
- **Components/actions:** expandable lines resolve to calculation trace (SUB-0007 §13).
- **Permissions:** Credit/Write-off/Void omitted without the specific permission.
- **Error state:** blocked finalize (surfaced from the billing-run flow) shows the specific blocker.
- **Empty state:** not applicable — an invoice always has ≥1 line once it exists.
- **Loading state:** header + line skeleton.
- **Responsive:** action bar becomes a bottom sheet; lines remain individually expandable.
- **Keyboard:** `e` opens Explain; line items expandable via Enter/Space.
- **Accessibility:** the three state badges are each individually labeled, never merged into one ambiguous string.

### 3.8 Payment Detail

- **Persona:** Billing Administrator, Finance Controller, Customer Support Agent.
- **Purpose:** inspect one logical payment, its attempts, allocations, refunds (SUB-0005 §4–§5, §8).
- **Information hierarchy:** header (state badge, amount, method) → attempts timeline with canonical reason codes → allocations → refunds → related invoices.
- **Components/actions:** `Retry`, `Cancel`, `Refund`, and a distinctly-permissioned "Mark externally paid" requiring evidence attachment.
- **Permissions:** "Mark externally paid" omitted entirely without its dedicated permission.
- **Error state:** a failed manual retry shows the canonical problem detail inline.
- **Empty state:** "No attempts yet" for a `CREATED` payment.
- **Loading state:** header + timeline skeleton.
- **Responsive:** attempts/allocations/refunds stack vertically; action bar becomes a bottom sheet.
- **Keyboard:** attempts timeline is a navigable list.
- **Accessibility:** `UNKNOWN`/reconciliation-required state is never conveyed by color alone.

### 3.9 Collections Command Center

- **Persona:** Collections Analyst, Collections Manager, Finance Controller.
- **Purpose:** operations cockpit for preventive and recovery collections (SUB-0009 §4–§7).
- **Information hierarchy:** top KPI strip (Receivable, At Risk, Overdue, Payment Success %) → queues (Upcoming high risk, Method expiring, Due today, Failed/retry, High-value past due, Promise due/broken, Disputed/on hold, Manual review) → selected-case detail with recommended next action.
- **Components/actions:** `Execute`, `Skip`, `Escalate`, `Hold`; recommended-action panel shows reason codes and policy version on hover/expand.
- **Permissions:** an agent cannot approve their own escalation exception; `Escalate` omitted without the separated-duties permission.
- **Error state:** `Execute` failure (policy revalidation blocks it at execution time) shows the specific stop reason.
- **Empty state:** a queue with zero items shows "Nothing needs attention here right now" — a positive empty state.
- **Loading state:** KPI + queue skeleton.
- **Responsive:** queues stack above case detail with back-navigation instead of two persistent panes.
- **Keyboard:** queue list and case detail are independently scrollable with arrow-key row navigation.
- **Accessibility:** risk badges always paired with factor text; the recommended-action panel is a labeled landmark region.

### 3.10 Workflow Builder

- **Persona:** Billing Administrator, Collections Manager, Product Manager.
- **Purpose:** compose event-triggered rules/workflows visually (Trigger → Condition → Action → Wait → Branch → Approval → Integration).
- **Information hierarchy:** left palette → center flow canvas → right node properties → bottom simulation/impact panel.
- **Components/actions:** simulation reports affected accounts, projected action counts, frequency/quiet-hour violations, estimated exposure before publish.
- **Permissions:** publishing a workflow including any financially material action requires maker-checker; `Publish` omitted without the elevated permission.
- **Error state:** validation errors (unreachable branch, missing approval node before a sensitive action) attach to the specific node.
- **Empty state:** a new workflow shows a guided empty canvas.
- **Loading state:** canvas skeleton.
- **Responsive:** same desktop-first treatment as Pricing Studio (§3.5).
- **Keyboard:** same keyboard-operable canvas alternative as Pricing Studio.
- **Accessibility:** each node's text description states its full configuration, not only an icon.

### 3.11 Subscriber Portal

- **Persona:** Subscriber.
- **Purpose:** self-service financial home — understand and act on subscriptions, usage, bills, and payments without contacting support.
- **Information hierarchy:** Home (upcoming amount, overdue balance, autopay status, bill-shock alert) → Subscriptions → Usage → Bills → Payments/Payment Methods → Orders → Credits → Support.
- **Components/actions:** "Explain this bill" (shared component with Invoice Detail §3.7, subscriber-safe field scope); cancellation with equal visual prominence to upgrade, an optional single retention offer, and an unambiguous "No thanks, continue cancelling" path.
- **Permissions:** every session is implicitly scoped to one authenticated account; no route accepts an arbitrary account ID.
- **Error state:** a failed payment attempt shows a plain-language reason (mapped from the canonical reason code), never a raw provider error string.
- **Empty state:** "No bills yet" for a brand-new account.
- **Loading state:** skeleton summary card.
- **Responsive:** fully mobile-first; every primary action reachable without a mouse.
- **Keyboard:** `Pay now` is always the structurally primary tab-stop on Home.
- **Accessibility:** the usage-forecast comparison ("₹14,300 vs. ₹8,000") is available as plain text, not only a visual bar/gauge.

### 3.12 Revenue Lifecycle Graph (Transaction Explorer)

- **Persona:** Billing Administrator, Finance Controller, Auditor.
- **Purpose:** navigate forward/backward lineage from any node to Product/Offer or through to Journal Entry (SUB-0006).
- **Information hierarchy:** a horizontal, clickable node sequence with broken links visually flagged; each node shows business key, safe amount, timestamp, state.
- **Components/actions:** direction (`upstream`/`downstream`/`both`), type/depth/time filters; hovering an edge shows its meaning and authoritative source link.
- **Permissions:** authorization filters both nodes and attributes — access to an invoice does not imply access to gateway evidence.
- **Error state:** a stale (beyond freshness SLO) subgraph is visually distinguished and causal conclusions are suppressed.
- **Empty state:** a node with no traversable neighbors states that explicitly, distinguishing "nothing exists yet" from "you lack permission" per the non-leaking pattern (SUB-0014 §9).
- **Loading state:** node-sequence skeleton.
- **Responsive:** below tablet width, the node sequence becomes a vertically scrollable list retaining the same click/expand behavior.
- **Keyboard:** nodes are tab-stops; arrow keys move along the chain; Enter opens a node's detail drawer.
- **Accessibility:** broken-chain flags use both color and an icon/text label.

## 4. Progressive disclosure and shared state contract

Every screen above implements the same shared contract rather than inventing ad hoc variants:

| State | Rule |
|---|---|
| Loading | Skeleton matching the eventual layout, never a layout-shifting spinner-then-jump |
| Empty | Explains why (no data yet vs. filtered to zero) and offers the relevant next action |
| Error | Canonical problem `title`/`detail` (SUB-0013 §8) rendered safely, with retry for retryable failures |
| Partial/stale | Any projection-backed view shows an explicit freshness indicator, never presented as authoritative real-time state |
| Permission-denied | Generic, non-leaking message — never a raw status code shown to an end user |
| Destructive-action confirmation | Names the specific consequence and financial impact, keyboard-operable |
| Approval-pending | Visible status naming who/what is needed, never a silent no-op |

## 5. Global patterns

- **Status:** every badge uses the exact canonical vocabulary from SUB-0005, never a paraphrase.
- **Money:** explicit currency always shown; negatives/credits use both color and an explicit sign/label.
- **Dates/time zones:** business dates render in the account's business time zone with UTC available on hover for reconciliation.
- **Risk:** always renders with contributing factor codes accessible in the same view, never a bare color chip.
- **Calculation explanation:** one reusable "Explain" pattern, used identically in Invoice Detail, Portal Bills, and Usage Explorer; a missing/invalid trace states that limitation explicitly rather than generating a plausible-sounding fallback.
- **Audit timeline:** one reusable component (actor, action, object, reason, timestamp), populated identically everywhere it appears.

## 6. Acceptance criteria

1. Every screen in §3 has a documented purpose, persona, information hierarchy, actions, permissions, and all seven states in §4.
2. Every status badge uses the exact canonical vocabulary from SUB-0005 with no undocumented synonym.
3. A permission-restricted navigation item or action is verifiably absent (not merely disabled) for a role lacking the underlying permission, for every sensitive financial action.
4. Cancellation can be completed by a subscriber in no more steps than upgrading.
5. Every calculation "Explain" surface renders exclusively from a persisted calculation trace or Revenue Lifecycle Graph fact.
6. Keyboard-only operation completes every documented Admin and Portal primary workflow without a mouse, with the two desktop-first canvas exceptions (Pricing Studio, Workflow Builder) explicitly documented as such.
7. WCAG 2.2 AA is the release bar for both experiences.

## Decisions Requiring Product Owner Approval

None new; this document operationalizes decisions already recorded in SUB-0001 and SUB-0003 without introducing new commercial trade-offs.

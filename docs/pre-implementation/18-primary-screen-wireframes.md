# Wireframes for primary screens

**Version:** 0.1
**Status:** Low-fidelity layout and behavior specification
**Related:** [UX information architecture](17-ux-information-architecture.md) (shared patterns and state contract referenced throughout)

Each wireframe uses a low-fidelity ASCII layout plus the required behavioral detail. Shared patterns (status vocabulary, money, dates, risk, calculation explanation, audit timeline, RLG lineage panel, notifications, help, loading/empty/error/partial/permission-denied/destructive-action states) are defined once in deliverable 17 §8 and §10 and are referenced, not repeated, below except where a screen needs a variant.

---

## 1. Revenue Dashboard

**Purpose / personas:** deliverable 17 §5.1 — Executive, Finance Controller, Billing Administrator; answers the questions in master prompt §65.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Revenue Dashboard                         [tenant] [as of: 2m ago]  │
├─────────────────────────────────────────────────────────────────────┤
│ [ARR]   [MRR]   [NRR]   [GRR]   [Active Subs]  [Expansion MRR]      │
│ [Churn MRR] [Payment Success %] [Collection Rate] [DSO]             │
│ [Failed Payments] [Recovered Revenue] [Outstanding AR] [At Risk]    │
├───────────────────────────────┬───────────────────────────────────┤
│ MRR trend (12mo)  [chart]      │ Alerts feed                        │
│                                 │  - Gateway X elevated failures     │
│                                 │  - ₹4.2M revenue at risk this week │
│                                 │  - Duplicate invoice suspected     │
├─────────────────────────────────────────────────────────────────────┤
│ Drill-down: [Renewals this month] [Failed payments] [Leakage flags] │
└─────────────────────────────────────────────────────────────────────┘
```

- **Components/actions:** KPI card row (each clickable → filtered Analytics view), trend chart with accessible data-table toggle, alerts feed (each item deep-links to the source object), drill-down shortcuts.
- **States:** Loading = skeleton KPI cards. Empty = "No data yet for this tenant" (new tenant). Partial/stale = freshness badge in header, per KPI card if a specific metric's projector lags. Error = a failed KPI card shows its own inline error/retry, not a full-page failure. Permission-denied = cards requiring `analytics:read` are omitted, not shown blank.
- **Permissions/approval:** read-only screen; no approval states. Visibility of AR/collections KPIs requires `billing:read` or `collections:read` respectively.
- **Keyboard/mobile:** `g` `r` shortcut; KPI cards are tab-stops with Enter to drill down. Below tablet width, KPI cards reflow to 2-column, then 1-column; charts collapse to their accessible table view by default on phone width.
- **Accessibility:** every chart has an adjacent "View as table" control; color-only trend indicators are paired with ▲/▼ icons and numeric delta text.
- **RLG/evidence links:** "Revenue at risk" and "Leakage flags" open the Lineage panel (deliverable 17 §8.7) scoped to the flagged findings from deliverable 06 §8.

---

## 2. Customer 360

**Purpose / personas:** deliverable 17 §5.2, master prompt §67/§95 — Support, Billing Administrator, Finance Controller.

```
┌─────────────────────────────────────────────────────────────────────┐
│ ACME Corp · Enterprise        ARR ₹4.2M  Balance ₹342K  Risk: HIGH  │
├───────────────────────────────────────────────────────┬─────────────┤
│ [Overview][Subscriptions][Usage][Invoices][Payments]   │ AI Revenue  │
│ [Contracts][Communications][Timeline]                  │ Assistant   │
│                                                         │             │
│  (tab content area)                                    │ "Payment    │
│                                                         │  method for │
│                                                         │  upcoming   │
│                                                         │  ₹342K      │
│                                                         │  invoice    │
│                                                         │  expires in │
│                                                         │  9 days."   │
│                                                         │ [Act] [Dismiss]│
└─────────────────────────────────────────────────────────┴─────────────┘
```

- **Components/actions:** header identity/financial summary strip, tab navigation (§17 §5.2 hierarchy), AI Revenue Assistant panel showing a grounded suggested action with explicit source evidence link (never freeform prose without a citation, per deliverable 06 §1 and §17 §8.5).
- **States:** Loading = header skeleton + tab shell before content. Empty = a tab with no records ("No invoices yet for this account") with a relevant next action for Billing Administrator (e.g., "Create subscription"). Partial/stale = Timeline tab shows freshness watermark since it's projection-backed (deliverable 05 §6). Error = per-tab error boundary; other tabs remain usable. Permission-denied = Contracts tab hidden entirely for a role without contract visibility (Release 2 feature flag also applies).
- **Permissions/approval:** AI Assistant "Act" button routes to the same authorized command endpoint a human action would use (deliverable 15 §10); it never executes directly. If the suggested action requires approval, clicking "Act" opens the approval-pending state (deliverable 17 §10).
- **Keyboard/mobile:** tabs are arrow-key navigable; `e` opens "Explain" on the active financial item. Mobile collapses tabs to a select control (deliverable 17 §6.3) and moves the AI panel below the header.
- **Accessibility:** risk badge "HIGH" always paired with text, not color alone; AI panel is in a `region` landmark with a descriptive label so screen-reader users can skip to/past it.
- **RLG/evidence links:** every subscription/invoice/payment row cross-links (deliverable 17 §3.3); Timeline entries link to their source AuditEvent.

---

## 3. Subscription Detail

**Purpose / personas:** deliverable 17 §5.3 — Billing Administrator, Support; canonical state per deliverable 08.

```
┌─────────────────────────────────────────────────────────────────────┐
│ SUB-00481 · ACTIVE          Account: ACME Corp   Next renewal: ...  │
│ cancel_at: — (none scheduled)                                       │
├─────────────────────────────────────────────────────────────────────┤
│ Items                                                                │
│  • Enterprise Plan (base)         qty 1        active since ...     │
│  • Additional seats               qty 42       active since ...     │
├─────────────────────────────────────────────────────────────────────┤
│ Scheduled changes        Billing schedule        Change history     │
│  (none)                  Monthly, anchor 12th     [timeline]        │
├─────────────────────────────────────────────────────────────────────┤
│ [Pause] [Change plan] [Add item] [Change quantity] [Cancel] [More▾] │
└─────────────────────────────────────────────────────────────────────┘
```

- **Components/actions:** action bar renders **only** state-machine-legal actions for the current `state` (deliverable 08 §2 diagram) — e.g., "Resume" replaces "Pause" when `PAUSED`; "Terminate" only appears under `More▾` and only for a role holding the elevated permission (deliverable 08 §11).
- **States:** Loading = header + item-table skeleton. Empty = a `DRAFT` subscription with no items yet shows a guided "Add your first item" prompt. Partial/stale = not applicable (this is a transactional, not projected, view — no freshness badge needed since it reads authoritative state). Error = action failures render the canonical problem detail (deliverable 13 §11) inline near the action bar, not a toast that disappears before it's read. Permission-denied = the whole screen shows the permission-denied pattern (deliverable 17 §7) if the user lacks `subscription:read` for this account.
- **Destructive-action confirmation:** Cancel/Terminate open a confirmation naming the specific effective date and billing impact, sourced from `POST /subscriptions/{id}/preview-change` (deliverable 13 §16.3), matching deliverable 17 §9.3–9.4.
- **Permissions/approval:** backdating and termination require elevated permission/approval (deliverable 08 §11); the action button is omitted (not disabled) for a role lacking it, per deliverable 17 §7.
- **Keyboard/mobile:** action bar buttons are reachable via Tab in visual order; `c` opens Cancel dialog (documented shortcut, never the sole path). Mobile stacks items and change history vertically; action bar becomes a bottom sheet.
- **Accessibility:** the state badge (`ACTIVE`, `PAUSED`, etc.) uses the exact canonical string as both visible text and `aria-label`.
- **RLG/evidence links:** each item links to its pinned price component/version (deliverable 06 §4); Change history entries link to their `SubscriptionChange` record and any resulting proration calculation trace.

---

## 4. Product Catalog

**Purpose / personas:** deliverable 17 §5.4 — Pricing Manager, Product Manager.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Product Catalog                                    [+ New Product]  │
├───────────────┬─────────────────────────────────────────────────────┤
│ Portfolio      │ Product: Enterprise AI Platform                    │
│  Family: SaaS  │  Versions:                                         │
│   • Product A  │   v3  ACTIVE    eff. 2026-06-01                    │
│   • Product B◀ │   v4  IN_REVIEW eff. 2026-10-01  [Submit] [Diff v3]│
│  Family: Add-ons│  v2  RETIRED   eff. 2025-01-01 – 2026-06-01       │
├───────────────┴─────────────────────────────────────────────────────┤
│ Selected version v4 detail: attributes, tax/accounting class,       │
│ dependent Offers/Plans, publish readiness checklist                 │
└─────────────────────────────────────────────────────────────────────┘
```

- **Components/actions:** left tree (Portfolio → Family → Product), right detail with version list and lifecycle badges (`draft/in_review/active/retired`, deliverable 03 §"Product, Offer, Plan, and Rate Card"), "Diff" compares two versions field-by-field.
- **States:** Loading = tree skeleton + empty detail pane. Empty = a Family with no products shows "No products yet" with `+ New Product`. Partial/stale = not applicable (authoritative read). Error = version publish failure shows validation errors inline (overlap/gap detection per deliverable 03 §"Product..." invariants). Permission-denied = `+ New Product`/`Submit`/publish actions omitted without `catalog:*` permissions.
- **Permissions/approval:** publishing an Offer/Plan/ProductVersion follows the same maker-checker pattern as pricing activation where policy requires it (deliverable 13 §16.2).
- **Keyboard/mobile:** tree is arrow-key navigable (standard tree widget pattern); mobile collapses the tree to a breadcrumb-driven drill-down list instead of a persistent side panel.
- **Accessibility:** tree uses ARIA `tree`/`treeitem` roles with correct `aria-expanded`/`aria-selected` state.
- **RLG/evidence links:** version detail links to dependent Offers/Plans/Rate Cards and, once activated, to the count of subscriptions currently pinned to that version.

---

## 5. Pricing Designer

**Purpose / personas:** deliverable 17 §5.5, master prompt §6/§98 — Pricing Manager, Finance Controller (approver).

```
┌─────────────────────────────────────────────────────────────────────┐
│ Rate Card: Enterprise AI Platform v4 (DRAFT)     [Validate][Simulate]│
├───────────┬─────────────────────────────────────┬───────────────────┤
│ Components │  [Base Fee]→[100 seats incl.]→      │ Properties        │
│  Recurring │  [+$15/seat]→[10M tokens incl.]→    │  Selected: Tier 2 │
│  Tiered    │  [$0.001/token overage]→[+5% support]│  Rate: 8.00 INR   │
│  Usage     │                          ↓            │  Range: (100,1000]│
│  Discount  │                    [Minimum $36,000/yr]│  Rounding: HALF_UP│
│  Minimum   │                                        │  Trace label: ... │
├───────────┴─────────────────────────────────────┴───────────────────┤
│ Simulator: [Load cohort: Last 10,000 customers ▾]  [Run]             │
│  Revenue impact: +4.2%   ARPU: +₹212   Winners: 8,412  Losers: 214   │
│  Bill-shock risk: 12 accounts >25% increase   [View list]            │
└─────────────────────────────────────────────────────────────────────┘
```

- **Components/actions:** left palette (drag or keyboard-insert per deliverable 17 §6.4), center visual flow matching the pricing stage order (deliverable 12 §3 — stages cannot be reordered implicitly), right properties panel for the selected node, bottom simulator (deliverable 12 §17).
- **States:** Loading = canvas skeleton. Empty = a new rate card shows a guided empty canvas with "Add your first component." Partial/stale = simulator results show the snapshot/version they ran against (deliverable 12 §17 "reproducible dataset snapshot"), never implied to be live. Error = validation errors (gap/overlap/currency mismatch, deliverable 12 §14 compiler checks) attach to the specific offending node on canvas, not only a generic banner. Permission-denied = `Simulate` with production cohort data requires a distinct permission from basic authoring (deliverable 12 §21); `Activate` is a separate elevated action.
- **Destructive/approval:** `Activate` is never available directly from this screen for a role without approval permission; it routes to `Submit for approval` and shows the approval-pending state (deliverable 17 §9.5, §10) until Finance Controller decides.
- **Keyboard/mobile:** every canvas operation (add node, connect, reorder within allowed stages) has a keyboard-operable equivalent panel (deliverable 17 §6.4); this screen is explicitly desktop-first per deliverable 17 §6.3 and shows a "best viewed on a larger screen" notice below the documented minimum width rather than a broken canvas.
- **Accessibility:** each canvas node is a focusable element with a text description equivalent to its visual content (e.g., "Tier 2: quantity (100,1000], rate 8.00 INR").
- **RLG/evidence links:** once activated, the rate card's node links forward to every subscription item that selects it (deliverable 06 §4 `PRICED_BY`).

---

## 6. Usage Explorer

**Purpose / personas:** deliverable 17 §5.6 — Billing Administrator, Support, Developer.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Usage Explorer   Meter: [API_CALL ▾]  Subscription item: [_______]  │
│ Window: [Sep 1 – Sep 30 ▾]                                          │
├─────────────────────────────────────────────────────────────────────┤
│ Time        Source Event ID   Qty     Disposition   Rated?          │
│ 09-15 10:02 evt-99231         1,204   ACCEPTED       RATED  [view]  │
│ 09-15 10:03 evt-99232         —       REJECTED (dup) —      [why]   │
│ 09-16 02:11 evt-99401         3       QUARANTINED    —      [why]   │
├─────────────────────────────────────────────────────────────────────┤
│ Aggregate: window quantity 45,102   Allowance used 10,000,000/... │
└─────────────────────────────────────────────────────────────────────┘
```

- **Components/actions:** filter bar, event table with disposition badges (`RECEIVED/ACCEPTED/REJECTED/QUARANTINED`, deliverable 03 §"Meter and Usage"), row-level "view"/"why" opening the rating calculation trace or rejection reason.
- **States:** Loading = table skeleton with filter bar active. Empty = "No usage received for this window" distinguished from "No usage matches this filter" (deliverable 17 §10). Partial/stale = a freshness badge if the table reads a projected/aggregated view rather than the authoritative event store directly. Error = filter validation errors (e.g., invalid window) inline near the filter bar. Permission-denied = raw dimension values may be redacted per role (deliverable 15 §3) even when the row itself is visible.
- **Permissions/approval:** viewing detailed calculation traces requires `pricing:trace:read` (deliverable 13 §16.2); submitting a correction requires a distinct permission and opens the `UsageCorrection` flow referencing, never overwriting, the original (deliverable 03 §"Meter and Usage").
- **Keyboard/mobile:** table row navigation via arrow keys, Enter opens detail drawer; mobile collapses the table to a card list with the same fields stacked.
- **Accessibility:** disposition badges include text; the "why" action always yields a text explanation, never solely an icon tooltip.
- **RLG/evidence links:** "view" on a rated row opens the Lineage panel scoped to that usage event → rated event → charge → invoice line chain (deliverable 06 §3).

---

## 7. Invoice Detail

**Purpose / personas:** deliverable 17 §5.7, master prompt §17/§96 — Billing Administrator, Finance Controller, Support.

```
┌─────────────────────────────────────────────────────────────────────┐
│ INV-20381              ₹42,840        Due Sep 30                    │
│ Document: POSTED  Receivable: OPEN  Delivery: DELIVERED             │
├─────────────────────────────────────────────────────────────────────┤
│ [Collect] [Send] [Download] [Credit] [Dispute] [More▾]              │
├─────────────────────────────────────────────────────────────────────┤
│ ▸ Base subscription fee                          ₹2,000.00          │
│ ▾ API usage (450,000 calls)                      ₹1,240.00          │
│     Allowance: 400,000 included · Overage: 50,000 @ ₹0.0248/call    │
│     [View calculation trace]                                        │
│ ▸ Additional seats (2)                             ₹320.00          │
├─────────────────────────────────────────────────────────────────────┤
│ [Explain this invoice]                                               │
└─────────────────────────────────────────────────────────────────────┘
```

- **Components/actions:** header with the three independent state badges (deliverable 09 §1 — never combined into one contradictory label), action bar with financial commands, expandable lines, "Explain this invoice" (deliverable 12 §15, deliverable 17 §8.5).
- **States:** Loading = header + line skeleton. Empty = not applicable (an invoice always has ≥1 line once it exists). Partial/stale = not applicable for `POSTED` (immutable, authoritative); a `DRAFT` invoice instead shows a "Recalculate" affordance and an explicit "preview, not final" watermark (deliverable 09 §5). Error = a blocked `Finalize` (called from the billing-run flow, not this screen for an already-draft one shown elsewhere) surfaces the specific blocker (stale tax quote, missing address) per deliverable 09 §5. Permission-denied = `Credit`/`Write-off`/`Void` omitted without the specific permission (deliverable 13 §4).
- **Destructive-action confirmation:** `Void`, `Credit`, and `Write-off` each require a mandatory reason code and, above threshold, maker-checker approval (deliverable 09 §12); the confirmation names the exact reversal/credit effect before submission (deliverable 17 §9.4).
- **Keyboard/mobile:** `e` opens Explain; line items are individually expandable via Enter/Space. Mobile stacks the action bar into a bottom sheet and lines remain individually expandable.
- **Accessibility:** the three state badges are each individually labeled (not merged into one ambiguous string) for screen readers.
- **RLG/evidence links:** every line's "View calculation trace" opens the Lineage panel scoped to Charge → Invoice Line, and further to Usage Event/Subscription Item (deliverable 06 §4); payment allocations against this invoice are cross-linked once they exist.

---

## 8. Payment Detail

**Purpose / personas:** deliverable 17 §5.8 — Billing Administrator, Finance Controller, Support.

```
┌─────────────────────────────────────────────────────────────────────┐
│ PAY-10294        ₹42,840        State: SUCCEEDED                    │
├─────────────────────────────────────────────────────────────────────┤
│ Attempts                                                             │
│  #1  09-30 09:01  DECLINED   INSUFFICIENT_FUNDS   retry_advice: SAFE_AFTER│
│  #2  09-30 14:12  SUCCEEDED  via Stripe (evidence ref hidden)        │
├─────────────────────────────────────────────────────────────────────┤
│ Allocations: INV-20381 → ₹42,840 (applied 09-30 14:12)              │
│ Refunds: none                                                        │
├─────────────────────────────────────────────────────────────────────┤
│ [Retry] [Cancel] [Refund] [Mark externally paid (requires evidence)]│
└─────────────────────────────────────────────────────────────────────┘
```

- **Components/actions:** state badge (canonical payment state, deliverable 10 §2), attempts timeline with canonical reason codes and retry advice (deliverable 10 §6), allocations, refunds, action bar.
- **States:** Loading = header + timeline skeleton. Empty = "No attempts yet" for a `CREATED` payment. Partial/stale = an attempt in `UNKNOWN` state shows an explicit "reconciliation required" banner (deliverable 10 §3) rather than implying success or failure. Error = a failed manual retry shows the canonical problem detail inline. Permission-denied = "Mark externally paid" is a high-sensitivity action requiring separate permission and mandatory evidence attachment, omitted entirely without that permission (deliverable 10 §11).
- **Destructive-action confirmation:** `Cancel` and `Refund` require explicit confirmation naming the amount and currency and, above threshold, approval (deliverable 10 §9, §11).
- **Keyboard/mobile:** attempts timeline is a navigable list; mobile stacks attempts/allocations/refunds vertically with the action bar as a bottom sheet.
- **Accessibility:** `UNKNOWN`/reconciliation-required state is never conveyed by color alone — an explicit icon and text label are mandatory given its financial ambiguity.
- **RLG/evidence links:** allocations link to their Receivable/Invoice; refunds link to their originating Payment and, once posted, their Journal Transaction.

---

## 9. Collections Dashboard

**Purpose / personas:** deliverable 17 §5.9, master prompt §66/§97 — Collections Agent, Collections Manager, Finance Controller.

```
┌─────────────────────────────────────────────────────────────────────┐
│ ₹28.4M Receivable   ₹4.8M At Risk   ₹2.1M Overdue   94.8% Success   │
├───────────────┬─────────────────────────────────────────────────────┤
│ Queues         │ Case: ACME Corp — CASE-4471    Stage: PAST_DUE      │
│  Upcoming risk │ Exposure ₹342K · Risk: HIGH (factors: 2 recent      │
│  Method expiring│ declines, method expiring in 9 days)               │
│  Due today ◀   │ Recommended: Send payment-link reminder via email   │
│  Failed/retry  │  [Execute] [Skip] [Escalate] [Hold]                 │
│  High-value PD │ History: [timeline of actions/promises/disputes]    │
│  Promise due   │                                                     │
│  Disputed      │                                                     │
│  Manual review │                                                     │
└───────────────┴─────────────────────────────────────────────────────┘
```

- **Components/actions:** KPI strip, queue list (deliverable 11 §12 exact queue set), selected-case detail with recommended next action (reason codes, policy version visible on hover/expand per deliverable 17 §8.4), action buttons.
- **States:** Loading = KPI + queue skeleton. Empty = a queue with zero items shows "Nothing needs attention here right now" (a positive empty state, not an error look). Partial/stale = KPI strip freshness badge; a stale risk assessment on a case shows an explicit "risk assessment expired, re-evaluating" indicator rather than a silently outdated HIGH/LOW badge (deliverable 11 §6). Error = `Execute` failure (e.g., policy revalidation blocks it at execution time per deliverable 11 §9) shows the specific stop reason. Permission-denied = `Escalate`/exception-approval actions omitted without the separated-duties permission (deliverable 11 §11).
- **Permissions/approval:** an agent cannot approve their own escalation exception (deliverable 11 §7, §11); the UI omits the approve control for the same actor who recommended/executed the action.
- **Keyboard/mobile:** queue list and case detail are independently scrollable panes with arrow-key row navigation; mobile stacks queues above case detail with a back-navigation pattern instead of two persistent panes.
- **Accessibility:** risk badges always paired with factor text (§17 §8.4); the recommended-action panel is in a labeled landmark region.
- **RLG/evidence links:** case detail links to the invoice(s)/receivable(s) it covers and to the payment attempt history driving its risk factors.

---

## 10. Workflow Builder

**Purpose / personas:** deliverable 17 §5.10, master prompt §51 — Billing Administrator, Collections Manager, Product Manager.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Workflow: Invoice Due Reminder (DRAFT)          [Simulate][Publish] │
├───────────┬─────────────────────────────────────┬───────────────────┤
│ Palette    │ [Trigger: invoice.due]→[Condition:   │ Selected node:    │
│  Triggers  │  balance > 0]→[Action: send email]→  │  Action: send     │
│  Conditions│  [Wait 3d]→[Condition: still unpaid]→│  email            │
│  Actions   │  [Branch: risk HIGH?]→[Approval]     │  Template: v3      │
│  Wait      │                                       │  Requires approval:│
│  Branch    │                                       │  No                │
│  Approval  │                                       │                    │
├───────────┴─────────────────────────────────────┴───────────────────┤
│ Simulation: 1,204 accounts affected · 0 quiet-hour violations ·      │
│ 0 frequency-cap violations · estimated exposure ₹1.9M   [View list]  │
└─────────────────────────────────────────────────────────────────────┘
```

- **Components/actions:** left palette (Trigger → Condition → Action → Wait → Branch → Approval → Integration, master prompt §51), center flow canvas, right node properties, bottom simulation (mirrors deliverable 11 §14 "campaign simulation reports affected accounts, projected action counts, frequency/quiet-hour violations, and estimated exposure before activation").
- **States:** Loading = canvas skeleton. Empty = new workflow shows a guided empty canvas. Partial/stale = simulation results show their run timestamp/version, never implied live. Error = validation errors (unreachable branch, missing approval node before a sensitive action) attach to the specific node. Permission-denied = `Publish` requires elevated permission distinct from authoring; omitted without it.
- **Permissions/approval:** publishing a workflow that includes any financially material action (e.g., auto-suspend) requires maker-checker per deliverable 11 §14; the properties panel shows `Requires approval` per node and cannot be authored to bypass a policy-mandated approval node.
- **Keyboard/mobile:** same keyboard-operable canvas alternative as Pricing Designer (§5, §17 §6.4); explicitly desktop-first with the same minimum-width notice.
- **Accessibility:** each node's text description states its full configuration (trigger/condition/action/policy), not only an icon.
- **RLG/evidence links:** a published workflow's executed instances link to the `CollectionAction`/case records they produced (deliverable 11 §4).

---

## 11. Customer Portal (Home + Bills detail)

**Purpose / personas:** deliverable 17 §5.11, master prompt §32 — Subscriber Admin.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Hello, ACME Corp                                    [Support]      │
│  Upcoming: ₹18,400 due Sep 30        Overdue: ₹0                    │
│  Autopay: ON (Visa •••• 4242)                                       │
│  [Pay now]  [View bills]  [Manage subscriptions]                    │
├─────────────────────────────────────────────────────────────────────┤
│  Usage this period: 85% of monthly API allocation used              │
│   At current rate, estimated bill ≈ ₹14,300 vs. typical ₹8,000      │
│   [Upgrade plan] [Set usage alert] [Continue as is]                 │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Bill: Sep 2026                        ₹18,400       Due Sep 30     │
├─────────────────────────────────────────────────────────────────────┤
│  ▸ Base plan                                          ₹15,000       │
│  ▾ API usage                                            ₹2,900      │
│      450,000 calls · 400,000 included · 50,000 @ ₹0.058/call        │
│  ▸ Seats (2 additional)                                  ₹500       │
├─────────────────────────────────────────────────────────────────────┤
│  [Explain this bill]     [Pay ₹18,400]   [Change payment method]    │
└─────────────────────────────────────────────────────────────────────┘
```

- **Components/actions:** Home = payment inbox summary (master prompt §28) + bill-shock alert (master prompt §30) with non-dark-pattern choices; Bills detail = expandable lines identical in pattern to admin Invoice Detail but simplified language, "Explain this bill," pay action.
- **States:** Loading = skeleton summary card. Empty = "No bills yet" for a brand-new account. Partial/stale = usage-forecast percentage shows its computation time ("as of this morning") since it is a projection, not an authoritative balance. Error = a failed payment attempt shows a plain-language reason (mapped from the canonical reason code, deliverable 10 §6) and a clear next step, never a raw provider error string. Permission-denied = not applicable within a correctly scoped portal session (deliverable 17 §4); a session attempting to reach another account's data hits the standard non-leaking not-authorized state.
- **Destructive-action confirmation:** cancellation flow (reached from "Manage subscriptions") follows deliverable 17 §9 exactly — same prominence as upgrade, one optional retention offer, explicit effective-date/financial-impact preview before confirming.
- **Keyboard/mobile:** fully mobile-first (deliverable 17 §6.3); every action reachable via standard tab order; `Pay now` is always the visually and structurally primary action on Home.
- **Accessibility:** the usage-forecast comparison ("₹14,300 vs. ₹8,000") is available as plain text, not only as a visual bar/gauge.
- **RLG/evidence links:** "Explain this bill" uses the identical trace-rendering component as admin Invoice Detail (deliverable 17 §8.5), scoped to only the fields a subscriber is authorized to see.

---

## 12. Cross-screen consistency checklist

Verified across all eleven screens above before this deliverable is considered complete:

1. Every status badge uses the exact canonical enum string from deliverables 08–11 (§17 §8.1).
2. Every money value shows explicit currency (§17 §8.2).
3. Every calculation "Explain" affordance renders from a persisted trace and explicitly states when none exists (§17 §8.5).
4. Every destructive action requires a named-consequence confirmation (§17 §9.4).
5. Every approval-gated action shows an explicit pending state rather than appearing to silently no-op (§17 §9.5).
6. Every projection-backed panel (dashboards, queues, usage forecasts, RLG lineage) shows a freshness indicator (§17 §10).
7. Every screen has a keyboard-operable path for its primary actions, with the two desktop-first canvas exceptions (Pricing Designer, Workflow Builder) explicitly documented as such.
8. No screen reveals the existence of a record or action to a user lacking permission to see it (§17 §7).

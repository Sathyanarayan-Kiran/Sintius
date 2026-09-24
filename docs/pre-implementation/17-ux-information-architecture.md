# UX information architecture

**Version:** 0.1
**Status:** Proposed MVP baseline
**Related:** [Product Requirements Document](01-product-requirements-document.md) §5 (personas), [Revenue Lifecycle Graph](06-revenue-lifecycle-graph.md), [Pricing engine specification](12-pricing-engine-specification.md), [API specification](13-api-specification.md)
**Followed by:** [Wireframes for ten primary screens](18-primary-screen-wireframes.md)

## 1. Design intent

Two distinct experiences share one design language but different information architectures, because they serve different trust levels, jobs, and cognitive load budgets (master prompt §63, §64):

- **Admin experience** — merchant operators, finance, pricing, collections, support, developers, executives, auditors. Dense, keyboard-first, built for repeated expert use.
- **Customer Portal** — subscribers. Fintech-consumer-grade: calm, minimal, progressive disclosure, never assumes billing literacy.

Both experiences share: the same underlying domain vocabulary (deliverables 08–12), the same calculation-trace-grounded "why" pattern, the same explicit-freshness/state discipline, and a hard rule against dark patterns (§9).

## 2. Personas mapped to experiences

Reuses deliverable 01 §5 without renaming any persona.

| Persona | Experience | Primary jobs in this IA |
|---|---|---|
| Billing Administrator | Admin | Invoice Detail, Payment Detail, billing runs |
| Pricing Manager | Admin | Pricing Designer, Product Catalog |
| Collections Agent | Admin | Collections Dashboard |
| Finance Controller | Admin | Approvals, Revenue Dashboard, audit exports |
| Customer Support | Admin | Customer 360, Invoice Detail (explain) |
| Developer | Admin (Developer console) | Webhooks, API keys, sandbox |
| Subscriber Admin | Customer Portal | Subscriptions, Usage, Bills, Payments |
| Executive | Admin | Revenue Dashboard |
| Auditor | Admin (read-only scope) | Audit timeline, lineage exports |

## 3. Admin experience: top-level navigation and route map

Top-level navigation matches master prompt §64 exactly, extended with route paths:

```
Home            /admin
Customers       /admin/customers
Catalog         /admin/catalog
Pricing         /admin/pricing
Subscriptions   /admin/subscriptions
Usage           /admin/usage
Billing         /admin/billing
Payments        /admin/payments
Collections     /admin/collections
Revenue         /admin/revenue
Analytics       /admin/analytics
Workflows       /admin/workflows
Integrations    /admin/integrations
Developers      /admin/developers
Settings        /admin/settings
```

### 3.1 Object hierarchy and deep-link behavior

Route paths mirror the domain hierarchy so a URL is a stable, shareable, bookmarkable reference to one object at one navigation depth:

```
/admin/customers/{customer_id}
/admin/customers/{customer_id}/accounts/{account_id}                (Customer 360)
/admin/customers/{customer_id}/accounts/{account_id}/subscriptions/{subscription_id}
/admin/catalog/products/{product_id}/versions/{version_id}
/admin/pricing/rate-cards/{rate_card_id}                            (Pricing Designer)
/admin/billing/invoices/{invoice_id}
/admin/payments/{payment_id}
/admin/collections/cases/{case_id}
```

Every screen that can be reached from a Revenue Lifecycle Graph traversal (deliverable 06 §9) is reachable by direct URL, not only by navigating through parents — a payment linked from an invoice's "trace" panel deep-links straight to `/admin/payments/{id}` with the originating invoice preserved as a breadcrumb (§3.3), not lost.

### 3.2 Global search / command palette

- A single search affordance (keyboard shortcut, e.g., `/` or `Cmd/Ctrl+K`) searches customer name, invoice number, subscription number, payment reference, email, contract number, transaction ID, gateway reference, PO number, and product name (master prompt §73), scoped to the current tenant only.
- Results are permission-filtered before display — a result the user cannot open is never shown, avoiding the existence-leak problem addressed in deliverable 13 §11.4 at the UI layer too.
- The same palette exposes command actions ("Finalize invoice…", "Create rate card…") the user has permission to execute, resolved through the identical authorization check the target screen would apply — the palette is a navigation convenience, not an authorization bypass.

### 3.3 Breadcrumbs and cross-links

- Every object detail screen shows a breadcrumb reflecting the object hierarchy (Customer → Account → Subscription, or Invoice → Account → Customer) plus, where the user arrived via a lineage traversal, an additional "via" trail (e.g., "via Payment PAY-1029") so backward/forward RLG navigation (deliverable 06 §1) never loses context.
- Every reference field (account, subscription, charge, invoice, payment, case) renders as a live cross-link with a hover preview (business key, status, amount where permitted) rather than a bare ID.

## 4. Customer Portal: navigation and route map

Matches master prompt §32 navigation exactly:

```
Home             /portal
Subscriptions    /portal/subscriptions
Usage            /portal/usage
Bills            /portal/bills
Payments         /portal/payments
Payment Methods  /portal/payment-methods
Orders           /portal/orders
Credits          /portal/credits
Support          /portal/support
```

- All portal routes are implicitly scoped to the authenticated session's `account_id` (deliverable 13 §3); there is no route shape that accepts an arbitrary account ID from a portal session.
- The portal's information hierarchy is shallower than Admin by design: two levels of depth maximum (`/portal/bills/{invoice_id}`) before progressive disclosure (expand-in-place) takes over rather than further navigation (§6).

## 5. Screen inventory (information architecture summary)

Full wireframes are deliverable 18. This section fixes each screen's purpose, primary personas, and information hierarchy so wireframes have a stable IA to render against.

### 5.1 Revenue Dashboard (`/admin`, master prompt §65)

- **Personas:** Executive, Finance Controller, Billing Administrator.
- **Purpose:** answer "how much recurring revenue, how much collected/overdue/at risk, where is revenue leaking, what changed since yesterday" in one view.
- **Hierarchy:** KPI card row (ARR, MRR, NRR, GRR, Active Subscribers, Expansion/Churn MRR, Payment Success Rate, Collection Rate, DSO, Failed Payments, Recovered Revenue, Outstanding AR, Revenue at Risk) → trend charts → alerts feed → drill-down links into Analytics/Collections/Invoice lists.

### 5.2 Customer 360 (`/admin/customers/{id}/accounts/{id}`, master prompt §67, §95)

- **Personas:** Support, Billing Administrator, Finance Controller.
- **Purpose:** single-screen understanding of one customer's commercial and financial state.
- **Hierarchy:** header (identity, ARR/MRR, balance, payment risk) → tabs (Overview, Subscriptions, Usage, Invoices, Payments, Contracts, Communications, Timeline) → right panel (AI Revenue Assistant, grounded suggested action).

### 5.3 Subscription Detail (`/admin/.../subscriptions/{id}`)

- **Personas:** Billing Administrator, Support.
- **Purpose:** inspect and act on one subscription's canonical state, items, schedule, and change history (deliverable 08).
- **Hierarchy:** header (state badge, account link, next renewal) → items table → scheduled changes → billing schedule → change history timeline → action bar (state-machine-legal actions only, per §7).

### 5.4 Product Catalog (`/admin/catalog`)

- **Personas:** Pricing Manager, Product Manager.
- **Purpose:** browse/manage the versioned product hierarchy (deliverable 03 §"Product, Offer, Plan, and Rate Card").
- **Hierarchy:** Portfolio → Product Family → Product → Product Version list (draft/in_review/active/retired) → Offer/Plan cross-references.

### 5.5 Pricing Designer (`/admin/pricing/rate-cards/{id}`, master prompt §6, §98)

- **Personas:** Pricing Manager, Finance Controller (approver).
- **Purpose:** compose, validate, simulate, and activate rate cards without code (deliverable 12).
- **Hierarchy:** left (component palette) → center (visual pricing flow, deliverable 12 §3 stages) → right (properties of selected node) → bottom (simulator, deliverable 12 §17).

### 5.6 Usage Explorer (`/admin/usage`)

- **Personas:** Billing Administrator, Support, Developer.
- **Purpose:** inspect ingested usage, disposition, aggregation, and rating outcomes for a customer/meter/window.
- **Hierarchy:** filter bar (meter, subscription item, window) → event/aggregate table with disposition badges → drill into one event's rating/charge lineage (RLG link).

### 5.7 Invoice Detail (`/admin/billing/invoices/{id}`, master prompt §17, §96)

- **Personas:** Billing Administrator, Finance Controller, Support.
- **Purpose:** inspect, explain, and act on one invoice across its three state dimensions (deliverable 09 §1).
- **Hierarchy:** header (number, amount, due date, document/receivable/delivery state badges) → action bar (Collect, Send, Download, Credit, Dispute, Void, More) → expandable line items (each resolving to calculation trace) → "Explain invoice" panel.

### 5.8 Payment Detail (`/admin/payments/{id}`)

- **Personas:** Billing Administrator, Finance Controller, Support.
- **Purpose:** inspect one logical payment, its attempts, allocations, refunds (deliverable 10).
- **Hierarchy:** header (state badge, amount, method) → attempts timeline (with canonical reason codes) → allocations → refunds → related invoices/receivables.

### 5.9 Collections Dashboard (`/admin/collections`, master prompt §66, §97)

- **Personas:** Collections Agent, Collections Manager, Finance Controller.
- **Purpose:** operations cockpit for preventive and recovery collections (deliverable 11).
- **Hierarchy:** top KPI strip (Receivable, At Risk, Overdue, Payment Success %) → queues (Upcoming high risk, Method expiring, Due today, Failed/retry, High-value past due, Promise due/broken, Disputed/on hold, Manual review) → case detail panel with recommended next action and Revenue Lifecycle Graph link.

### 5.10 Workflow Builder (`/admin/workflows`, master prompt §51)

- **Personas:** Billing Administrator, Collections Manager, Product Manager (advanced/no-code configuration).
- **Purpose:** compose event-triggered rules/workflows visually (Trigger → Condition → Action → Wait → Branch → Approval → Integration).
- **Hierarchy:** left (trigger/action palette) → center (flow canvas) → right (node properties, including maker-checker requirements) → simulation/impact panel before publish.

### 5.11 Customer Portal (`/portal`, master prompt §32)

- **Personas:** Subscriber Admin.
- **Purpose:** self-service financial home: understand and act on subscriptions, usage, bills, and payments.
- **Hierarchy:** Home (upcoming amount, overdue balance, quick actions) → Subscriptions → Usage → Bills → Payments/Payment Methods → Orders → Credits → Support.

## 6. Progressive disclosure, keyboard behavior, responsive behavior

### 6.1 Progressive disclosure

- **Admin:** default views show the operationally necessary fields; calculation traces, raw provider evidence, and internal policy versions are one click/expand away, never hidden behind a second full navigation — consistent with "complexity should appear only when needed" (master prompt §63).
- **Portal:** every invoice line is collapsed by default to description + amount; expanding reveals usage, rate, allowance, discounts, tax (master prompt §17) — matching the "Explain my bill" pattern (§8.5).

### 6.2 Keyboard behavior

- Admin is keyboard-first (master prompt §64): global command palette (§3.2), `j`/`k`-or-arrow row navigation in tables, `g` then a letter for top-level navigation shortcuts (e.g., `g i` → Billing/Invoices), Enter to open, Escape to close panels/modals, and every destructive-action confirmation is reachable and dismissible via keyboard alone.
- Focus order follows visual/reading order; no keyboard trap in modals, drawers, or the Pricing Designer canvas (which also needs a documented non-drag keyboard-operable alternative for node placement/connection, per accessibility §6.4).
- Portal supports standard tab-order keyboard operation for all actions, including payment and cancellation flows, without requiring a mouse.

### 6.3 Responsive/mobile behavior

- **Admin:** optimized for desktop/wide-viewport operational use; a responsive tablet breakpoint collapses multi-column layouts (e.g., Customer 360 tabs become a select control) but dense operational screens (Pricing Designer canvas, Workflow Builder) are explicitly desktop-first and show a "best viewed on a larger screen" notice rather than a broken cramped layout below a documented minimum width.
- **Portal:** mobile-first responsive down to common phone viewport widths; every primary action (pay, view bill, change payment method) is fully usable on mobile, per the master prompt's "fintech-quality, responsive" requirement (§63).

### 6.4 Accessibility

- Target WCAG 2.2 AA for both experiences (deliverable 01 §9).
- Every status/risk/state indicator that uses color also uses text/icon (never color-only signaling) — critical given the density of state badges (subscription state, invoice document/receivable/delivery state, payment state, risk band).
- Every chart in Revenue Dashboard/Analytics has an accessible data-table alternative.
- Focus-visible styling is never suppressed; modals trap focus correctly and restore focus to the triggering control on close.
- The Pricing Designer canvas (a drag-and-drop surface per master prompt §6) provides a fully keyboard-operable structured-editing alternative (e.g., a form-based node editor) so visual composition is never the only way to configure pricing.

## 7. Permission-aware navigation and redacted states

- Navigation items and actions the current user cannot perform are **not shown as disabled-and-visible by default** for sensitive financial actions (avoids revealing the existence of an action/threshold an unauthorized user shouldn't know about) — they are omitted. Non-sensitive items that are merely out of plan/tier may show as disabled with an explanation.
- A screen reached via direct URL without sufficient permission shows a clear "not authorized" state, never a silent redirect that could be mistaken for "does not exist" in a way that leaks existence information inconsistently with the API's non-leak rule (deliverable 13 §11.4) — the UI-level message is deliberately generic ("You don't have access to this record") whether the record doesn't exist or the user lacks permission, mirroring the API's `404`-for-both approach at the presentation layer too.
- Redacted fields (e.g., full payment token, detailed risk factor evidence beyond an authorized role's scope) show a clear redaction affordance ("Hidden — requires Finance Controller role") rather than an empty-looking field indistinguishable from a data-freshness gap.

## 8. Global patterns

### 8.1 Status

Every domain status badge uses the **exact canonical vocabulary** from deliverables 08–11 (e.g., `PARTIALLY_PAID`, not "Partial") with a consistent color/icon mapping defined once in the design system and reused everywhere the status appears — Customer 360, Invoice Detail, lists, and the Portal.

### 8.2 Money

- Always rendered with explicit currency (symbol + ISO code on first mention in a dense table, symbol thereafter within a single-currency context) — never a bare number.
- Negative/credit amounts use both color and an explicit sign/label, never color alone (§6.4).

### 8.3 Dates and time zones

- Every displayed date/time states or defaults to the account's business time zone (deliverable 09 §10) with an explicit UTC-equivalent available on hover/tooltip for admin users reconciling across time zones.
- `due_date` and other business dates render as dates, not instants, matching the wire format distinction in deliverable 13 §12.

### 8.4 Risk

- Payment risk (LOW/MEDIUM/HIGH) always renders with its contributing factor codes accessible in the same view (master prompt §23 "explainable contributing factors"), never a bare color chip — this is the UI manifestation of deliverable 11 §6's explainability requirement.

### 8.5 Calculation explanation ("Explain my bill" / "why this amount")

- A single, reusable "Explain" pattern renders the calculation trace (deliverable 12 §15) as a readable operation tree with plain-language labels, used identically in Invoice Detail (admin), Bills (portal), and Usage Explorer.
- If a trace is missing or invalid, the UI explicitly states that limitation (deliverable 12 §15 "the system reports that limitation rather than generating a causal explanation") — it never falls back to a generated-sounding explanation.

### 8.6 Audit timeline

- A reusable Timeline component (actor, action, object, before/after where safe to show, reason, timestamp) appears on Customer 360, Subscription Detail, Invoice Detail, and a dedicated Audit screen for Auditors — one component, one visual language, populated from the same `AuditEvent` source everywhere (deliverable 03 §"Audit and Approval").

### 8.7 Revenue Lifecycle Graph traversal

- A reusable "Lineage" panel/drawer, invocable from any node type (charge, invoice, payment, subscription item, usage event), shows the immediate upstream/downstream neighborhood with freshness and broken-chain indicators (deliverable 06 §9, §8) and deep-links to each neighbor's own detail screen — this is the Linear Transaction Explorer (master prompt §68) implemented as a reusable pattern rather than a single bespoke screen.

### 8.8 Notifications

- In-app notification center (Admin) and a portal-facing notification/alert surface share the same underlying `Communication`/template model (deliverable 07); both show delivery status, never claim a message was read.

### 8.9 Help

- Contextual help affordances (tooltips, "Learn more" links) are attached to fields with non-obvious financial meaning (e.g., proration policy, discount stacking) rather than a single undifferentiated help center, consistent with progressive disclosure (§6.1).

## 9. No-dark-pattern cancellation and transparent financial-impact previews

Directly implements master prompt §34 and §35 and PRD FR-EXP-002.

1. **Cancellation is never harder to find than upgrade.** The Portal's Subscriptions screen places "Cancel" with the same visual prominence as "Upgrade"/"Change plan," not buried in a settings sub-menu.
2. **No forced retention gauntlet.** A merchant-configured retention offer (pause/downgrade/discount) MAY be presented once, clearly labeled as optional, with an unambiguous "No thanks, continue cancelling" path that completes the cancellation — the flow never loops back to the same offer or requires contacting support unless that is genuinely the only legally/contractually available path (in which case the UI states why, rather than implying a dead end is a technical limitation).
3. **Every self-service change shows effective date and financial impact before confirmation** (PRD FR-EXP-002): "Cancelling now ends service on 2026-10-15. Your final invoice will include usage through that date; no refund applies to the current period per your plan terms" — sourced from the same preview/proration mechanism used server-side (deliverable 12 §17, deliverable 08 §7), never a client-side estimate.
4. **Destructive-action confirmation** (cancel, terminate, void, write-off, remove payment method) always requires an explicit secondary confirmation step naming the specific consequence (not a generic "Are you sure?") and is fully keyboard-operable (§6.2).
5. **Approval-pending states are visible, not silent.** When a subscriber or operator action requires maker-checker approval, the UI shows "Pending approval" with who/what is needed, rather than appearing to have silently done nothing.

## 10. Loading, empty, error, partial/stale, permission-denied, and destructive-action states (shared contract)

Every screen in the inventory (§5) and every wireframe (deliverable 18) implements this shared state contract rather than inventing ad hoc variants per screen:

| State | Rule |
|---|---|
| Loading | Skeleton matching the eventual layout, never a layout-shifting spinner-then-jump; long-running admin queries show a progress indicator once elapsed time exceeds a documented threshold |
| Empty | Explains *why* it's empty (no data yet vs. filtered to zero results) and offers the relevant next action, never a bare "No results" |
| Error | Uses the canonical problem model's `title`/`detail` (deliverable 13 §11) rendered safely, with a retry affordance for retryable failures and a distinct message for non-retryable ones |
| Partial/stale | Any projection-backed view (search results, dashboards, RLG traversal, Analytics) shows an explicit freshness indicator ("as of 2 minutes ago") per deliverable 05 §6/§9 — never presented as if it were authoritative real-time transactional state |
| Permission-denied | Generic, non-leaking message (§7); never a raw `403`/`404` code shown to an end user without a human-readable explanation |
| Destructive-action confirmation | Named consequence, keyboard-operable, matches §9.4 |
| Approval-pending | Visible status naming what/who is needed, matches §9.5 |

## 11. Acceptance criteria

1. Every screen in the inventory (§5) has a documented purpose, primary personas, and information hierarchy before wireframing begins (satisfied by this document; deliverable 18 renders it).
2. Every domain status shown in any screen uses the exact canonical vocabulary from deliverables 08–11 with no undocumented synonym.
3. A permission-restricted navigation item is verifiably absent (not merely visually disabled) for a role lacking the underlying permission, for every sensitive financial action identified in deliverable 13 §4.
4. Every self-service subscription/payment-method change in the Portal shows effective date and financial impact sourced from a live preview call before confirmation (ties to PRD FR-EXP-002).
5. Cancellation can be completed by a subscriber in no more steps than upgrade, verified by a UX flow audit.
6. Every calculation "Explain" surface renders exclusively from a persisted calculation trace or RLG fact, with an explicit "not available" state when no trace exists — never a generated-sounding fallback.
7. Keyboard-only operation completes every documented Admin and Portal primary workflow (§6.2) without a mouse, verified by an accessibility test pass.
8. The shared state contract (§10) is implemented identically across at least the four highest-traffic screens (Revenue Dashboard, Customer 360, Invoice Detail, Portal Bills) before extending to the remaining inventory.

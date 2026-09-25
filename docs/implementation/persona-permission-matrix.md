# Persona permission matrix (decision D9)

**Status:** reviewed by the Product Owner on 2026-09-25. The table is generated from `modules/identity-tenant/domain/persona-matrix.ts`, which is the single source of truth. A unit test fails if this table and the code disagree.

The personas are exactly the 12 of master specification §61. The permissions are the platform catalog (`modules/identity-tenant/domain/authorization.ts`), which today covers Phase 0 and the API specification §4 examples. Later phases add their own permissions (customer, usage, collections queue, revenue and so on), each with its persona grants.

## Legend

| Mark | Meaning |
|---|---|
| ✅ | Granted by default, unconditionally |
| 🔸 | Granted by default, with its condition enforced (a role limit or an approval policy) |
| 🚫 | Declined by the Product Owner: denied |
| · | No grant: denied |

## Matrix

<!-- matrix:start -->
| Persona | `tenant:role:manage` | `tenant:role:assign` | `approval:request:propose` | `approval:request:decide` | `billing:invoice:preview` | `billing:invoice:finalize` | `pricing:rate_card:activate` | `payments:payment:refund` | `subscription:change:backdate` | `collections:case:approve_exception` | `portal:subscription:change` | `audit:read` | `outbox:dead_letter:resolve` | `foundation:proof:execute` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Billing Administrator | · | · | ✅ | · | ✅ | 🔸 | · | 🔸 | · | · | · | · | · | · |
| Pricing Manager | · | · | ✅ | · | · | · | 🔸 | · | · | · | · | · | · | · |
| Collections Agent | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Customer Support | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Finance Controller | · | · | · | ✅ | ✅ | ✅ | · | ✅ | ✅ | ✅ | · | ✅ | · | · |
| Revenue Accountant | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Sales | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Product Manager | · | · | · | ✅ | · | · | ✅ | · | · | · | · | · | · | · |
| Operations | · | · | · | · | · | · | · | · | · | · | · | · | 🚫 | · |
| Developer | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Auditor | · | · | · | · | · | · | · | · | · | · | · | ✅ | · | · |
| Executive | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
<!-- matrix:end -->

`tenant:role:manage` and `tenant:role:assign` belong to the `tenant_administrator` role that every tenant receives at provisioning. They are not a persona grant. `foundation:proof:execute` is a test-only diagnostic and is never granted to a persona.

## Default grants

| Persona | Permission | Basis | Condition and enforcement | Sources |
|---|---|---|---|---|
| Billing Administrator | `billing:invoice:preview` | spec | — | 13-api-specification.md §4; 01-product-requirements-document.md §5 |
| Billing Administrator | `billing:invoice:finalize` | spec | Only up to the tenant's threshold (API §4); above it, the Finance Controller finalizes. Role limit: `amount_minor lte 1000000` (USD 10,000). | 13-api-specification.md §4; 01-product-requirements-document.md §5 |
| Billing Administrator | `payments:payment:refund` | spec | Only up to the tenant's refund threshold (API §4, master spec §62: refunds above $10,000 need approval). Role limit: `amount_minor lte 1000000` (USD 10,000). | 13-api-specification.md §4; Master spec §62 |
| Billing Administrator | `approval:request:propose` | inferred, approved | Needed to request approval for finalizations and refunds above the threshold. Approved by the Product Owner. | 13-api-specification.md §4; Master spec §62; Product Owner review 2026-09-25 |
| Pricing Manager | `pricing:rate_card:activate` | spec | As proposer only: activation needs Product and Finance approval. Default approval policy (Product + Finance). | 13-api-specification.md §4; Master spec §62 |
| Pricing Manager | `approval:request:propose` | spec | — | 13-api-specification.md §4; 01-product-requirements-document.md §5; 01-product-requirements-document.md §6 J-01 |
| Finance Controller | `billing:invoice:preview` | spec | — | 13-api-specification.md §4 |
| Finance Controller | `billing:invoice:finalize` | spec | — | 13-api-specification.md §4 |
| Finance Controller | `payments:payment:refund` | spec | — | 13-api-specification.md §4 |
| Finance Controller | `subscription:change:backdate` | spec | — | 13-api-specification.md §4 |
| Finance Controller | `approval:request:decide` | spec | — | 13-api-specification.md §4; Master spec §62; 01-product-requirements-document.md §5; 17-ux-information-architecture.md §2 |
| Finance Controller | `audit:read` | spec | — | 01-product-requirements-document.md §5; 17-ux-information-architecture.md §2 |
| Finance Controller | `collections:case:approve_exception` | proposed, approved | API §4 names a Collections Manager, who is not a §61 persona; the Product Owner assigned it to the Finance Controller. Approved by the Product Owner. | 13-api-specification.md §4; Product Owner review 2026-09-25 |
| Product Manager | `approval:request:decide` | spec | — | Master spec §62 |
| Product Manager | `pricing:rate_card:activate` | inferred, approved | Makes the Product Manager the Product approver named by the default pricing-activation policy (D4). Approved by the Product Owner. | Master spec §62; Product Owner review 2026-09-25 |
| Auditor | `audit:read` | spec | — | 13-api-specification.md §4; 01-product-requirements-document.md §5; 17-ux-information-architecture.md §2 |

## Product Owner decisions (2026-09-25)

1. **Billing Administrator limits.** Limits now attach to the role's own grant (`tenant_role.permission_limits`, migration 011). The Billing Administrator finalizes and refunds up to `amount_minor ≤ 1,000,000` (USD 10,000, from master spec §62). The Finance Controller has no limit. A request without the amount attribute is refused (fail closed).
2. **Pricing activation.** Every new tenant receives a default approval policy for `pricing:rate_card:activate`: 2 approvals, separation of duties, expiring after 7 days, with named approvers (D4): one holder of `pricing:rate_card:activate` (the Product Manager) and one holder of `billing:invoice:finalize` (the Finance Controller). The Pricing Manager proposes; the Product Manager holds `pricing:rate_card:activate` so that they can be the Product approver.
3. **Billing Administrator may propose approvals:** approved.
4. **Operations and dead letters:** declined. Dead-letter resolution stays with roles a tenant administrator composes.
5. **Collections exceptions:** the Finance Controller approves them, instead of a "Collections Manager" who is not a §61 persona. The Collections Agent never holds this permission.

## Remaining notes

- **Subscriber Admin.** `portal:subscription:change` belongs to the customer-portal Subscriber Admin, who is outside the 12 admin personas and scoped to their own account. It is modelled with the portal.
- **Personas with no grants yet.** Collections Agent, Customer Support, Revenue Accountant, Sales, Operations, Developer and Executive have no permission in today's catalog. Their read and work permissions arrive with the Phase 1+ stories that introduce them.
- **Role templates.** `defaultPersonaRoleTemplates()` returns the 12 roles with their permissions and limits. Today a new tenant receives only `tenant_administrator` plus the default approval policy. Seeding the persona roles at provisioning is a later choice.

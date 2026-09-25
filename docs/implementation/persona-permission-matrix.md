# Persona permission matrix (decision D9)

**Status:** draft for Product Owner review. The table is generated from `modules/identity-tenant/domain/persona-matrix.ts`, which is the single source of truth; a unit test fails if this table and the code disagree.

The personas are exactly the 12 of master specification §61. The permissions are the platform catalog (`modules/identity-tenant/domain/authorization.ts`), which today covers Phase 0 and the API specification §4 examples. Later phases add their own permissions (customer, usage, collections queue, revenue and so on), each with its persona grants.

## Legend

| Mark | Meaning | Ships by default? |
|---|---|---|
| ✅ | Specification names this persona for this permission, with no per-role limit | Yes |
| 🔒 | Specification grant with a per-role limit the platform cannot enforce yet | No, until the limit is enforceable |
| ❓ | Inferred from specification text that does not name the permission | No, needs your decision |
| 💡 | Engineering proposal with no specification basis | No, needs your decision |
| · | No grant: denied | — |

## Matrix

<!-- matrix:start -->
| Persona | `tenant:role:manage` | `tenant:role:assign` | `approval:request:propose` | `approval:request:decide` | `billing:invoice:preview` | `billing:invoice:finalize` | `pricing:rate_card:activate` | `payments:payment:refund` | `subscription:change:backdate` | `collections:case:approve_exception` | `portal:subscription:change` | `audit:read` | `outbox:dead_letter:resolve` | `foundation:proof:execute` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Billing Administrator | · | · | ❓ | · | ✅ | 🔒 | · | 🔒 | · | · | · | · | · | · |
| Pricing Manager | · | · | ✅ | · | · | · | 🔒 | · | · | · | · | · | · | · |
| Collections Agent | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Customer Support | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Finance Controller | · | · | · | ✅ | ✅ | ✅ | · | ✅ | ✅ | · | · | ✅ | · | · |
| Revenue Accountant | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Sales | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Product Manager | · | · | · | ✅ | · | · | ❓ | · | · | · | · | · | · | · |
| Operations | · | · | · | · | · | · | · | · | · | · | · | · | 💡 | · |
| Developer | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Auditor | · | · | · | · | · | · | · | · | · | · | · | ✅ | · | · |
| Executive | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
<!-- matrix:end -->

`tenant:role:manage` and `tenant:role:assign` belong to the `tenant_administrator` role that every tenant receives at provisioning. They are not a persona grant. `foundation:proof:execute` is a test-only diagnostic and is never granted to a persona.

## Grants that ship by default (✅)

| Persona | Permission | Sources |
|---|---|---|
| Billing Administrator | `billing:invoice:preview` | 13-api-specification.md §4; 01-product-requirements-document.md §5 |
| Pricing Manager | `approval:request:propose` | 13-api-specification.md §4; 01-product-requirements-document.md §5; 01-product-requirements-document.md §6 J-01 |
| Finance Controller | `billing:invoice:preview` | 13-api-specification.md §4 |
| Finance Controller | `billing:invoice:finalize` | 13-api-specification.md §4 |
| Finance Controller | `payments:payment:refund` | 13-api-specification.md §4 |
| Finance Controller | `subscription:change:backdate` | 13-api-specification.md §4 |
| Finance Controller | `approval:request:decide` | 13-api-specification.md §4; Master spec §62; 01-product-requirements-document.md §5; 17-ux-information-architecture.md §2 |
| Finance Controller | `audit:read` | 01-product-requirements-document.md §5; 17-ux-information-architecture.md §2 |
| Product Manager | `approval:request:decide` | Master spec §62 |
| Auditor | `audit:read` | 13-api-specification.md §4; 01-product-requirements-document.md §5; 17-ux-information-architecture.md §2 |

## Decisions needed

| # | Persona | Permission | Basis | Why it is pending | Recommendation |
|---|---|---|---|---|---|
| 1 | Billing Administrator | `billing:invoice:finalize` | 🔒 spec | API §4: "below threshold". Constraints are per tenant and permission today, so a limit would also bind the Finance Controller. | Add role-scoped constraints (a limit attached to the role grant), then ship with a tenant-set threshold. |
| 2 | Billing Administrator | `payments:payment:refund` | 🔒 spec | Same: "below configured threshold". | Same as 1. |
| 3 | Billing Administrator | `approval:request:propose` | ❓ inferred | Needed to ask for approval above the threshold. | Approve. |
| 4 | Pricing Manager | `pricing:rate_card:activate` | 🔒 spec | API §4 and master §62 make the Pricing Manager a proposer whose activation needs Product and Finance approval. That holds only if every tenant gets a default approval policy for pricing activation. | Ship together with a default `pricing:rate_card:activate` approval policy (Product + Finance, D4). |
| 5 | Product Manager | `pricing:rate_card:activate` | ❓ inferred | Master §62 names a "Product" approver. With D4 named approvers, holding this permission is what makes someone the Product approver. | Approve, or name a dedicated approver permission instead. |
| 6 | Operations | `outbox:dead_letter:resolve` | 💡 proposed | Dead letters need a human operator (D1). The specification names no persona. | Approve for Operations, or keep it with the tenant administrator only. |

## Gaps in the specification

- **Collections Manager.** API §4 and the UX information architecture grant `collections:case:approve_exception` to a Collections Manager, who is not one of the 12 personas. The Collections Agent must not hold it (separation of duties from the agent who recommended the exception). Options: add a 13th persona, or grant it to the Finance Controller.
- **Subscriber Admin.** `portal:subscription:change` belongs to the customer-portal Subscriber Admin, who is outside the 12 admin personas and is scoped to their own account. It is modelled separately, with the portal.
- **Personas with no grants yet.** Collections Agent, Customer Support, Revenue Accountant, Sales, Operations (pending 6), Developer and Executive have no permission in today's catalog. Their read and work permissions (Customer 360, collections queues, revenue dashboards, API keys and webhooks) arrive with the Phase 1+ stories that introduce those permissions.

## After your review

1. Each decision you approve changes its grant's basis in `persona-matrix.ts`, and the table is regenerated.
2. TC-002-03-01 (the allow/deny matrix test over every persona and permission, in its own tenant and across tenants) becomes `passing`.
3. Seeding these templates as roles when a tenant is provisioned is a separate choice. Today a new tenant receives only `tenant_administrator`, and administrators compose roles from the catalog.

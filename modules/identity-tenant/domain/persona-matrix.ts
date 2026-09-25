import { PERMISSION_CATALOG, type Permission, type PermissionConstraint } from "./authorization.ts";

/**
 * Persona × permission matrix (decision D9). The 12 personas are exactly those of master
 * specification §61. Each grant records its basis:
 *
 * - `spec`: the specification names this persona for this permission (sources cited);
 * - `inferred`: follows from specification text that does not name the permission explicitly;
 * - `proposed`: an engineering suggestion with no specification basis.
 *
 * A grant ships in the default role templates when it is `spec` or approved by the Product Owner,
 * is not declined, and any condition it carries is enforced (by a role limit or an approval policy).
 * Anything else stays denied and is listed by `pendingGrants`. A permission a persona has no grant
 * for is denied. The Product Owner reviewed this matrix on 2026-09-25.
 */

export const PERSONAS = Object.freeze([
  "billing_administrator",
  "pricing_manager",
  "collections_agent",
  "customer_support",
  "finance_controller",
  "revenue_accountant",
  "sales",
  "product_manager",
  "operations",
  "developer",
  "auditor",
  "executive",
] as const);

export type Persona = (typeof PERSONAS)[number];

export const PERSONA_TITLES: Readonly<Record<Persona, string>> = Object.freeze({
  billing_administrator: "Billing Administrator",
  pricing_manager: "Pricing Manager",
  collections_agent: "Collections Agent",
  customer_support: "Customer Support",
  finance_controller: "Finance Controller",
  revenue_accountant: "Revenue Accountant",
  sales: "Sales",
  product_manager: "Product Manager",
  operations: "Operations",
  developer: "Developer",
  auditor: "Auditor",
  executive: "Executive",
});

export type GrantBasis = "spec" | "inferred" | "proposed";

export interface PersonaGrant {
  readonly persona: Persona;
  readonly permission: Permission;
  readonly basis: GrantBasis;
  /** Specification references; required for `spec` and `inferred`. */
  readonly sources: readonly string[];
  /** A per-role limit the specification attaches, such as an amount threshold. */
  readonly condition?: string;
  /** How the condition is enforced: a limit on this role's grant, or a default approval policy. */
  readonly enforcement?: { readonly kind: "role-limit"; readonly limit: Omit<PermissionConstraint, "permission"> } | { readonly kind: "approval-policy" };
  /** The Product Owner's decision on an `inferred` or `proposed` grant. */
  readonly decision?: "approved" | "declined";
}

const API4 = "13-api-specification.md §4";
const MS62 = "Master spec §62";
const PRD5 = "01-product-requirements-document.md §5";
const UX2 = "17-ux-information-architecture.md §2";

const REVIEW = "Product Owner review 2026-09-25";
/** Master spec §62: "Refund > $10,000 → approval"; the same default applies to finalization. Tenants can change it. */
const USD_10000 = Object.freeze({ kind: "role-limit" as const, limit: Object.freeze({ attribute: "amount_minor", operator: "lte" as const, value: 1_000_000 }) });

const grant = (
  persona: Persona,
  permission: Permission,
  basis: GrantBasis,
  sources: readonly string[],
  extra: Partial<Pick<PersonaGrant, "condition" | "enforcement" | "decision">> = {},
): PersonaGrant => Object.freeze({ persona, permission, basis, sources: Object.freeze([...sources]), ...extra });

export const PERSONA_GRANTS: readonly PersonaGrant[] = Object.freeze([
  // Billing Administrator: "run accurate billing operations" (PRD §5).
  grant("billing_administrator", "billing:invoice:preview", "spec", [API4, PRD5]),
  grant("billing_administrator", "billing:invoice:finalize", "spec", [API4, PRD5], {
    condition: "Only up to the tenant's threshold (API §4); above it, the Finance Controller finalizes.",
    enforcement: USD_10000,
  }),
  grant("billing_administrator", "payments:payment:refund", "spec", [API4, MS62], {
    condition: "Only up to the tenant's refund threshold (API §4, master spec §62: refunds above $10,000 need approval).",
    enforcement: USD_10000,
  }),
  grant("billing_administrator", "approval:request:propose", "inferred", [API4, MS62, REVIEW], {
    condition: "Needed to request approval for finalizations and refunds above the threshold.",
    decision: "approved",
  }),

  // Pricing Manager: "version product/plan/prices, simulate, request activation" (PRD §5).
  grant("pricing_manager", "pricing:rate_card:activate", "spec", [API4, MS62], {
    condition: "As proposer only: activation needs Product and Finance approval.",
    enforcement: { kind: "approval-policy" },
  }),
  grant("pricing_manager", "approval:request:propose", "spec", [API4, PRD5, "01-product-requirements-document.md §6 J-01"]),

  // Finance Controller: "approve sensitive actions, inspect audit trail, reconcile totals" (PRD §5).
  grant("finance_controller", "billing:invoice:preview", "spec", [API4]),
  grant("finance_controller", "billing:invoice:finalize", "spec", [API4]),
  grant("finance_controller", "payments:payment:refund", "spec", [API4]),
  grant("finance_controller", "subscription:change:backdate", "spec", [API4]),
  grant("finance_controller", "approval:request:decide", "spec", [API4, MS62, PRD5, UX2]),
  grant("finance_controller", "audit:read", "spec", [PRD5, UX2]),
  grant("finance_controller", "collections:case:approve_exception", "proposed", [API4, REVIEW], {
    condition: "API §4 names a Collections Manager, who is not a §61 persona; the Product Owner assigned it to the Finance Controller.",
    decision: "approved",
  }),

  // Product Manager: master spec §62 "Pricing activation → Product + Finance approval".
  grant("product_manager", "approval:request:decide", "spec", [MS62]),
  grant("product_manager", "pricing:rate_card:activate", "inferred", [MS62, REVIEW], {
    condition: "Makes the Product Manager the Product approver named by the default pricing-activation policy (D4).",
    decision: "approved",
  }),

  // Auditor: "verify who changed what and why" (PRD §5); read-only (API §4).
  grant("auditor", "audit:read", "spec", [API4, PRD5, UX2]),

  // Operations: no specification grant. Declined; dead letters stay with the tenant administrator for now.
  grant("operations", "outbox:dead_letter:resolve", "proposed", [REVIEW], { decision: "declined" }),
]);

/** Grants that ship by default: backed by the specification or the Product Owner, with any condition enforced. */
export function isDefaultGrant(value: Readonly<PersonaGrant>): boolean {
  if (value.decision === "declined") return false;
  const backed = value.basis === "spec" || value.decision === "approved";
  const enforced = value.condition === undefined || value.enforcement !== undefined || value.decision === "approved";
  return backed && enforced;
}

/** Grants still awaiting a Product Owner decision or an enforcement mechanism. */
export function pendingGrants(): readonly PersonaGrant[] {
  return PERSONA_GRANTS.filter((value) => !isDefaultGrant(value) && value.decision !== "declined");
}

export interface RoleTemplate {
  readonly roleCode: Persona;
  readonly title: string;
  readonly permissions: readonly Permission[];
  /** Role limits, for the role's `limits` (see RoleSnapshot). */
  readonly limits: readonly PermissionConstraint[];
}

/** Default role templates, one per persona, holding only the grants that ship by default. */
export function defaultPersonaRoleTemplates(): readonly RoleTemplate[] {
  return Object.freeze(
    PERSONAS.map((persona) =>
      Object.freeze({
        roleCode: persona,
        title: PERSONA_TITLES[persona],
        permissions: Object.freeze(
          PERMISSION_CATALOG.filter((permission) => PERSONA_GRANTS.some((value) => value.persona === persona && value.permission === permission && isDefaultGrant(value))),
        ),
        limits: Object.freeze(
          PERSONA_GRANTS.filter((value) => value.persona === persona && isDefaultGrant(value) && value.enforcement?.kind === "role-limit").map((value) =>
            Object.freeze({ permission: value.permission, ...(value.enforcement as { readonly limit: Omit<PermissionConstraint, "permission"> }).limit }),
          ),
        ),
      }),
    ),
  );
}

/** The review table: one row per persona, one column per permission. */
export function renderPersonaMatrix(): string {
  const mark = (persona: Persona, permission: Permission): string => {
    const found = PERSONA_GRANTS.find((value) => value.persona === persona && value.permission === permission);
    if (found === undefined) return "·";
    if (found.decision === "declined") return "🚫";
    if (isDefaultGrant(found)) return found.enforcement === undefined ? "✅" : "🔸";
    if (found.basis === "spec") return "🔒";
    return found.basis === "inferred" ? "❓" : "💡";
  };
  const header = `| Persona | ${PERMISSION_CATALOG.map((permission) => `\`${permission}\``).join(" | ")} |`;
  const divider = `|---|${PERMISSION_CATALOG.map(() => ":-:").join("|")}|`;
  const rows = PERSONAS.map((persona) => `| ${PERSONA_TITLES[persona]} | ${PERMISSION_CATALOG.map((permission) => mark(persona, permission)).join(" | ")} |`);
  return [header, divider, ...rows].join("\n");
}

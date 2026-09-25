import { PERMISSION_CATALOG, type Permission } from "./authorization.ts";

/**
 * Persona × permission matrix (decision D9). The 12 personas are exactly those of master
 * specification §61. Each grant records its basis:
 *
 * - `spec`: the specification names this persona for this permission (sources cited);
 * - `inferred`: follows from specification text that does not name the permission explicitly;
 * - `proposed`: an engineering suggestion with no specification basis.
 *
 * Only unconditional `spec` grants ship in the default role templates. `inferred` and `proposed`
 * grants, and `spec` grants that need a per-role limit the platform cannot yet enforce, stay denied
 * until the Product Owner approves them (they are listed by `pendingGrants`). Any permission a
 * persona has no grant for is denied.
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
}

const API4 = "13-api-specification.md §4";
const MS62 = "Master spec §62";
const PRD5 = "01-product-requirements-document.md §5";
const UX2 = "17-ux-information-architecture.md §2";

const grant = (persona: Persona, permission: Permission, basis: GrantBasis, sources: readonly string[], condition?: string): PersonaGrant =>
  Object.freeze({ persona, permission, basis, sources: Object.freeze([...sources]), ...(condition === undefined ? {} : { condition }) });

export const PERSONA_GRANTS: readonly PersonaGrant[] = Object.freeze([
  // Billing Administrator: "run accurate billing operations" (PRD §5).
  grant("billing_administrator", "billing:invoice:preview", "spec", [API4, PRD5]),
  grant("billing_administrator", "billing:invoice:finalize", "spec", [API4, PRD5], "Only below the tenant's approval threshold (API §4); above it, the Finance Controller finalizes."),
  grant("billing_administrator", "payments:payment:refund", "spec", [API4], "Only below the tenant's configured refund threshold (API §4)."),
  grant("billing_administrator", "approval:request:propose", "inferred", [API4, MS62], "Needed to request approval for finalizations and refunds above the threshold."),

  // Pricing Manager: "version product/plan/prices, simulate, request activation" (PRD §5).
  grant("pricing_manager", "pricing:rate_card:activate", "spec", [API4], "As proposer only: the activation itself needs a second-party approval (API §4, master spec §62)."),
  grant("pricing_manager", "approval:request:propose", "spec", [API4, PRD5, "01-product-requirements-document.md §6 J-01"]),

  // Finance Controller: "approve sensitive actions, inspect audit trail, reconcile totals" (PRD §5).
  grant("finance_controller", "billing:invoice:preview", "spec", [API4]),
  grant("finance_controller", "billing:invoice:finalize", "spec", [API4]),
  grant("finance_controller", "payments:payment:refund", "spec", [API4]),
  grant("finance_controller", "subscription:change:backdate", "spec", [API4]),
  grant("finance_controller", "approval:request:decide", "spec", [API4, MS62, PRD5, UX2]),
  grant("finance_controller", "audit:read", "spec", [PRD5, UX2]),

  // Product Manager: master spec §62 "Pricing activation → Product + Finance approval".
  grant("product_manager", "approval:request:decide", "spec", [MS62]),
  grant("product_manager", "pricing:rate_card:activate", "inferred", [MS62], "So the Product approver can satisfy a D4 named-approver requirement for pricing activation."),

  // Auditor: "verify who changed what and why" (PRD §5); read-only (API §4).
  grant("auditor", "audit:read", "spec", [API4, PRD5, UX2]),

  // Operations: no specification grant; the outbox relay needs a human operator for dead letters (D1).
  grant("operations", "outbox:dead_letter:resolve", "proposed", []),
]);

/** Grants that ship by default: specification-backed and unconditional. */
export function isDefaultGrant(value: Readonly<PersonaGrant>): boolean {
  return value.basis === "spec" && value.condition === undefined;
}

/** Grants that need a Product Owner decision (or role-scoped ABAC) before they ship. */
export function pendingGrants(): readonly PersonaGrant[] {
  return PERSONA_GRANTS.filter((value) => !isDefaultGrant(value));
}

export interface RoleTemplate {
  readonly roleCode: Persona;
  readonly title: string;
  readonly permissions: readonly Permission[];
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
      }),
    ),
  );
}

/** The review table: one row per persona, one column per permission. */
export function renderPersonaMatrix(): string {
  const mark = (persona: Persona, permission: Permission): string => {
    const found = PERSONA_GRANTS.find((value) => value.persona === persona && value.permission === permission);
    if (found === undefined) return "·";
    if (isDefaultGrant(found)) return "✅";
    if (found.basis === "spec") return "🔒";
    return found.basis === "inferred" ? "❓" : "💡";
  };
  const header = `| Persona | ${PERMISSION_CATALOG.map((permission) => `\`${permission}\``).join(" | ")} |`;
  const divider = `|---|${PERMISSION_CATALOG.map(() => ":-:").join("|")}|`;
  const rows = PERSONAS.map((persona) => `| ${PERSONA_TITLES[persona]} | ${PERMISSION_CATALOG.map((permission) => mark(persona, permission)).join(" | ")} |`);
  return [header, divider, ...rows].join("\n");
}

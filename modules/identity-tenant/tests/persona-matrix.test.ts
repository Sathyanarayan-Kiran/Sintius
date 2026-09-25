import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { actorId, resolveTenantContext, runWithTenantContext, tenantId, type ActorId, type TenantId } from "../../../platform/tenant-context/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import { createTenantAuthorizer } from "../application/authorization.ts";
import { PERMISSION_CATALOG, type RoleSnapshot } from "../domain/authorization.ts";
import {
  PERSONAS,
  PERSONA_GRANTS,
  PERSONA_TITLES,
  defaultPersonaRoleTemplates,
  isDefaultGrant,
  pendingGrants,
  renderPersonaMatrix,
} from "../domain/persona-matrix.ts";

const root = resolve(import.meta.dirname, "../../..");
const A = tenantId("tenant_persona_A");
const B = tenantId("tenant_persona_B");

test("D9 the matrix covers exactly the 12 personas of master spec §61 and only catalogued permissions, with a cited basis", () => {
  const register = JSON.parse(readFileSync(resolve(root, "docs/implementation/requirement-register.json"), "utf8")) as {
    requirements: { id: string; disposition: string; statement: string }[];
  };
  const specPersonas = register.requirements
    .filter((requirement) => requirement.id.startsWith("MSR-061-") && requirement.disposition === "accepted" && !/RBAC/.test(requirement.statement))
    .map((requirement) => requirement.statement.replace(/\.$/, ""));
  assert.deepEqual([...specPersonas].sort(), PERSONAS.map((persona) => PERSONA_TITLES[persona]).sort());

  const seen = new Set<string>();
  for (const value of PERSONA_GRANTS) {
    assert.ok((PERMISSION_CATALOG as readonly string[]).includes(value.permission), value.permission);
    assert.ok(!seen.has(`${value.persona}|${value.permission}`), `duplicate grant ${value.persona} ${value.permission}`);
    seen.add(`${value.persona}|${value.permission}`);
    if (value.basis !== "proposed") assert.ok(value.sources.length > 0, `${value.persona} ${value.permission} cites its source`);
  }
  // The platform's own diagnostic permission is never part of a persona.
  assert.ok(PERSONA_GRANTS.every((value) => value.permission !== "foundation:proof:execute"));
});

test("D9 default role templates ship only unconditional specification grants; everything else waits for a decision", () => {
  const templates = defaultPersonaRoleTemplates();
  assert.equal(templates.length, 12);
  for (const template of templates) {
    for (const permission of template.permissions) {
      const source = PERSONA_GRANTS.find((value) => value.persona === template.roleCode && value.permission === permission);
      assert.ok(source !== undefined && isDefaultGrant(source), `${template.roleCode} ${permission} ships only with an unconditional spec basis`);
    }
  }
  for (const pending of pendingGrants()) {
    const template = templates.find((candidate) => candidate.roleCode === pending.persona)!;
    assert.equal(template.permissions.includes(pending.permission), false, `${pending.persona} ${pending.permission} is pending`);
  }
});

test("D9 the review document shows the matrix exactly as the code defines it", () => {
  const document = readFileSync(resolve(root, "docs/implementation/persona-permission-matrix.md"), "utf8");
  const between = /<!-- matrix:start -->\n([\s\S]*?)\n<!-- matrix:end -->/.exec(document);
  assert.ok(between !== null, "the document has matrix markers");
  assert.equal(between[1], renderPersonaMatrix(), "regenerate the table from persona-matrix.ts");
});

test("TC-002-03-01 persona allow/deny matrix: each default persona role allows exactly its grants, in its own tenant only", async () => {
  const templates = defaultPersonaRoleTemplates();
  const roleOf = new Map<string, Readonly<RoleSnapshot>>(templates.map((template) => [`${A}|user_${template.roleCode}`, { roleCode: template.roleCode, permissions: template.permissions, status: "active" as const }]));
  const authorizer = createTenantAuthorizer({
    grants: {
      async loadAssignedRoles(tenant: TenantId, actor: ActorId) {
        const role = roleOf.get(`${tenant}|${actor}`);
        return role === undefined ? [] : [role];
      },
    },
  });
  const as = <T>(tenant: TenantId, actor: string, work: () => Promise<T>) =>
    runWithTenantContext(resolveTenantContext({ principal: testPrincipal([A, B], { actor }), selectedTenantId: tenant, tenantState: "ACTIVE", correlationId: "corr_persona" }), work);

  let allowed = 0;
  let denied = 0;
  for (const template of templates) {
    for (const permission of PERMISSION_CATALOG) {
      const expected = template.permissions.includes(permission);
      assert.equal(await as(A, `user_${template.roleCode}`, () => authorizer.hasPermission(permission)), expected, `${template.roleCode} ${permission}`);
      assert.equal(await as(B, `user_${template.roleCode}`, () => authorizer.hasPermission(permission)), false, `${template.roleCode} holds nothing in tenant B`);
      if (expected) allowed += 1;
      else denied += 1;
    }
  }
  assert.equal(allowed + denied, 12 * PERMISSION_CATALOG.length);
  assert.ok(allowed >= 10, "the specification grants are present");
  assert.equal(await as(A, "user_unassigned", () => authorizer.hasPermission("audit:read")), false, "no role, no permission");
  assert.equal(actorId("user_auditor"), "user_auditor");
});

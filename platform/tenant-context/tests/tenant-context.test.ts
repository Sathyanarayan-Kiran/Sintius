import assert from "node:assert/strict";
import test from "node:test";
import { PlatformProblem, mapErrorToProblemResponse, runAtProblemBoundary } from "../../problem-model/src/index.ts";
import { actorId, currentTenantContext, issueAuthenticatedPrincipal, resolvePlatformCommandContext, resolveTenantContext, runWithTenantContext, tenantId } from "../src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";

const tenantA = tenantId("tenant_A");
const tenantB = tenantId("tenant_B");
const principal = testPrincipal([tenantA]);

test("TC-001-01-01 resolves and propagates immutable trusted context across async work", async () => {
  const context = resolveTenantContext({ principal, selectedTenantId: tenantA, tenantState: "ACTIVE", correlationId: "corr_1" });
  await runWithTenantContext(context, async () => {
    await Promise.resolve();
    assert.equal(currentTenantContext(), context);
    assert.equal(currentTenantContext().tenantId, tenantA);
    assert.equal(Object.isFrozen(currentTenantContext()), true);
  });
});

test("TC-001-01-02 denies a selected tenant absent from verified memberships", () => {
  assert.throws(
    () => resolveTenantContext({ principal, selectedTenantId: tenantB, tenantState: "ACTIVE", correlationId: "corr_2" }),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "tenant_access_denied",
  );
});

test("TC-001-01-02 rejects tenant identity supplied by an untrusted request body", () => {
  assert.throws(
    () => resolveTenantContext({ principal, selectedTenantId: tenantA, tenantState: "ACTIVE", correlationId: "corr_3", bodyTenantId: tenantA }),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "untrusted_tenant_context",
  );
});

test("denies suspended tenants and fails closed without a context", () => {
  assert.throws(
    () => resolveTenantContext({ principal, selectedTenantId: tenantA, tenantState: "SUSPENDED", correlationId: "corr_4" }),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "tenant_not_active",
  );
  assert.throws(
    () => currentTenantContext(),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "tenant_context_missing",
  );
});

test("tenant context failures map to canonical problem responses carrying the trusted correlation ID", async () => {
  const cases = [
    { input: { selectedTenantId: tenantB, tenantState: "ACTIVE" as const }, status: 403, code: "tenant_access_denied" },
    { input: { selectedTenantId: tenantA, tenantState: "SUSPENDED" as const }, status: 403, code: "tenant_not_active" },
    { input: { selectedTenantId: tenantA, tenantState: "ACTIVE" as const, bodyTenantId: tenantA }, status: 400, code: "untrusted_tenant_context" },
  ];
  for (const { input, status, code } of cases) {
    const result = await runAtProblemBoundary({ correlationId: "corr_ingress_1" }, () =>
      resolveTenantContext({ principal, correlationId: "corr_ingress_1", ...input }),
    );
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.response.status, status);
    assert.equal(result.response.body.code, code);
    assert.equal(result.response.body.correlation_id, "corr_ingress_1");
    assert.equal(result.response.headers["content-type"], "application/problem+json");
    assert.equal(JSON.stringify(result.response).includes(tenantB), false, "must not disclose tenant identifiers");
  }
  const missing = mapErrorToProblemResponse((() => { try { currentTenantContext(); } catch (error) { return error; } })(), { correlationId: "corr_ingress_2" });
  assert.equal(missing.status, 500);
  assert.equal(missing.body.code, "tenant_context_missing");
});

test("principal-shaped literals are rejected by tenant and platform context resolvers", () => {
  const forged = Object.freeze({
    actorId: actorId("attacker_1"),
    kind: "interactive" as const,
    tenantMemberships: Object.freeze([tenantA]),
    assurance: "mfa" as const,
    credentialId: "forged_credential",
    issuer: "https://attacker.invalid",
    audiences: Object.freeze(["sintius-test"]),
    scopes: Object.freeze([]),
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  assert.throws(
    () => resolveTenantContext({ principal: forged, selectedTenantId: tenantA, tenantState: "ACTIVE", correlationId: "corr_forged_tenant" }),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "authentication_failed",
  );
  assert.throws(
    () => resolvePlatformCommandContext({ principal: forged, correlationId: "corr_forged_platform" }),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "authentication_failed",
  );
});

test("expired issued principals are rejected when tenant and platform contexts are resolved", () => {
  const expired = issueAuthenticatedPrincipal({
    actorId: "user_expired",
    kind: "interactive",
    tenantMemberships: [tenantA],
    assurance: "mfa",
    credentialId: "credential_expired",
    issuer: "https://identity.test.invalid",
    audiences: ["sintius-test"],
    scopes: [],
    expiresAt: "2000-01-01T00:00:00.000Z",
  });
  assert.throws(
    () => resolveTenantContext({ principal: expired, selectedTenantId: tenantA, tenantState: "ACTIVE", correlationId: "corr_expired_tenant" }),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "authentication_failed",
  );
  assert.throws(
    () => resolvePlatformCommandContext({ principal: expired, correlationId: "corr_expired_platform" }),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "authentication_failed",
  );
});

test("principal issuance rejects inconsistent assurance and invalid authority metadata", () => {
  assert.throws(
    () => issueAuthenticatedPrincipal({
      actorId: "user_1",
      kind: "interactive",
      tenantMemberships: [tenantA],
      assurance: "workload",
      credentialId: "credential_1",
      issuer: "https://identity.test.invalid",
      audiences: ["sintius-test"],
      scopes: [],
      expiresAt: "2099-01-01T00:00:00.000Z",
    }),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "authentication_failed",
  );
  assert.throws(
    () => issueAuthenticatedPrincipal({
      actorId: "user_1",
      kind: "interactive",
      tenantMemberships: [tenantA],
      assurance: "mfa",
      credentialId: "credential_1",
      issuer: "https://identity.test.invalid",
      audiences: [],
      scopes: [],
      expiresAt: "not-an-instant",
    }),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "authentication_failed",
  );
});

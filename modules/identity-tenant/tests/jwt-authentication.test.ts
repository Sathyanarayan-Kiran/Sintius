import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { before } from "node:test";
import { SignJWT } from "jose";
import { metricValue, testTelemetry } from "../../../platform/observability/tests/support.ts";
import { PlatformProblem } from "../../../platform/problem-model/src/index.ts";
import { resolvePlatformCommandContext, resolveTenantContext, tenantId } from "../../../platform/tenant-context/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import { createAuthenticator } from "../application/authentication.ts";
import type { AuthenticationFact, IdentityProviderPolicy } from "../application/authentication-ports.ts";
import { createPlatformAuthorizer } from "../application/platform-authorization.ts";
import { PLATFORM_AUDIENCE } from "../domain/platform-access.ts";
import { createJwtCredentialVerifier, localKeySet, remoteKeySet } from "../infrastructure/jose/jwt-verifier.ts";
import { issueToken, signingKey, unsignedToken, type SigningKey } from "./jwt-support.ts";

/**
 * Authentication with real signed tokens (decision D8): `jose` verifies signatures against the
 * provider's keys, and the authentication service enforces issuer, audience, lifetime, MFA,
 * revocation, workload scope and the separate platform-operator audience (decision D11).
 */

testTelemetry();
// Anchored to real time (whole seconds, as JWT times are): principals are re-checked against the
// wall clock when a tenant context is resolved, so a fixed date would expire these tokens.
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
const minutes = (count: number) => new Date(NOW.valueOf() + count * 60_000);
const A = tenantId("tenant_jwt_A");
const B = tenantId("tenant_jwt_B");

const policy = (overrides: Partial<IdentityProviderPolicy> & Pick<IdentityProviderPolicy, "id">): IdentityProviderPolicy =>
  Object.freeze({
    mechanism: "oidc",
    issuer: "https://idp.jwt.test",
    allowedAudiences: Object.freeze(["sintius-api"]),
    clockSkewSeconds: 30,
    requireMfa: true,
    allowedWorkloadScopes: Object.freeze([]),
    ...overrides,
  });

const tenantIdp = policy({ id: "oidc-tenant" });
const platformIdp = policy({ id: "oidc-platform", issuer: "https://staff.jwt.test", allowedAudiences: Object.freeze([PLATFORM_AUDIENCE]) });
const workloadIdp = policy({
  id: "workload",
  mechanism: "workload_token",
  issuer: "https://workload.jwt.test",
  allowedAudiences: Object.freeze(["rating-worker"]),
  requireMfa: false,
  allowedWorkloadScopes: Object.freeze(["usage:read", "rating:write"]),
});
const samlIdp = policy({ id: "saml-tenant", mechanism: "saml" });

let key: SigningKey;
let otherKey: SigningKey;
let staffKey: SigningKey;
let workloadKey: SigningKey;
let ids = 0;

before(async () => {
  [key, otherKey, staffKey, workloadKey] = await Promise.all([signingKey("tenant-1"), signingKey("tenant-1"), signingKey("staff-1", "RS256"), signingKey("worker-1", "EdDSA")]);
});

function fixture(options: { readonly revoked?: Set<string> } = {}) {
  const facts: AuthenticationFact[] = [];
  const revoked = options.revoked ?? new Set<string>();
  const policies = new Map([tenantIdp, platformIdp, workloadIdp, samlIdp].map((value) => [value.id, value]));
  const authenticator = createAuthenticator({
    policies: { findById: async (id) => policies.get(id) },
    verifier: createJwtCredentialVerifier({
      clock: () => NOW,
      providers: {
        "oidc-tenant": { keys: localKeySet({ keys: [key.jwk] }) },
        "oidc-platform": { keys: localKeySet({ keys: [staffKey.jwk] }) },
        workload: { keys: localKeySet({ keys: [workloadKey.jwk] }), type: "at+jwt", maxTokenAgeSeconds: 300 },
        "saml-tenant": { keys: localKeySet({ keys: [key.jwk] }) },
      },
    }),
    credentialStatus: { isRevoked: async ({ issuer, credentialId }) => revoked.has(`${issuer}|${credentialId}`) },
    clock: () => NOW,
    facts: { record: (fact) => void facts.push(fact) },
  });
  return { authenticator, facts, revoked };
}

function userToken(overrides: Partial<Parameters<typeof issueToken>[1]> = {}, signer: SigningKey = key) {
  return issueToken(signer, {
    issuer: tenantIdp.issuer,
    audience: "sintius-api",
    subject: "user_1",
    jti: `jti_${++ids}`,
    issuedAt: minutes(-1),
    expiresAt: minutes(10),
    ...overrides,
    claims: { sintius_tenants: [A], amr: ["pwd", "mfa"], ...(overrides.claims ?? {}) },
  });
}

const code = (expected: string) => (error: unknown) => error instanceof PlatformProblem && error.problem.code === expected;
const asUser = (authenticator: ReturnType<typeof fixture>["authenticator"], raw: string, providerId = tenantIdp.id) =>
  authenticator.authenticateInteractive({ providerId, rawCredential: raw, requiredAudience: "sintius-api", correlationId: "corr_jwt" });

test("TC-002-02-01 jose verifies the provider's signature and maps OIDC claims to an interactive principal", async () => {
  const { authenticator, facts } = fixture();
  const principal = await asUser(authenticator, await userToken({ claims: { sintius_tenants: [A, B] } }));
  assert.deepEqual(
    { actor: principal.actorId, kind: principal.kind, tenants: principal.tenantMemberships, assurance: principal.assurance, issuer: principal.issuer, audiences: principal.audiences },
    { actor: "user_1", kind: "interactive", tenants: [A, B], assurance: "mfa", issuer: tenantIdp.issuer, audiences: ["sintius-api"] },
  );
  assert.equal(principal.expiresAt, minutes(10).toISOString());
  assert.deepEqual(facts.map((fact) => [fact.kind, fact.outcome, fact.actorId, fact.mechanism]), [["interactive", "succeeded", "user_1", "oidc"]]);
});

test("TC-002-02-01 forged, unsigned, symmetric, tampered and mis-addressed tokens fail generically", async () => {
  const { authenticator, facts } = fixture();
  const valid = await userToken();
  const [header, payload, signature] = valid.split(".") as [string, string, string];
  const tampered = `${header}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), sintius_tenants: [B] })).toString("base64url")}.${signature}`;
  const symmetric = await new SignJWT({ sintius_tenants: [A], amr: ["mfa"] })
    .setProtectedHeader({ alg: "HS256", kid: "tenant-1" })
    .setIssuer(tenantIdp.issuer).setAudience("sintius-api").setSubject("user_1").setJti("jti_hs").setIssuedAt(minutes(-1)).setExpirationTime(minutes(10))
    .sign(new TextEncoder().encode("a-shared-secret-an-attacker-might-guess"));
  const attempts = {
    "signed by another key with the same kid": await userToken({}, otherKey),
    unsigned: unsignedToken({ iss: tenantIdp.issuer, aud: "sintius-api", sub: "user_1", jti: "jti_none", iat: 1, exp: 4_102_444_800, sintius_tenants: [A], amr: ["mfa"] }),
    "HS256 with a shared secret": symmetric,
    "payload tampered after signing": tampered,
    "wrong issuer": await userToken({ issuer: "https://evil.jwt.test" }),
    "wrong audience": await userToken({ audience: "another-api" }),
    expired: await userToken({ issuedAt: minutes(-30), expiresAt: minutes(-5) }),
    "not yet valid": await userToken({ notBefore: minutes(5) }),
    "issued too long ago": await userToken({ issuedAt: minutes(-120), expiresAt: minutes(60) }),
    "not a JWT": "definitely-not-a-token",
  };
  for (const [name, raw] of Object.entries(attempts)) {
    const error = await asUser(authenticator, raw).catch((failure: unknown) => failure);
    assert.ok(code("authentication_failed")(error), `${name} must be refused`);
    assert.equal(JSON.stringify((error as PlatformProblem).problem).includes(raw), false, `${name}: the token never appears in the problem`);
  }
  assert.ok(facts.every((fact) => fact.outcome === "failed" && fact.reason === "credential_invalid"), JSON.stringify(facts));
  assert.equal(JSON.stringify(facts).includes(valid.split(".")[1]!), false, "facts never carry token contents");
});

// Specification-derived requirements (master specification §80): each names exactly the one
// mechanism it demonstrates, so a status claim for one never implies the other two.
test("TC-MSR-080-3B6F4B3FE4 OIDC/OAuth2: a real jose-verified OIDC bearer token opens an interactive session", async () => {
  const { authenticator } = fixture();
  const principal = await asUser(authenticator, await userToken());
  assert.deepEqual(
    { kind: principal.kind, mechanism: tenantIdp.mechanism, issuer: principal.issuer, audiences: principal.audiences },
    { kind: "interactive", mechanism: "oidc", issuer: tenantIdp.issuer, audiences: ["sintius-api"] },
    "the token was verified as an OIDC/OAuth2 bearer credential against the provider's published keys",
  );
  await assert.rejects(asUser(authenticator, await userToken({}, otherKey)), code("authentication_failed"), "a token not signed by the provider's key is not OIDC-valid");
});

test("TC-MSR-080-477F636C27 MFA: a session requires amr to carry mfa, and single-factor credentials are refused", async () => {
  const { authenticator } = fixture();
  const principal = await asUser(authenticator, await userToken({ claims: { amr: ["pwd", "mfa"] } }));
  assert.equal(principal.assurance, "mfa", "a multi-factor credential is granted mfa assurance");
  await assert.rejects(
    asUser(authenticator, await userToken({ claims: { amr: ["pwd"] } })),
    code("authentication_assurance_insufficient"),
    "a single-factor credential is refused where the provider policy requires MFA",
  );
});

test("TC-002-02-01 key discovery: the published JWKS is fetched, a rotated signing key is picked up and a retired key stops working", async () => {
  const next = await signingKey("tenant-2");
  let published = [key.jwk];
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys: published }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/.well-known/jwks.json`;
    const verifier = createJwtCredentialVerifier({ clock: () => NOW, providers: { "oidc-tenant": { keys: remoteKeySet(url, { cooldownSeconds: 0 }) } } });
    const authenticator = createAuthenticator({
      policies: { findById: async (id) => (id === tenantIdp.id ? tenantIdp : undefined) },
      verifier,
      credentialStatus: { isRevoked: async () => false },
      clock: () => NOW,
    });
    const beforeRotation = await userToken();
    assert.equal((await asUser(authenticator, beforeRotation)).actorId, "user_1");

    published = [next.jwk]; // The provider rotates: only the new key is published.
    assert.equal((await asUser(authenticator, await userToken({}, next))).actorId, "user_1", "an unknown kid triggers a refetch");
    await assert.rejects(asUser(authenticator, await userToken({ jti: "jti_after_retirement" })), code("authentication_failed"), "the retired key no longer verifies");
  } finally {
    server.close();
  }
  assert.throws(() => remoteKeySet("http://idp.example.test/jwks.json"), /https/, "remote key sets require https outside loopback");
});

test("TC-002-02-01 SAML is federated through the identity provider and only asymmetric algorithms are configurable", async () => {
  const { authenticator } = fixture();
  await assert.rejects(asUser(authenticator, await userToken(), samlIdp.id), code("authentication_failed"), "no in-process SAML (D8)");
  assert.throws(() => createJwtCredentialVerifier({ providers: { x: { keys: localKeySet({ keys: [key.jwk] }), algorithms: ["HS256"] } } }), /not an allowed asymmetric algorithm/);
  assert.throws(() => createJwtCredentialVerifier({ providers: { x: { keys: localKeySet({ keys: [key.jwk] }), algorithms: ["none"] } } }), /not an allowed asymmetric algorithm/);
});

test("TC-002-02-02 signed tokens: MFA is required, expiry and revocation deny the next request, and each outcome is a redacted security fact", async () => {
  const { authenticator, facts, revoked } = fixture();
  await assert.rejects(asUser(authenticator, await userToken({ claims: { amr: ["pwd"] } })), code("authentication_assurance_insufficient"));

  const raw = await userToken({ jti: "jti_session" });
  assert.equal((await asUser(authenticator, raw)).credentialId, "jti_session");
  revoked.add(`${tenantIdp.issuer}|jti_session`);
  await assert.rejects(asUser(authenticator, raw), code("authentication_failed"), "revocation applies to the very next request");

  const shortLived = createAuthenticator({
    policies: { findById: async () => tenantIdp },
    verifier: createJwtCredentialVerifier({ clock: () => minutes(20), providers: { "oidc-tenant": { keys: localKeySet({ keys: [key.jwk] }) } } }),
    credentialStatus: { isRevoked: async () => false },
    clock: () => minutes(20),
  });
  await assert.rejects(asUser(shortLived, await userToken()), code("authentication_failed"), "the same token is refused once it expires");

  assert.deepEqual(facts.map((fact) => fact.reason ?? fact.outcome), ["mfa_required", "succeeded", "revoked"]);
  assert.equal(facts[2]!.credentialId, "jti_session", "the token ID, not the token, identifies the revoked credential");
  assert.equal(JSON.stringify(facts).includes(raw), false);
  assert.ok((await metricValue("sintius.authentication.outcomes", { "sintius.auth.reason": "revoked", "sintius.auth.provider": "oidc-tenant" })) >= 1);
});

test("TC-002-04-01 signed workload tokens are bound to one tenant, one audience and the declared scopes", async () => {
  const { authenticator } = fixture();
  const workload = (claims: Record<string, unknown>, overrides: Partial<Parameters<typeof issueToken>[1]> = {}) =>
    issueToken(workloadKey, {
      issuer: workloadIdp.issuer, audience: "rating-worker", subject: "svc_rating", jti: `jti_w_${++ids}`, issuedAt: minutes(-1), expiresAt: minutes(5),
      type: "at+jwt", ...overrides, claims: { sintius_tenants: [A], scope: "usage:read rating:write", ...claims },
    });
  const run = async (raw: string, requiredScopes: readonly string[] = ["usage:read"]) =>
    authenticator.authenticateWorkload({ providerId: "workload", rawCredential: raw, requiredAudience: "rating-worker", requiredScopes, correlationId: "corr_w" });

  const principal = await run(await workload({}));
  assert.deepEqual([principal.kind, principal.tenantMemberships, principal.scopes, principal.assurance], ["workload", [A], ["usage:read"], "workload"], "down-scoped to the invocation");
  await assert.rejects(run(await workload({ sintius_tenants: [A, B] })), code("workload_scope_denied"), "one tenant per workload credential");
  await assert.rejects(run(await workload({ scope: "usage:read" }), ["rating:write"]), code("workload_scope_denied"), "a scope it was not issued");
  await assert.rejects(run(await workload({ scope: "usage:read admin:all" })), code("workload_scope_denied"), "a scope the provider may not grant");
  await assert.rejects(run(await workload({}, { audience: "outbox-dispatcher" })), code("authentication_failed"), "another audience");
  await assert.rejects(run(await workload({}, { type: "JWT" })), code("authentication_failed"), "an ID token or other JWT type is not an access token");
  await assert.rejects(run(await workload({}, { issuedAt: minutes(-10), expiresAt: minutes(5) })), code("authentication_failed"), "workload tokens are short-lived");
  await assert.rejects(
    authenticator.authenticateInteractive({ providerId: "workload", rawCredential: await workload({}), requiredAudience: "rating-worker", correlationId: "corr_w" }),
    code("authentication_failed"),
    "a workload credential cannot open an interactive session",
  );
});

test("D11 platform operators authenticate on the platform audience only, with MFA, no tenants and reviewed roles", async () => {
  const { authenticator } = fixture();
  const staff = (claims: Record<string, unknown>, overrides: Partial<Parameters<typeof issueToken>[1]> = {}) =>
    issueToken(staffKey, {
      issuer: platformIdp.issuer, audience: PLATFORM_AUDIENCE, subject: "ops_1", jti: `jti_p_${++ids}`, issuedAt: minutes(-1), expiresAt: minutes(10),
      ...overrides, claims: { amr: ["pwd", "mfa"], sintius_platform_roles: ["platform_tenant_provisioner", "no_such_role"], ...claims },
    });
  const asOperator = (raw: string, providerId = platformIdp.id) => authenticator.authenticatePlatformOperator({ providerId, rawCredential: raw, correlationId: "corr_p" });

  const operator = await asOperator(await staff({}));
  assert.deepEqual(
    [operator.kind, operator.tenantMemberships, operator.assurance, operator.audiences, operator.scopes],
    ["interactive", [], "mfa", [PLATFORM_AUDIENCE], ["platform:tenant:provision"]],
    "unknown roles grant nothing",
  );
  await assert.rejects(asOperator(await staff({ amr: ["pwd"] })), code("authentication_assurance_insufficient"), "MFA is always required");
  await assert.rejects(asOperator(await staff({ sintius_tenants: [A] })), code("authentication_failed"), "a platform token carries no tenant memberships");
  await assert.rejects(asOperator(await userToken()), code("authentication_failed"), "a tenant user's token is not a platform token");
  await assert.rejects(asOperator(await userToken(), tenantIdp.id), code("authentication_failed"), "the tenant provider cannot mint platform sessions");
  await assert.rejects(asUser(authenticator, await staff({}), platformIdp.id), code("authentication_failed"), "an operator cannot open a tenant session");
  assert.throws(
    () => resolveTenantContext({ principal: operator, selectedTenantId: A, tenantState: "ACTIVE", correlationId: "corr_p" }),
    code("tenant_access_denied"),
    "platform power never implies tenant access",
  );

  const authorizer = createPlatformAuthorizer();
  const context = (principal: typeof operator) => resolvePlatformCommandContext({ principal, correlationId: "corr_p" });
  await authorizer.assertAllowed(context(operator), "platform:tenant:provision");
  await assert.rejects(authorizer.assertAllowed(context(operator), "platform:tenant:lifecycle"), code("platform_access_denied"));
  const tenantAdmin = testPrincipal([A], { actor: "admin_A", scopes: ["platform:tenant:provision"] });
  await assert.rejects(authorizer.assertAllowed(context(tenantAdmin), "platform:tenant:provision"), code("platform_access_denied"), "a tenant principal is never a platform operator");
  const worker = testPrincipal([A], { kind: "workload", audiences: [PLATFORM_AUDIENCE], scopes: ["platform:tenant:provision"] });
  await assert.rejects(authorizer.assertAllowed(context(worker), "platform:tenant:provision"), code("platform_access_denied"), "nor is a workload");
  await assert.rejects(
    authorizer.assertAllowed({ ...context(operator) }, "platform:tenant:provision"),
    code("tenant_context_mismatch"),
    "a copied context literal is not trusted",
  );
});


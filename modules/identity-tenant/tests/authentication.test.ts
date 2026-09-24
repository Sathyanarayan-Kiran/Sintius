import assert from "node:assert/strict";
import test from "node:test";
import { PlatformProblem } from "../../../platform/problem-model/src/index.ts";
import { resolveTenantContext, runWithTenantContext, tenantId } from "../../../platform/tenant-context/src/index.ts";
import { createAuthenticator } from "../application/authentication.ts";
import type {
  CredentialStatusStore,
  CredentialVerifier,
  IdentityProviderPolicy,
  IdentityProviderPolicyStore,
  VerifiedCredentialClaims,
} from "../application/authentication-ports.ts";

const now = new Date("2026-09-24T12:00:00.000Z");
const tenantA = tenantId("tenant_A");
const tenantB = tenantId("tenant_B");

const oidcPolicy: IdentityProviderPolicy = Object.freeze({
  id: "oidc-admin",
  mechanism: "oidc",
  issuer: "https://idp.example.test",
  allowedAudiences: Object.freeze(["sintius-admin"]),
  clockSkewSeconds: 30,
  requireMfa: true,
  allowedWorkloadScopes: Object.freeze([]),
});

const samlPolicy: IdentityProviderPolicy = Object.freeze({
  id: "saml-admin",
  mechanism: "saml",
  issuer: "https://saml.example.test",
  allowedAudiences: Object.freeze(["sintius-admin"]),
  clockSkewSeconds: 30,
  requireMfa: true,
  allowedWorkloadScopes: Object.freeze([]),
});

const workloadPolicy: IdentityProviderPolicy = Object.freeze({
  id: "workload",
  mechanism: "workload_token",
  issuer: "https://workload.example.test",
  allowedAudiences: Object.freeze(["rating-worker", "outbox-dispatcher"]),
  clockSkewSeconds: 10,
  requireMfa: false,
  allowedWorkloadScopes: Object.freeze(["usage:read", "rating:write", "outbox:dispatch"]),
});

function claims(overrides: Partial<VerifiedCredentialClaims> = {}): VerifiedCredentialClaims {
  return Object.freeze({
    mechanism: "oidc" as const,
    credentialId: "credential_1",
    subject: "user_1",
    issuer: oidcPolicy.issuer,
    audiences: Object.freeze(["sintius-admin"]),
    tenantIds: Object.freeze([tenantA]),
    authenticationMethods: Object.freeze(["password", "mfa"]),
    scopes: Object.freeze([]),
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  });
}

class MemoryPolicyStore implements IdentityProviderPolicyStore {
  readonly policies = new Map([oidcPolicy, samlPolicy, workloadPolicy].map((policy) => [policy.id, policy]));
  async findById(id: string): Promise<Readonly<IdentityProviderPolicy> | undefined> {
    return this.policies.get(id);
  }
}

class FakeVerifier implements CredentialVerifier {
  readonly values = new Map<string, Readonly<VerifiedCredentialClaims>>();
  async verify(rawCredential: string): Promise<Readonly<VerifiedCredentialClaims>> {
    if (rawCredential === "invalid-signature-secret-token") throw new Error("signature invalid: invalid-signature-secret-token");
    const value = this.values.get(rawCredential);
    if (value === undefined) throw new Error("credential not recognized");
    return value;
  }
}

class MemoryCredentialStatus implements CredentialStatusStore {
  readonly revoked = new Set<string>();
  async isRevoked(credentialId: string): Promise<boolean> {
    return this.revoked.has(credentialId);
  }
}

function fixture() {
  const verifier = new FakeVerifier();
  const credentialStatus = new MemoryCredentialStatus();
  const authenticator = createAuthenticator({
    policies: new MemoryPolicyStore(),
    verifier,
    credentialStatus,
    clock: () => now,
  });
  return { verifier, credentialStatus, authenticator };
}

function isProblem(code: string) {
  return (error: unknown): boolean => error instanceof PlatformProblem && error.problem.code === code;
}

// TC-002-02-01 - OIDC/SAML claim and key validation ------------------------------------------

test("TC-002-02-01 valid OIDC and SAML credentials map to immutable interactive principals", async () => {
  const { verifier, authenticator } = fixture();
  verifier.values.set("valid-oidc", claims());
  verifier.values.set(
    "valid-saml",
    claims({ mechanism: "saml", credentialId: "saml_assertion_1", issuer: samlPolicy.issuer, subject: "user_2" }),
  );

  const oidc = await authenticator.authenticateInteractive({
    providerId: oidcPolicy.id,
    rawCredential: "valid-oidc",
    requiredAudience: "sintius-admin",
    correlationId: "corr_oidc",
  });
  const saml = await authenticator.authenticateInteractive({
    providerId: samlPolicy.id,
    rawCredential: "valid-saml",
    requiredAudience: "sintius-admin",
    correlationId: "corr_saml",
  });

  assert.equal(oidc.kind, "interactive");
  assert.equal(oidc.assurance, "mfa");
  assert.deepEqual(oidc.tenantMemberships, [tenantA]);
  assert.deepEqual(oidc.audiences, ["sintius-admin"]);
  assert.equal(saml.actorId, "user_2");
  assert.equal(Object.isFrozen(oidc), true);
  assert.equal(Object.isFrozen(oidc.tenantMemberships), true);
});

test("TC-002-02-01 invalid signatures, issuers, audiences and activation times fail generically", async () => {
  const cases: ReadonlyArray<readonly [string, VerifiedCredentialClaims]> = [
    ["wrong-issuer", claims({ issuer: "https://attacker.invalid" })],
    ["wrong-audience", claims({ audiences: Object.freeze(["some-other-api"]) })],
    ["not-active", claims({ notBefore: "2026-09-24T12:10:00.000Z" })],
    ["wrong-mechanism", claims({ mechanism: "saml" })],
  ];
  for (const [rawCredential, value] of cases) {
    const { verifier, authenticator } = fixture();
    verifier.values.set(rawCredential, value);
    await assert.rejects(
      authenticator.authenticateInteractive({
        providerId: oidcPolicy.id,
        rawCredential,
        requiredAudience: "sintius-admin",
        correlationId: "corr_invalid",
      }),
      isProblem("authentication_failed"),
    );
  }

  const { authenticator } = fixture();
  const rejection = await authenticator
    .authenticateInteractive({
      providerId: oidcPolicy.id,
      rawCredential: "invalid-signature-secret-token",
      requiredAudience: "sintius-admin",
      correlationId: "corr_invalid_key",
    })
    .catch((error: unknown) => error);
  assert.ok(rejection instanceof PlatformProblem);
  assert.equal(rejection.problem.code, "authentication_failed");
  assert.equal(JSON.stringify(rejection.problem).includes("invalid-signature-secret-token"), false);
  assert.equal(JSON.stringify(rejection.problem).includes("signature invalid"), false);
});

// TC-002-02-02 - MFA, expiry and revocation behavior -----------------------------------------

test("TC-002-02-02 MFA policy and expiration are enforced", async () => {
  const { verifier, authenticator } = fixture();
  verifier.values.set("no-mfa", claims({ authenticationMethods: Object.freeze(["password"]) }));
  verifier.values.set("expired", claims({ credentialId: "credential_2", expiresAt: "2026-09-24T11:50:00.000Z" }));

  await assert.rejects(
    authenticator.authenticateInteractive({ providerId: oidcPolicy.id, rawCredential: "no-mfa", requiredAudience: "sintius-admin", correlationId: "corr_mfa" }),
    isProblem("authentication_assurance_insufficient"),
  );
  await assert.rejects(
    authenticator.authenticateInteractive({ providerId: oidcPolicy.id, rawCredential: "expired", requiredAudience: "sintius-admin", correlationId: "corr_expired" }),
    isProblem("authentication_failed"),
  );
});

test("TC-002-02-02 revocation denies the next request without exposing credential contents", async () => {
  const { verifier, credentialStatus, authenticator } = fixture();
  verifier.values.set("revocable-secret-token", claims());
  await authenticator.authenticateInteractive({
    providerId: oidcPolicy.id,
    rawCredential: "revocable-secret-token",
    requiredAudience: "sintius-admin",
    correlationId: "corr_before_revoke",
  });
  credentialStatus.revoked.add("credential_1");
  const rejection = await authenticator
    .authenticateInteractive({
      providerId: oidcPolicy.id,
      rawCredential: "revocable-secret-token",
      requiredAudience: "sintius-admin",
      correlationId: "corr_after_revoke",
    })
    .catch((error: unknown) => error);
  assert.ok(rejection instanceof PlatformProblem);
  assert.equal(rejection.problem.code, "authentication_failed");
  assert.equal(JSON.stringify(rejection.problem).includes("revocable-secret-token"), false);
});

// TC-002-04-01 - Workload audience and scope enforcement -------------------------------------

test("TC-002-04-01 workload credentials are tenant-bound and down-scoped to required operations", async () => {
  const { verifier, authenticator } = fixture();
  verifier.values.set(
    "valid-workload",
    claims({
      mechanism: "workload_token",
      credentialId: "workload_credential_1",
      subject: "rating_worker",
      issuer: workloadPolicy.issuer,
      audiences: Object.freeze(["rating-worker"]),
      authenticationMethods: Object.freeze([]),
      scopes: Object.freeze(["usage:read", "rating:write"]),
    }),
  );
  const principal = await authenticator.authenticateWorkload({
    providerId: workloadPolicy.id,
    rawCredential: "valid-workload",
    requiredAudience: "rating-worker",
    requiredScopes: Object.freeze(["usage:read"]),
    correlationId: "corr_workload",
  });

  assert.equal(principal.kind, "workload");
  assert.equal(principal.assurance, "workload");
  assert.deepEqual(principal.tenantMemberships, [tenantA]);
  assert.deepEqual(principal.audiences, ["rating-worker"]);
  assert.deepEqual(principal.scopes, ["usage:read"]);

  const context = resolveTenantContext({
    principal,
    selectedTenantId: tenantA,
    tenantState: "ACTIVE",
    correlationId: "corr_workload",
  });
  assert.deepEqual(context.scopes, ["usage:read"]);
  assert.deepEqual(context.audiences, ["rating-worker"]);
  assert.equal(context.credentialId, "workload_credential_1");
});

test("TC-002-04-01 wrong audience, missing scope, excessive scope and multiple tenants are denied", async () => {
  const variants: ReadonlyArray<readonly [string, VerifiedCredentialClaims, string, readonly string[], string]> = [
    ["wrong-audience", claims({ mechanism: "workload_token", issuer: workloadPolicy.issuer, audiences: ["other"], scopes: ["usage:read"] }), "rating-worker", ["usage:read"], "authentication_failed"],
    ["missing-scope", claims({ mechanism: "workload_token", issuer: workloadPolicy.issuer, audiences: ["rating-worker"], scopes: ["usage:read"] }), "rating-worker", ["rating:write"], "workload_scope_denied"],
    ["excessive-scope", claims({ mechanism: "workload_token", issuer: workloadPolicy.issuer, audiences: ["rating-worker"], scopes: ["usage:read", "tenant:admin"] }), "rating-worker", ["usage:read"], "workload_scope_denied"],
    ["multiple-tenants", claims({ mechanism: "workload_token", issuer: workloadPolicy.issuer, audiences: ["rating-worker"], tenantIds: [tenantA, tenantB], scopes: ["usage:read"] }), "rating-worker", ["usage:read"], "workload_scope_denied"],
  ];
  for (const [rawCredential, value, requiredAudience, requiredScopes, expectedCode] of variants) {
    const { verifier, authenticator } = fixture();
    verifier.values.set(rawCredential, value);
    await assert.rejects(
      authenticator.authenticateWorkload({
        providerId: workloadPolicy.id,
        rawCredential,
        requiredAudience,
        requiredScopes,
        correlationId: `corr_${rawCredential}`,
      }),
      isProblem(expectedCode),
    );
  }
});

test("TC-002-04-01 nested workload contexts cannot replace their authenticated scope", async () => {
  const { verifier, authenticator } = fixture();
  verifier.values.set(
    "multi-scope-workload",
    claims({
      mechanism: "workload_token",
      credentialId: "workload_credential_2",
      subject: "rating_worker",
      issuer: workloadPolicy.issuer,
      audiences: Object.freeze(["rating-worker"]),
      authenticationMethods: Object.freeze([]),
      scopes: Object.freeze(["usage:read", "rating:write"]),
    }),
  );

  const readPrincipal = await authenticator.authenticateWorkload({
    providerId: workloadPolicy.id,
    rawCredential: "multi-scope-workload",
    requiredAudience: "rating-worker",
    requiredScopes: Object.freeze(["usage:read"]),
    correlationId: "corr_scope_lock",
  });
  const writePrincipal = await authenticator.authenticateWorkload({
    providerId: workloadPolicy.id,
    rawCredential: "multi-scope-workload",
    requiredAudience: "rating-worker",
    requiredScopes: Object.freeze(["rating:write"]),
    correlationId: "corr_scope_lock",
  });
  const readContext = resolveTenantContext({ principal: readPrincipal, selectedTenantId: tenantA, tenantState: "ACTIVE", correlationId: "corr_scope_lock" });
  const writeContext = resolveTenantContext({ principal: writePrincipal, selectedTenantId: tenantA, tenantState: "ACTIVE", correlationId: "corr_scope_lock" });

  await assert.rejects(
    async () => runWithTenantContext(readContext, () => runWithTenantContext(writeContext, async () => undefined)),
    isProblem("tenant_context_mismatch"),
  );
});

// TC-002-04-02 - Workload/interactive identity separation -----------------------------------

test("TC-002-04-02 workload credentials cannot create interactive sessions and user credentials cannot impersonate workers", async () => {
  const { verifier, authenticator } = fixture();
  verifier.values.set("workload", claims({ mechanism: "workload_token", issuer: workloadPolicy.issuer, audiences: ["rating-worker"], scopes: ["usage:read"] }));
  verifier.values.set("interactive", claims());

  await assert.rejects(
    authenticator.authenticateInteractive({ providerId: workloadPolicy.id, rawCredential: "workload", requiredAudience: "rating-worker", correlationId: "corr_1" }),
    isProblem("authentication_failed"),
  );
  await assert.rejects(
    authenticator.authenticateWorkload({ providerId: oidcPolicy.id, rawCredential: "interactive", requiredAudience: "sintius-admin", requiredScopes: ["usage:read"], correlationId: "corr_2" }),
    isProblem("authentication_failed"),
  );
});

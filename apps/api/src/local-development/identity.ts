import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { IdentityProviderPolicy } from "../../../../modules/identity-tenant/application/authentication-ports.ts";
import { PLATFORM_AUDIENCE } from "../../../../modules/identity-tenant/domain/platform-access.ts";
import { createJwtCredentialVerifier, localKeySet } from "../../../../modules/identity-tenant/infrastructure/jose/jwt-verifier.ts";

/**
 * LOCAL DEVELOPMENT ONLY. This module exists so `npm start` and `npm run demo:exit` can run
 * end-to-end without a real identity provider: it generates a fresh, in-memory asymmetric signing
 * key pair on every boot and signs test tokens with it. It never reads or writes a secret, and the
 * private key never leaves the process. `composeApiFromEnvironment` (../main.ts) only reaches this
 * module when `SINTIUS_TENANT_JWKS_URL`/`SINTIUS_PLATFORM_JWKS_URL` are unset — the moment a real
 * provider is configured, this module is not imported into the running server at all. Do not adapt
 * this for a deployed environment: choose a real identity-provider product instead (decision D11's
 * open item, docs/implementation/persona-permission-matrix.md and HANDOVER_PROMPT_CODEX.md §5.2).
 */

const TENANT_ISSUER = "https://local-development.sintius.invalid/tenant";
const PLATFORM_ISSUER = "https://local-development.sintius.invalid/platform";
const TENANT_AUDIENCE = "sintius-api";

export interface LocalDevelopmentIdentityProvider {
  readonly tenantPolicy: Readonly<IdentityProviderPolicy>;
  readonly platformPolicy: Readonly<IdentityProviderPolicy>;
  readonly verifier: ReturnType<typeof createJwtCredentialVerifier>;
  mintTenantUserToken(input: { readonly subject: string; readonly tenantIds: readonly string[]; readonly ttlSeconds?: number }): Promise<string>;
  mintPlatformOperatorToken(input: { readonly subject: string; readonly roles: readonly string[]; readonly ttlSeconds?: number }): Promise<string>;
}

/** A local-only policy id, distinguishable at a glance from a real provider's configured id. */
const TENANT_PROVIDER_ID = "local-development-tenant";
const PLATFORM_PROVIDER_ID = "local-development-platform";

export async function createLocalDevelopmentIdentityProvider(): Promise<LocalDevelopmentIdentityProvider> {
  const [tenantKeys, platformKeys] = await Promise.all([generateKeyPair("ES256", { extractable: true }), generateKeyPair("ES256", { extractable: true })]);
  const tenantJwk = { ...(await exportJWK(tenantKeys.publicKey)), kid: "local-dev-tenant-1", alg: "ES256", use: "sig" };
  const platformJwk = { ...(await exportJWK(platformKeys.publicKey)), kid: "local-dev-platform-1", alg: "ES256", use: "sig" };

  const tenantPolicy: IdentityProviderPolicy = Object.freeze({
    id: TENANT_PROVIDER_ID,
    mechanism: "oidc",
    issuer: TENANT_ISSUER,
    allowedAudiences: Object.freeze([TENANT_AUDIENCE]),
    clockSkewSeconds: 30,
    requireMfa: true,
    allowedWorkloadScopes: Object.freeze([]),
  });
  const platformPolicy: IdentityProviderPolicy = Object.freeze({
    id: PLATFORM_PROVIDER_ID,
    mechanism: "oidc",
    issuer: PLATFORM_ISSUER,
    allowedAudiences: Object.freeze([PLATFORM_AUDIENCE]),
    clockSkewSeconds: 30,
    requireMfa: true,
    allowedWorkloadScopes: Object.freeze([]),
  });

  const verifier = createJwtCredentialVerifier({
    providers: {
      [TENANT_PROVIDER_ID]: { keys: localKeySet({ keys: [tenantJwk] }) },
      [PLATFORM_PROVIDER_ID]: { keys: localKeySet({ keys: [platformJwk] }) },
    },
  });

  let jti = 0;
  const sign = async (key: typeof tenantKeys.privateKey, kid: string, issuer: string, audience: string, subject: string, ttlSeconds: number, claims: Record<string, unknown>) => {
    const now = Number(BigInt(Date.now()) / 1000n);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setJti(`local-dev-${++jti}`)
      .setIssuedAt(now)
      .setExpirationTime(now + ttlSeconds)
      .sign(key);
  };

  return {
    tenantPolicy,
    platformPolicy,
    verifier,
    mintTenantUserToken: ({ subject, tenantIds, ttlSeconds = 3600 }) =>
      sign(tenantKeys.privateKey, "local-dev-tenant-1", TENANT_ISSUER, TENANT_AUDIENCE, subject, ttlSeconds, { amr: ["pwd", "mfa"], sintius_tenants: tenantIds }),
    mintPlatformOperatorToken: ({ subject, roles, ttlSeconds = 3600 }) =>
      sign(platformKeys.privateKey, "local-dev-platform-1", PLATFORM_ISSUER, PLATFORM_AUDIENCE, subject, ttlSeconds, { amr: ["pwd", "mfa"], sintius_platform_roles: roles }),
  };
}

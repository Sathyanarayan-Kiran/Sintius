import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { tenantId } from "../../../../platform/tenant-context/src/index.ts";
import type { CredentialVerifier, IdentityProviderPolicy, VerifiedCredentialClaims } from "../../application/authentication-ports.ts";

/**
 * JWT verification with `jose` (decision D8) for OIDC access tokens, platform-operator tokens and
 * signed workload tokens. SAML is federated through the identity provider, so SAML policies are
 * refused here. This adapter proves the signature (against the provider's keys, with rotation), the
 * algorithm, issuer, audience, lifetime and token age, and maps claims to the provider-neutral
 * shape. The authentication service then re-validates every claim that affects authority.
 */

/** Asymmetric algorithms only: a shared-secret (HS*) or unsigned (`none`) token is never accepted. */
export const DEFAULT_ALGORITHMS = Object.freeze(["RS256", "PS256", "ES256", "EdDSA"]);

export interface JwtProviderKeys {
  /** The provider's signing keys; see `remoteKeySet` and `localKeySet`. */
  readonly keys: JWTVerifyGetKey;
  /** Defaults to DEFAULT_ALGORITHMS; symmetric algorithms are rejected at construction. */
  readonly algorithms?: readonly string[];
  /** Claim holding the principal's tenant memberships (default `sintius_tenants`). */
  readonly tenantClaim?: string;
  /** Claim holding platform roles on platform-operator tokens (default `sintius_platform_roles`). */
  readonly platformRoleClaim?: string;
  /** Oldest acceptable `iat`, bounding a token's usable life even if `exp` is far away (default 1 hour). */
  readonly maxTokenAgeSeconds?: number;
  /** Required JOSE `typ` header, for example `at+jwt` for RFC 9068 access tokens. */
  readonly type?: string;
}

/**
 * The provider's published key set (JWKS). Keys are cached; a token signed with an unknown `kid`
 * triggers a refetch (at most once per cooldown), which is how signing-key rotation is picked up.
 */
export function remoteKeySet(url: string, options: { readonly cooldownSeconds?: number; readonly cacheMaxAgeSeconds?: number; readonly timeoutMilliseconds?: number } = {}): JWTVerifyGetKey {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))) {
    throw new TypeError("A JWKS URL must use https (plain http is allowed only on loopback for local development).");
  }
  return createRemoteJWKSet(parsed, {
    cooldownDuration: (options.cooldownSeconds ?? 30) * 1_000,
    cacheMaxAge: (options.cacheMaxAgeSeconds ?? 600) * 1_000,
    timeoutDuration: options.timeoutMilliseconds ?? 5_000,
  });
}

/** A fixed key set, for tests and for providers that distribute keys out of band. */
export function localKeySet(jwks: JSONWebKeySet): JWTVerifyGetKey {
  return createLocalJWKSet(jwks);
}

function stringArray(value: unknown, claim: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new TypeError(`Claim ${claim} must be an array of strings.`);
  return value as string[];
}

function scopesOf(payload: JWTPayload): readonly string[] {
  if (typeof payload.scope === "string") return payload.scope.split(" ").filter((scope) => scope.length > 0);
  return stringArray(payload.scp, "scp");
}

function instant(seconds: number | undefined): string | undefined {
  return seconds === undefined ? undefined : new Date(seconds * 1_000).toISOString();
}

export function createJwtCredentialVerifier(options: {
  readonly providers: Readonly<Record<string, JwtProviderKeys>>;
  /** Defaults to the system clock; injected so verification agrees with the authentication service. */
  readonly clock?: () => Date;
}): CredentialVerifier {
  for (const [id, provider] of Object.entries(options.providers)) {
    for (const algorithm of provider.algorithms ?? DEFAULT_ALGORITHMS) {
      if (!DEFAULT_ALGORITHMS.includes(algorithm) && !/^(RS|PS|ES)(256|384|512)$/.test(algorithm)) {
        throw new TypeError(`Provider ${id}: algorithm ${algorithm} is not an allowed asymmetric algorithm.`);
      }
    }
  }

  return Object.freeze({
    async verify(rawCredential: string, policy: Readonly<IdentityProviderPolicy>): Promise<Readonly<VerifiedCredentialClaims>> {
      if (policy.mechanism === "saml") throw new Error("SAML is federated through the identity provider (D8).");
      const provider = Object.hasOwn(options.providers, policy.id) ? options.providers[policy.id] : undefined;
      if (provider === undefined) throw new Error("No signing keys are configured for this provider.");

      const { payload } = await jwtVerify(rawCredential, provider.keys, {
        algorithms: [...(provider.algorithms ?? DEFAULT_ALGORITHMS)],
        issuer: policy.issuer,
        audience: [...policy.allowedAudiences],
        clockTolerance: policy.clockSkewSeconds,
        currentDate: (options.clock ?? (() => new Date()))(),
        maxTokenAge: provider.maxTokenAgeSeconds ?? 3_600,
        requiredClaims: ["iss", "sub", "aud", "exp", "iat", "jti"],
        ...(provider.type === undefined ? {} : { typ: provider.type }),
      });

      const tenants = stringArray(payload[provider.tenantClaim ?? "sintius_tenants"], "tenant memberships");
      const methods = stringArray(payload.amr, "amr");
      const roles = stringArray(payload[provider.platformRoleClaim ?? "sintius_platform_roles"], "platform roles");
      const notBefore = instant(payload.nbf);
      return Object.freeze({
        mechanism: policy.mechanism,
        credentialId: String(payload.jti),
        subject: String(payload.sub),
        issuer: String(payload.iss),
        audiences: Object.freeze(Array.isArray(payload.aud) ? [...payload.aud] : [String(payload.aud)]),
        tenantIds: Object.freeze(tenants.map((value) => tenantId(value))),
        authenticationMethods: Object.freeze([...methods]),
        scopes: Object.freeze([...scopesOf(payload)]),
        expiresAt: instant(payload.exp)!,
        ...(notBefore === undefined ? {} : { notBefore }),
        ...(roles.length === 0 ? {} : { platformRoles: Object.freeze([...roles]) }),
      });
    },
  });
}

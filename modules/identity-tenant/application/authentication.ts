import { problem } from "../../../platform/problem-model/src/index.ts";
import {
  actorId,
  issueAuthenticatedPrincipal,
  tenantId,
  type AuthenticatedPrincipal,
  type TenantId,
} from "../../../platform/tenant-context/src/index.ts";
import type {
  AuthenticationMechanism,
  CredentialStatusStore,
  CredentialVerifier,
  IdentityProviderPolicy,
  IdentityProviderPolicyStore,
  VerifiedCredentialClaims,
} from "./authentication-ports.ts";

export interface AuthenticatedSessionPrincipal extends AuthenticatedPrincipal {
  readonly credentialId: string;
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly scopes: readonly string[];
  readonly expiresAt: string;
}

export interface AuthenticationDependencies {
  readonly policies: IdentityProviderPolicyStore;
  readonly verifier: CredentialVerifier;
  readonly credentialStatus: CredentialStatusStore;
  readonly clock: () => Date;
}

export interface InteractiveAuthenticationInput {
  readonly providerId: string;
  readonly rawCredential: string;
  readonly requiredAudience: string;
  readonly correlationId: string;
}

export interface WorkloadAuthenticationInput extends InteractiveAuthenticationInput {
  readonly requiredScopes: readonly string[];
}

function frozenUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function authenticationFailed(correlationId: string): never {
  throw problem({
    code: "authentication_failed",
    detail: "The supplied credential could not be authenticated.",
    correlation_id: correlationId,
  });
}

function assuranceInsufficient(correlationId: string): never {
  throw problem({
    code: "authentication_assurance_insufficient",
    detail: "The credential does not meet the required authentication assurance.",
    correlation_id: correlationId,
  });
}

function workloadScopeDenied(correlationId: string): never {
  throw problem({
    code: "workload_scope_denied",
    detail: "The workload credential is not valid for the required audience and operations.",
    correlation_id: correlationId,
  });
}

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function hasOnlyNonBlank(values: readonly string[]): boolean {
  return values.every(isNonBlank);
}

function parseInstant(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function validateBaseClaims(
  claims: Readonly<VerifiedCredentialClaims>,
  policy: Readonly<IdentityProviderPolicy>,
  requiredAudience: string,
  now: Date,
  correlationId: string,
): void {
  const expiry = parseInstant(claims.expiresAt);
  const notBefore = claims.notBefore === undefined ? undefined : parseInstant(claims.notBefore);
  const skewMilliseconds = policy.clockSkewSeconds * 1_000;
  if (
    claims.mechanism !== policy.mechanism ||
    claims.issuer !== policy.issuer ||
    !isNonBlank(claims.credentialId) ||
    !isNonBlank(claims.subject) ||
    !isNonBlank(requiredAudience) ||
    !hasOnlyNonBlank(claims.audiences) ||
    !policy.allowedAudiences.includes(requiredAudience) ||
    !claims.audiences.includes(requiredAudience) ||
    expiry === undefined ||
    expiry <= now.valueOf() - skewMilliseconds ||
    (claims.notBefore !== undefined && (notBefore === undefined || notBefore > now.valueOf() + skewMilliseconds))
  ) {
    authenticationFailed(correlationId);
  }
}

function normalizedTenants(claims: Readonly<VerifiedCredentialClaims>, correlationId: string): readonly TenantId[] {
  try {
    const values = frozenUnique(claims.tenantIds.map((value) => tenantId(value)));
    if (values.length === 0) authenticationFailed(correlationId);
    return values as readonly TenantId[];
  } catch {
    authenticationFailed(correlationId);
  }
}

/**
 * Provider-neutral authentication policy. Cryptographic validation is delegated to a narrow port;
 * every claim that affects authority is re-validated here before a principal is issued.
 */
export function createAuthenticator(dependencies: AuthenticationDependencies) {
  async function verify(
    input: InteractiveAuthenticationInput,
    expectedMechanisms: readonly AuthenticationMechanism[],
  ): Promise<{ readonly policy: Readonly<IdentityProviderPolicy>; readonly claims: Readonly<VerifiedCredentialClaims> }> {
    if (!isNonBlank(input.providerId) || !isNonBlank(input.rawCredential)) authenticationFailed(input.correlationId);
    const policy = await dependencies.policies.findById(input.providerId);
    if (policy === undefined || !expectedMechanisms.includes(policy.mechanism)) authenticationFailed(input.correlationId);

    let claims: Readonly<VerifiedCredentialClaims>;
    try {
      claims = await dependencies.verifier.verify(input.rawCredential, policy);
    } catch {
      // Never expose signature-library errors, token contents or provider metadata.
      authenticationFailed(input.correlationId);
    }
    validateBaseClaims(claims, policy, input.requiredAudience, dependencies.clock(), input.correlationId);
    if (await dependencies.credentialStatus.isRevoked(claims.credentialId)) authenticationFailed(input.correlationId);
    return { policy, claims };
  }

  async function authenticateInteractive(input: InteractiveAuthenticationInput): Promise<Readonly<AuthenticatedSessionPrincipal>> {
    const { policy, claims } = await verify(input, ["oidc", "saml"]);
    if (policy.requireMfa && !claims.authenticationMethods.includes("mfa")) assuranceInsufficient(input.correlationId);
    const memberships = normalizedTenants(claims, input.correlationId);
    return issueAuthenticatedPrincipal({
      actorId: actorId(claims.subject),
      kind: "interactive" as const,
      tenantMemberships: memberships,
      assurance: claims.authenticationMethods.includes("mfa") ? ("mfa" as const) : ("single-factor" as const),
      credentialId: claims.credentialId,
      issuer: claims.issuer,
      audiences: Object.freeze([input.requiredAudience]),
      scopes: Object.freeze([]),
      expiresAt: claims.expiresAt,
    });
  }

  async function authenticateWorkload(input: WorkloadAuthenticationInput): Promise<Readonly<AuthenticatedSessionPrincipal>> {
    const { policy, claims } = await verify(input, ["workload_token"]);
    const memberships = normalizedTenants(claims, input.correlationId);
    const requiredScopes = frozenUnique(input.requiredScopes);
    if (
      memberships.length !== 1 ||
      requiredScopes.length === 0 ||
      !hasOnlyNonBlank(requiredScopes) ||
      !hasOnlyNonBlank(claims.scopes) ||
      claims.scopes.some((scope) => !policy.allowedWorkloadScopes.includes(scope)) ||
      requiredScopes.some((scope) => !policy.allowedWorkloadScopes.includes(scope) || !claims.scopes.includes(scope))
    ) {
      workloadScopeDenied(input.correlationId);
    }
    return issueAuthenticatedPrincipal({
      actorId: actorId(claims.subject),
      kind: "workload" as const,
      tenantMemberships: memberships,
      assurance: "workload" as const,
      credentialId: claims.credentialId,
      issuer: claims.issuer,
      audiences: Object.freeze([input.requiredAudience]),
      // Down-scope to the operations required by this worker invocation.
      scopes: requiredScopes,
      expiresAt: claims.expiresAt,
    });
  }

  return Object.freeze({ authenticateInteractive, authenticateWorkload });
}

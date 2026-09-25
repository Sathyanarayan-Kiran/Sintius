import { telemetryMetrics } from "../../../platform/observability/src/index.ts";
import { problem } from "../../../platform/problem-model/src/index.ts";
import {
  actorId,
  issueAuthenticatedPrincipal,
  tenantId,
  type AuthenticatedPrincipal,
  type TenantId,
} from "../../../platform/tenant-context/src/index.ts";
import { PLATFORM_AUDIENCE, platformPermissionsFor } from "../domain/platform-access.ts";
import type {
  AuthenticationFactSink,
  AuthenticationFailureReason,
  AuthenticationKind,
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
  /** Receives a security fact for every attempt; sink failures never change the outcome. */
  readonly facts?: AuthenticationFactSink;
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

export type PlatformAuthenticationInput = Omit<InteractiveAuthenticationInput, "requiredAudience">;

type RejectionCode = "authentication_failed" | "authentication_assurance_insufficient" | "workload_scope_denied";

const DETAIL: Readonly<Record<RejectionCode, string>> = Object.freeze({
  authentication_failed: "The supplied credential could not be authenticated.",
  authentication_assurance_insufficient: "The credential does not meet the required authentication assurance.",
  workload_scope_denied: "The workload credential is not valid for the required audience and operations.",
});

/** An expected refusal. The reason is recorded as a security fact; callers see only the generic problem. */
class Rejection {
  readonly reason: AuthenticationFailureReason;
  readonly code: RejectionCode;
  constructor(reason: AuthenticationFailureReason, code: RejectionCode = "authentication_failed") {
    this.reason = reason;
    this.code = code;
  }
}

function reject(reason: AuthenticationFailureReason, code?: RejectionCode): never {
  throw new Rejection(reason, code);
}

function frozenUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
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

function validateBaseClaims(claims: Readonly<VerifiedCredentialClaims>, policy: Readonly<IdentityProviderPolicy>, requiredAudience: string, now: Date): void {
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
    reject("claims_invalid");
  }
}

function normalizedTenants(claims: Readonly<VerifiedCredentialClaims>): readonly TenantId[] {
  let values: readonly string[];
  try {
    values = frozenUnique(claims.tenantIds.map((value) => tenantId(value)));
  } catch {
    reject("claims_invalid");
  }
  if (values.length === 0) reject("no_tenant_membership");
  return values as readonly TenantId[];
}

/**
 * Provider-neutral authentication policy. Cryptographic validation is delegated to a narrow port;
 * every claim that affects authority is re-validated here before a principal is issued. Tenant
 * users, workloads and platform operators are separate entry points with separate audiences, and a
 * credential accepted by one is never accepted by another.
 */
export function createAuthenticator(dependencies: AuthenticationDependencies) {
  function record(
    kind: AuthenticationKind,
    input: { readonly providerId: string; readonly correlationId: string },
    outcome: { readonly reason?: AuthenticationFailureReason; readonly claims?: Readonly<VerifiedCredentialClaims> },
  ): void {
    const providerId = isNonBlank(input.providerId) ? input.providerId : "unspecified";
    telemetryMetrics.authentication(kind, outcome.reason === undefined ? "succeeded" : "failed", outcome.reason ?? "none", providerId);
    if (dependencies.facts === undefined) return;
    try {
      dependencies.facts.record(
        Object.freeze({
          kind,
          outcome: outcome.reason === undefined ? ("succeeded" as const) : ("failed" as const),
          ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
          providerId,
          ...(outcome.claims === undefined
            ? {}
            : { mechanism: outcome.claims.mechanism, actorId: outcome.claims.subject, credentialId: outcome.claims.credentialId }),
          correlationId: input.correlationId,
          occurredAt: dependencies.clock().toISOString(),
        }),
      );
    } catch {
      // A failing fact sink must not turn a valid login into a failure or a failure into a success.
    }
  }

  /** Runs one attempt: records its fact and turns an expected refusal into the generic problem. */
  async function attempt<T>(
    kind: AuthenticationKind,
    input: { readonly providerId: string; readonly correlationId: string },
    work: (verified: (claims: Readonly<VerifiedCredentialClaims>) => void) => Promise<T>,
  ): Promise<T> {
    let claims: Readonly<VerifiedCredentialClaims> | undefined;
    try {
      const result = await work((value) => {
        claims = value;
      });
      record(kind, input, { ...(claims === undefined ? {} : { claims }) });
      return result;
    } catch (error) {
      const reason = error instanceof Rejection ? error.reason : "error";
      record(kind, input, { reason, ...(claims === undefined ? {} : { claims }) });
      if (error instanceof Rejection) throw problem({ code: error.code, detail: DETAIL[error.code], correlation_id: input.correlationId });
      throw error;
    }
  }

  async function verify(
    input: InteractiveAuthenticationInput,
    expectedMechanisms: readonly AuthenticationMechanism[],
    verified: (claims: Readonly<VerifiedCredentialClaims>) => void,
  ): Promise<{ readonly policy: Readonly<IdentityProviderPolicy>; readonly claims: Readonly<VerifiedCredentialClaims> }> {
    if (!isNonBlank(input.providerId) || !isNonBlank(input.rawCredential)) reject("malformed_request");
    const policy = await dependencies.policies.findById(input.providerId);
    if (policy === undefined || !expectedMechanisms.includes(policy.mechanism)) reject("unknown_provider");

    let claims: Readonly<VerifiedCredentialClaims>;
    try {
      claims = await dependencies.verifier.verify(input.rawCredential, policy);
    } catch {
      // Never expose signature-library errors, token contents or provider metadata.
      reject("credential_invalid");
    }
    verified(claims);
    validateBaseClaims(claims, policy, input.requiredAudience, dependencies.clock());
    if (await dependencies.credentialStatus.isRevoked({ issuer: claims.issuer, credentialId: claims.credentialId })) reject("revoked");
    return { policy, claims };
  }

  function authenticateInteractive(input: InteractiveAuthenticationInput): Promise<Readonly<AuthenticatedSessionPrincipal>> {
    return attempt("interactive", input, async (verified) => {
      // The platform audience has its own entry point; a tenant session can never be minted for it.
      if (input.requiredAudience === PLATFORM_AUDIENCE) reject("claims_invalid");
      const { policy, claims } = await verify(input, ["oidc", "saml"], verified);
      if (policy.requireMfa && !claims.authenticationMethods.includes("mfa")) reject("mfa_required", "authentication_assurance_insufficient");
      const memberships = normalizedTenants(claims);
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
    });
  }

  function authenticateWorkload(input: WorkloadAuthenticationInput): Promise<Readonly<AuthenticatedSessionPrincipal>> {
    return attempt("workload", input, async (verified) => {
      if (input.requiredAudience === PLATFORM_AUDIENCE) reject("claims_invalid");
      const { policy, claims } = await verify(input, ["workload_token"], verified);
      const memberships = normalizedTenants(claims);
      const requiredScopes = frozenUnique(input.requiredScopes);
      if (
        memberships.length !== 1 ||
        requiredScopes.length === 0 ||
        !hasOnlyNonBlank(requiredScopes) ||
        !hasOnlyNonBlank(claims.scopes) ||
        claims.scopes.some((scope) => !policy.allowedWorkloadScopes.includes(scope)) ||
        requiredScopes.some((scope) => !policy.allowedWorkloadScopes.includes(scope) || !claims.scopes.includes(scope))
      ) {
        reject("scope_denied", "workload_scope_denied");
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
    });
  }

  /**
   * Platform operators (decision D11): the platform audience only, no tenant memberships, MFA
   * always, and platform permissions derived from reviewed roles. The resulting principal cannot
   * enter any tenant, because tenant context requires a membership.
   */
  function authenticatePlatformOperator(input: PlatformAuthenticationInput): Promise<Readonly<AuthenticatedSessionPrincipal>> {
    return attempt("platform", input, async (verified) => {
      const { claims } = await verify({ ...input, requiredAudience: PLATFORM_AUDIENCE }, ["oidc", "saml"], verified);
      if (claims.tenantIds.length > 0) reject("tenant_claims_on_platform_token");
      if (!claims.authenticationMethods.includes("mfa")) reject("mfa_required", "authentication_assurance_insufficient");
      const roles = claims.platformRoles ?? [];
      if (!hasOnlyNonBlank(roles)) reject("claims_invalid");
      return issueAuthenticatedPrincipal({
        actorId: actorId(claims.subject),
        kind: "interactive" as const,
        tenantMemberships: [],
        assurance: "mfa" as const,
        credentialId: claims.credentialId,
        issuer: claims.issuer,
        audiences: Object.freeze([PLATFORM_AUDIENCE]),
        scopes: platformPermissionsFor(roles),
        expiresAt: claims.expiresAt,
      });
    });
  }

  return Object.freeze({ authenticateInteractive, authenticateWorkload, authenticatePlatformOperator });
}

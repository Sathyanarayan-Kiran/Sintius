import type { TenantId } from "../../../platform/tenant-context/src/index.ts";

export type AuthenticationMechanism = "oidc" | "saml" | "workload_token";

/** Tenant-owned identity-provider policy. Secrets and signing keys stay behind the verifier port. */
export interface IdentityProviderPolicy {
  readonly id: string;
  readonly mechanism: AuthenticationMechanism;
  readonly issuer: string;
  readonly allowedAudiences: readonly string[];
  readonly clockSkewSeconds: number;
  readonly requireMfa: boolean;
  readonly allowedWorkloadScopes: readonly string[];
}

export interface IdentityProviderPolicyStore {
  findById(id: string): Promise<Readonly<IdentityProviderPolicy> | undefined>;
}

/**
 * Output of a cryptographic adapter after signature/key/certificate validation. OIDC, SAML and
 * workload-token parsing belongs in adapters; application code consumes this provider-neutral
 * shape and independently enforces issuer, audience, lifetime, assurance and tenant scope.
 */
export interface VerifiedCredentialClaims {
  readonly mechanism: AuthenticationMechanism;
  readonly credentialId: string;
  readonly subject: string;
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly tenantIds: readonly TenantId[];
  readonly authenticationMethods: readonly string[];
  readonly scopes: readonly string[];
  readonly expiresAt: string;
  readonly notBefore?: string;
  /** Platform roles asserted by the platform identity provider (decision D11); ignored for tenant sessions. */
  readonly platformRoles?: readonly string[];
}

export interface CredentialVerifier {
  /** Rejects if the signature, key/certificate chain or credential encoding is invalid. */
  verify(rawCredential: string, policy: Readonly<IdentityProviderPolicy>): Promise<Readonly<VerifiedCredentialClaims>>;
}

export interface CredentialStatusStore {
  /** Checked on every authentication so revocation affects the next request. Token IDs are unique per issuer. */
  isRevoked(credential: { readonly issuer: string; readonly credentialId: string }): Promise<boolean>;
}

export type AuthenticationKind = "interactive" | "workload" | "platform";

/** Why an authentication failed, as a low-cardinality class. Never the token or the library error. */
export type AuthenticationFailureReason =
  | "malformed_request"
  | "unknown_provider"
  | "credential_invalid"
  | "claims_invalid"
  | "revoked"
  | "mfa_required"
  | "no_tenant_membership"
  | "tenant_claims_on_platform_token"
  | "scope_denied"
  | "error";

/**
 * A security fact for one authentication attempt (P0-004). It identifies the provider, the class of
 * outcome and, once the signature has been verified, the subject and token ID. It never carries the
 * credential itself, its claims or a verifier error message.
 */
export interface AuthenticationFact {
  readonly kind: AuthenticationKind;
  readonly outcome: "succeeded" | "failed";
  readonly reason?: AuthenticationFailureReason;
  readonly providerId: string;
  readonly mechanism?: AuthenticationMechanism;
  readonly actorId?: string;
  readonly credentialId?: string;
  readonly correlationId: string;
  readonly occurredAt: string;
}

export interface AuthenticationFactSink {
  record(fact: Readonly<AuthenticationFact>): void;
}

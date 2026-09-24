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
}

export interface CredentialVerifier {
  /** Rejects if the signature, key/certificate chain or credential encoding is invalid. */
  verify(rawCredential: string, policy: Readonly<IdentityProviderPolicy>): Promise<Readonly<VerifiedCredentialClaims>>;
}

export interface CredentialStatusStore {
  /** Checked on every authentication so revocation affects the next request. */
  isRevoked(credentialId: string): Promise<boolean>;
}

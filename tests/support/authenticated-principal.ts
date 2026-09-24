import {
  issueAuthenticatedPrincipal,
  type AuthenticatedPrincipal,
  type TenantId,
} from "../../platform/tenant-context/src/index.ts";

export interface TestPrincipalOptions {
  readonly actor?: string;
  readonly kind?: AuthenticatedPrincipal["kind"];
  readonly assurance?: AuthenticatedPrincipal["assurance"];
  readonly credentialId?: string;
  readonly audiences?: readonly string[];
  readonly scopes?: readonly string[];
  readonly expiresAt?: string;
}

/** Test-only credential boundary. Production code must obtain principals from createAuthenticator. */
export function testPrincipal(
  tenantMemberships: readonly TenantId[],
  options: TestPrincipalOptions = {},
): Readonly<AuthenticatedPrincipal> {
  const kind = options.kind ?? "interactive";
  return issueAuthenticatedPrincipal({
    actorId: options.actor ?? "user_1",
    kind,
    tenantMemberships,
    assurance: options.assurance ?? (kind === "workload" ? "workload" : "mfa"),
    credentialId: options.credentialId ?? `test_credential_${options.actor ?? "user_1"}`,
    issuer: "https://identity.test.invalid",
    audiences: options.audiences ?? ["sintius-test"],
    scopes: options.scopes ?? [],
    expiresAt: options.expiresAt ?? "2099-01-01T00:00:00.000Z",
  });
}

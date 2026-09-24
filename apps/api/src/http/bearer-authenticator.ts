import { problem } from "../../../../platform/problem-model/src/index.ts";
import type { AuthenticatedPrincipal } from "../../../../platform/tenant-context/src/index.ts";
import type { RequestAuthenticator } from "./server.ts";

/** The subset of `createAuthenticator` the HTTP adapter needs. */
export interface CredentialAuthenticator {
  authenticateInteractive(input: {
    readonly providerId: string;
    readonly rawCredential: string;
    readonly requiredAudience: string;
    readonly correlationId: string;
  }): Promise<Readonly<AuthenticatedPrincipal>>;
}

const BEARER = /^Bearer[ \t]+([A-Za-z0-9\-._~+/]+=*)[ \t]*$/i;
const MAX_CREDENTIAL_LENGTH = 16 * 1024;

/**
 * `Authorization: Bearer <credential>` for one configured interactive identity provider and API
 * audience. Signature, issuer, audience, lifetime, MFA and revocation checks stay in the
 * authentication application service; this adapter only extracts the credential.
 */
export function createBearerAuthenticator(options: {
  readonly authenticator: CredentialAuthenticator;
  readonly providerId: string;
  readonly audience: string;
}): RequestAuthenticator {
  return {
    async authenticate({ authorization, correlationId }) {
      const match = authorization === undefined || authorization.length > MAX_CREDENTIAL_LENGTH ? null : BEARER.exec(authorization);
      if (match === null) {
        throw problem({ code: "authentication_failed", detail: "Authentication is required.", correlation_id: correlationId });
      }
      return options.authenticator.authenticateInteractive({
        providerId: options.providerId,
        rawCredential: match[1]!,
        requiredAudience: options.audience,
        correlationId,
      });
    },
  };
}

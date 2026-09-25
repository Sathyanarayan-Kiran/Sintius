import { createAuthenticator } from "../../../modules/identity-tenant/application/authentication.ts";
import type { IdentityProviderPolicy } from "../../../modules/identity-tenant/application/authentication-ports.ts";
import { PLATFORM_AUDIENCE } from "../../../modules/identity-tenant/domain/platform-access.ts";
import { createJwtCredentialVerifier, remoteKeySet } from "../../../modules/identity-tenant/infrastructure/jose/jwt-verifier.ts";
import { PostgresCredentialStatusStore } from "../../../modules/identity-tenant/infrastructure/postgres/credential-status.ts";
import { composePostgresApi } from "./composition/postgres.ts";
import { createBearerAuthenticator, createPlatformBearerAuthenticator } from "./http/bearer-authenticator.ts";
import { createLocalDevelopmentIdentityProvider } from "./local-development/identity.ts";

/**
 * `npm start`: the API ingress (apps/api/src/http/server.ts) composed on PostgreSQL
 * (apps/api/src/composition/postgres.ts), the same composition root the PostgreSQL test suite
 * exercises. It authenticates with `jose` against a real, configured identity provider when
 * `SINTIUS_TENANT_JWKS_URL` and `SINTIUS_PLATFORM_JWKS_URL` are set, or otherwise against a
 * clearly labelled, in-memory, LOCAL DEVELOPMENT ONLY key set generated fresh on every boot
 * (apps/api/src/local-development/identity.ts) — never a production credential.
 */

const TENANT_AUDIENCE = "sintius-api";

async function main(): Promise<void> {
  const port = Number(process.env["SINTIUS_PORT"] ?? "3000");
  const connectionString = process.env["SINTIUS_DATABASE_URL"];

  const configuredTenant = process.env["SINTIUS_TENANT_JWKS_URL"] !== undefined && process.env["SINTIUS_TENANT_ISSUER"] !== undefined;
  const configuredPlatform = process.env["SINTIUS_PLATFORM_JWKS_URL"] !== undefined && process.env["SINTIUS_PLATFORM_ISSUER"] !== undefined;

  let tenantPolicy: Readonly<IdentityProviderPolicy>;
  let platformPolicy: Readonly<IdentityProviderPolicy>;
  let verifier: ReturnType<typeof createJwtCredentialVerifier>;

  if (configuredTenant && configuredPlatform) {
    tenantPolicy = Object.freeze({
      id: "configured-tenant",
      mechanism: "oidc",
      issuer: process.env["SINTIUS_TENANT_ISSUER"]!,
      allowedAudiences: Object.freeze([TENANT_AUDIENCE]),
      clockSkewSeconds: 30,
      requireMfa: process.env["SINTIUS_TENANT_REQUIRE_MFA"] !== "false",
      allowedWorkloadScopes: Object.freeze([]),
    });
    platformPolicy = Object.freeze({
      id: "configured-platform",
      mechanism: "oidc",
      issuer: process.env["SINTIUS_PLATFORM_ISSUER"]!,
      allowedAudiences: Object.freeze([PLATFORM_AUDIENCE]),
      clockSkewSeconds: 30,
      requireMfa: true,
      allowedWorkloadScopes: Object.freeze([]),
    });
    verifier = createJwtCredentialVerifier({
      providers: {
        "configured-tenant": { keys: remoteKeySet(process.env["SINTIUS_TENANT_JWKS_URL"]!) },
        "configured-platform": { keys: remoteKeySet(process.env["SINTIUS_PLATFORM_JWKS_URL"]!) },
      },
    });
    console.log(`[sintius] configured identity providers: tenant issuer ${tenantPolicy.issuer}, platform issuer ${platformPolicy.issuer}`);
  } else {
    console.log("[sintius] SINTIUS_TENANT_JWKS_URL/SINTIUS_PLATFORM_JWKS_URL are not both set.");
    console.log("[sintius] LOCAL DEVELOPMENT KEY SET IN USE — fresh, in-memory, never a production credential. Do not use this outside local development.");
    const local = await createLocalDevelopmentIdentityProvider();
    tenantPolicy = local.tenantPolicy;
    platformPolicy = local.platformPolicy;
    verifier = local.verifier;
    const [operatorToken, userToken] = await Promise.all([
      local.mintPlatformOperatorToken({ subject: "local_operator", roles: ["platform_tenant_provisioner", "platform_tenant_lifecycle_operator"] }),
      local.mintTenantUserToken({ subject: "local_user", tenantIds: [] }),
    ]);
    console.log(`[sintius] example platform-operator bearer token (local development only):\n  ${operatorToken}`);
    console.log(`[sintius] example tenant bearer token, no memberships yet (local development only):\n  ${userToken}`);
    console.log(`[sintius] try: curl -X POST http://127.0.0.1:${port}/v1/platform/tenants -H "authorization: Bearer ${operatorToken}" -H "content-type: application/json" -H "idempotency-key: $(node -e "console.log(crypto.randomUUID())")" -d '{"tenant_id":"demo","display_name":"Demo","initial_administrator_actor_id":"demo_admin"}'`);
  }

  const authentication = createAuthenticator({
    policies: { findById: async (id) => [tenantPolicy, platformPolicy].find((policy) => policy.id === id) },
    verifier,
    credentialStatus: new PostgresCredentialStatusStore(connectionString === undefined ? {} : { connectionString }),
    clock: () => new Date(),
  });

  const api = composePostgresApi({
    authenticator: createBearerAuthenticator({ providerId: tenantPolicy.id, audience: TENANT_AUDIENCE, authenticator: authentication }),
    platformAuthenticator: createPlatformBearerAuthenticator({ providerId: platformPolicy.id, authenticator: authentication }),
    ...(connectionString === undefined ? {} : { connectionString }),
  });

  await api.app.listen({ port, host: "0.0.0.0" });
  console.log(`[sintius] API listening on http://0.0.0.0:${port}`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[sintius] received ${signal}, closing`);
    await api.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("[sintius] fatal startup error", error);
  process.exitCode = 1;
});

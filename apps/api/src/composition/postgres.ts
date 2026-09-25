import type { FastifyInstance, FastifyServerOptions } from "fastify";
import { FOUNDATION_PROOF_AUDIT_FIELDS, createFoundationProofCommand } from "../../../../modules/foundation-proof/application/proof-command.ts";
import { PostgresFoundationProofPersistence } from "../../../../modules/foundation-proof/infrastructure/postgres/proof-persistence.ts";
import { createTenantAuthorizer } from "../../../../modules/identity-tenant/application/authorization.ts";
import { createPlatformAuthorizer } from "../../../../modules/identity-tenant/application/platform-authorization.ts";
import type { PlatformAuthorizer } from "../../../../modules/identity-tenant/application/ports.ts";
import { TENANT_AUDIT_FIELDS, createTenantCommands } from "../../../../modules/identity-tenant/application/tenant-commands.ts";
import { PostgresPermissionGrantStore } from "../../../../modules/identity-tenant/infrastructure/postgres/grant-store.ts";
import { PostgresTenantPersistence } from "../../../../modules/identity-tenant/infrastructure/postgres/tenant-persistence.ts";
import { createAuditPolicy, createAuditRecorder, type AuditFailureInfo } from "../../../../platform/audit/src/index.ts";
import type { UnexpectedErrorSink } from "../../../../platform/problem-model/src/index.ts";
import { buildApiServer, type RequestAuthenticator, type TenantStateReader } from "../http/server.ts";

export interface PostgresApiOptions {
  readonly authenticator: RequestAuthenticator;
  /** Platform-operator authentication for /v1/platform routes (decision D11). */
  readonly platformAuthenticator: RequestAuthenticator;
  /** Defaults to createPlatformAuthorizer: platform audience, MFA and a reviewed platform role. */
  readonly platformAuthorizer?: PlatformAuthorizer;
  readonly connectionString?: string;
  readonly clock?: () => Date;
  /** Mounts the test-only P0-010 proof route. Keep false in production routing. */
  readonly enableFoundationProof?: boolean;
  readonly unexpectedErrors?: UnexpectedErrorSink;
  readonly onAuditWriteFailure?: (info: AuditFailureInfo) => void;
  readonly logger?: FastifyServerOptions["logger"];
}

/** Composition root for the HTTP API on PostgreSQL, as the `sintius_app` role. */
export function composePostgresApi(options: PostgresApiOptions): { readonly app: FastifyInstance; close(): Promise<void> } {
  const clock = options.clock ?? (() => new Date());
  const connection = options.connectionString === undefined ? {} : { connectionString: options.connectionString };
  const tenantPersistence = new PostgresTenantPersistence(connection);
  const grants = new PostgresPermissionGrantStore(connection);
  const proofPersistence = new PostgresFoundationProofPersistence(connection);
  const audit = createAuditRecorder({
    policy: createAuditPolicy({ ...TENANT_AUDIT_FIELDS, ...FOUNDATION_PROOF_AUDIT_FIELDS }),
    clock,
    ...(options.onAuditWriteFailure === undefined ? {} : { onWriteFailure: options.onAuditWriteFailure }),
  });

  const tenantStates: TenantStateReader = {
    stateOf: (tenant, correlationId) =>
      tenantPersistence.runInTransaction({ tenantId: tenant, correlationId }, async (unitOfWork) => (await unitOfWork.tenants.findById(tenant))?.state),
  };

  const app = buildApiServer({
    authenticator: options.authenticator,
    platformAuthenticator: options.platformAuthenticator,
    tenantStates,
    tenantCommands: createTenantCommands({ persistence: tenantPersistence, authorizer: options.platformAuthorizer ?? createPlatformAuthorizer(), audit, clock }),
    ...(options.enableFoundationProof === true
      ? {
          foundationProof: createFoundationProofCommand({
            persistence: proofPersistence,
            authorizer: createTenantAuthorizer({ grants }),
            audit,
            clock,
          }),
        }
      : {}),
    ...(options.unexpectedErrors === undefined ? {} : { unexpectedErrors: options.unexpectedErrors }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return {
    app,
    async close() {
      await app.close();
      await Promise.all([tenantPersistence.close(), grants.close(), proofPersistence.close()]);
    },
  };
}

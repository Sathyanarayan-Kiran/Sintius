import { problem } from "../../problem-model/src/index.ts";
import { actorId as toActorId, type ActorId, type AuthenticatedPrincipal } from "./context.ts";

/**
 * Identity of a platform-scoped command, such as provisioning a tenant that does not exist yet.
 * There is no tenant context to derive from, so the target tenant is an explicit command
 * argument; the *authority* to act is enforced by an authorizer port, never by this object.
 */
export interface PlatformCommandContext {
  readonly actorId: ActorId;
  readonly principalKind: AuthenticatedPrincipal["kind"];
  readonly correlationId: string;
  readonly causationId?: string;
  readonly assurance: AuthenticatedPrincipal["assurance"];
  readonly credentialId?: string;
  readonly audiences: readonly string[];
  readonly scopes: readonly string[];
}

const issuedPlatformContexts = new WeakSet<object>();

export interface ResolvePlatformCommandContextInput {
  readonly principal: AuthenticatedPrincipal;
  readonly correlationId: string;
  readonly causationId?: string;
}

export function resolvePlatformCommandContext(input: ResolvePlatformCommandContextInput): Readonly<PlatformCommandContext> {
  if (input.correlationId.trim().length === 0) {
    throw problem({ code: "invalid_trusted_context", detail: "correlationId must not be blank." });
  }
  if (input.causationId !== undefined && input.causationId.trim().length === 0) {
    throw problem({ code: "invalid_trusted_context", detail: "causationId must not be blank." });
  }
  const context: PlatformCommandContext = {
    actorId: toActorId(input.principal.actorId),
    principalKind: input.principal.kind,
    assurance: input.principal.assurance,
    correlationId: input.correlationId,
    ...(input.principal.credentialId === undefined ? {} : { credentialId: input.principal.credentialId }),
    audiences: Object.freeze([...(input.principal.audiences ?? [])]),
    scopes: Object.freeze([...(input.principal.scopes ?? [])]),
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
  };
  const frozen = Object.freeze(context);
  issuedPlatformContexts.add(frozen);
  return frozen;
}

export function assertIssuedPlatformContext(context: Readonly<PlatformCommandContext>): void {
  if (!issuedPlatformContexts.has(context)) {
    throw problem({
      code: "tenant_context_mismatch",
      detail: "Only a platform command context issued by the trusted resolver may be used.",
    });
  }
}

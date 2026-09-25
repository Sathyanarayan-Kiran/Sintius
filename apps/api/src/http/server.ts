import Fastify, { LogController, type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import {
  CAUSATION_ID_HEADER,
  CORRELATION_ID_HEADER,
  PlatformProblem,
  mapErrorToProblemResponse,
  problem,
  resolveTraceIds,
  type ProblemFieldError,
  type UnexpectedErrorSink,
} from "../../../../platform/problem-model/src/index.ts";
import {
  resolvePlatformCommandContext,
  resolveTenantContext,
  runWithTenantContext,
  tenantId,
  type AuthenticatedPrincipal,
  type PlatformCommandContext,
  type TenantContext,
  type TenantId,
  type TenantOperationalState,
} from "../../../../platform/tenant-context/src/index.ts";

/** Verifies the request credential. Rejects with `authentication_failed` (401) when absent or invalid. */
export interface RequestAuthenticator {
  authenticate(input: { readonly authorization: string | undefined; readonly correlationId: string }): Promise<Readonly<AuthenticatedPrincipal>>;
}

/** Current operational state of a tenant, or undefined when it does not exist. */
export interface TenantStateReader {
  stateOf(tenant: TenantId, correlationId: string): Promise<TenantOperationalState | undefined>;
}

export interface TenantRepresentation {
  readonly id: string;
  readonly displayName: string;
  readonly state: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type CommandMetadata = { readonly idempotencyKey?: string };

/** The platform-scoped tenant lifecycle commands, as `createTenantCommands` exposes them. */
export interface TenantLifecycleCommands {
  provisionTenant(
    context: Readonly<PlatformCommandContext>,
    input: { readonly tenantId: string; readonly displayName: string; readonly initialAdministratorActorId: string },
    metadata?: CommandMetadata,
  ): Promise<Readonly<TenantRepresentation>>;
  activateTenant(context: Readonly<PlatformCommandContext>, input: LifecycleInput, metadata?: CommandMetadata): Promise<Readonly<TenantRepresentation>>;
  suspendTenant(context: Readonly<PlatformCommandContext>, input: LifecycleInput, metadata?: CommandMetadata): Promise<Readonly<TenantRepresentation>>;
  reactivateTenant(context: Readonly<PlatformCommandContext>, input: LifecycleInput, metadata?: CommandMetadata): Promise<Readonly<TenantRepresentation>>;
  closeTenant(context: Readonly<PlatformCommandContext>, input: LifecycleInput, metadata?: CommandMetadata): Promise<Readonly<TenantRepresentation>>;
}

interface LifecycleInput {
  readonly tenantId: string;
  readonly expectedVersion: number;
  readonly reason?: string;
}

/** The Phase 0 proof command; runs inside the resolved tenant context. */
export type FoundationProofCommand = (
  input: { readonly label: string },
  metadata?: CommandMetadata,
) => Promise<Readonly<{ readonly proofRecordId: string; readonly label: string; readonly recordedAt: string }>>;

export interface ApiServerDependencies {
  readonly authenticator: RequestAuthenticator;
  readonly tenantStates: TenantStateReader;
  readonly tenantCommands?: TenantLifecycleCommands;
  /** Test-only diagnostic route; mounted only when supplied. */
  readonly foundationProof?: FoundationProofCommand;
  readonly unexpectedErrors?: UnexpectedErrorSink;
  readonly logger?: FastifyServerOptions["logger"];
}

/** Selects one of several signed tenant memberships; it is never an authority on its own. */
export const ACTIVE_TENANT_HEADER = "x-active-tenant";
const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
const BODY_LIMIT_BYTES = 256 * 1024;

interface RequestState {
  correlationId: string;
  causationId?: string;
  principal?: Readonly<AuthenticatedPrincipal>;
  tenantContext?: Readonly<TenantContext>;
}

const states = new WeakMap<FastifyRequest, RequestState>();

function stateOf(request: FastifyRequest): RequestState {
  const state = states.get(request);
  if (state === undefined) throw new Error("Ingress state was not initialized for this request.");
  return state;
}

function singleHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function principalOf(request: FastifyRequest): Readonly<AuthenticatedPrincipal> {
  const principal = stateOf(request).principal;
  if (principal === undefined) throw new Error("Route requires authentication but no principal was resolved.");
  return principal;
}

function metadataOf(request: FastifyRequest): CommandMetadata {
  const key = singleHeader(request, IDEMPOTENCY_KEY_HEADER);
  return key === undefined ? {} : { idempotencyKey: key };
}

function platformContext(request: FastifyRequest): Readonly<PlatformCommandContext> {
  const { correlationId, causationId } = stateOf(request);
  return resolvePlatformCommandContext({
    principal: principalOf(request),
    correlationId,
    ...(causationId === undefined ? {} : { causationId }),
  });
}

/** Maps framework rejections (schema, JSON syntax, media type, size) to the canonical 400 problem. */
function toPlatformError(error: unknown): unknown {
  if (error instanceof PlatformProblem) return error;
  const fastifyError = error as Partial<FastifyError> | undefined;
  if (Array.isArray(fastifyError?.validation)) {
    const errors: ProblemFieldError[] = fastifyError.validation.slice(0, 20).map((issue) => {
      const missing = (issue.params as { missingProperty?: unknown } | undefined)?.missingProperty;
      const extra = (issue.params as { additionalProperty?: unknown } | undefined)?.additionalProperty;
      const suffix = typeof missing === "string" ? `/${missing}` : typeof extra === "string" ? `/${extra}` : "";
      return {
        path: `${issue.instancePath ?? ""}${suffix}` || "/",
        code: String(issue.keyword ?? "invalid"),
        message: typeof extra === "string" ? "Property is not allowed." : typeof missing === "string" ? "Property is required." : "Value is invalid.",
      };
    });
    return problem({ code: "request_validation_failed", detail: "The request does not match the endpoint contract.", errors });
  }
  const status = fastifyError?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return problem({ code: "request_validation_failed", detail: "The request could not be read. Send a JSON body within the size limit." });
  }
  return error;
}

function sendProblem(error: unknown, request: FastifyRequest, reply: FastifyReply, sink: UnexpectedErrorSink | undefined): FastifyReply {
  const state = states.get(request);
  const response = mapErrorToProblemResponse(
    toPlatformError(error),
    {
      ...(state === undefined ? {} : { correlationId: state.correlationId }),
      ...(state?.causationId === undefined ? {} : { causationId: state.causationId }),
      route: request.routeOptions.url ?? "unmatched",
    },
    sink,
  );
  reply.code(response.status).headers(response.headers);
  if (response.body.code === "authentication_failed") reply.header("www-authenticate", 'Bearer realm="sintius"');
  return reply.send(Buffer.from(JSON.stringify(response.body)));
}

function tenantBody(tenant: Readonly<TenantRepresentation>) {
  return {
    tenant_id: tenant.id,
    display_name: tenant.displayName,
    state: tenant.state,
    version: tenant.version,
    created_at: tenant.createdAt,
    updated_at: tenant.updatedAt,
  };
}

/** Parses `If-Match: "<row_version>"` (weak or strong). */
function expectedVersionOf(request: FastifyRequest): number {
  const header = singleHeader(request, "if-match");
  const match = header === undefined ? null : /^(?:W\/)?"([1-9][0-9]{0,15})"$/.exec(header.trim());
  if (match === null) {
    throw problem({
      code: "request_validation_failed",
      detail: 'Lifecycle commands require If-Match with the current tenant version, for example If-Match: "1".',
      errors: [{ path: "/headers/if-match", code: "required", message: "Send the current ETag." }],
    });
  }
  return Number(match[1]);
}

const nonBlank = { type: "string", minLength: 1, maxLength: 200, pattern: "\\S" } as const;

/**
 * Fastify ingress. Every response carries `X-Correlation-Id`; every error is RFC 9457 problem+json.
 * Tenant identity comes only from the authenticated principal: a single membership is selected
 * implicitly, several require `X-Active-Tenant` to choose one of them, and a `tenant_id` in a
 * tenant-scoped request body is rejected. Idempotency keys travel as `Idempotency-Key` headers.
 */
export function buildApiServer(dependencies: ApiServerDependencies): FastifyInstance {
  const app = Fastify({
    logger: dependencies.logger ?? false,
    bodyLimit: BODY_LIMIT_BYTES,
    // The correlation ID is the request ID, so every log line of a request carries it.
    genReqId: (raw) => {
      const header = raw.headers[CORRELATION_ID_HEADER];
      return resolveTraceIds({ correlationId: typeof header === "string" ? header : null }).correlationId;
    },
    logController: new LogController({ requestIdLogLabel: "correlation_id" }),
    // Reject unknown properties instead of silently dropping them, and never coerce types.
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false, allErrors: true } },
  });
  const sink = dependencies.unexpectedErrors;

  app.addHook("onRequest", async (request, reply) => {
    const causation = singleHeader(request, CAUSATION_ID_HEADER);
    const trace = resolveTraceIds({ correlationId: request.id, causationId: causation ?? null });
    states.set(request, { correlationId: trace.correlationId, ...(trace.causationId === undefined ? {} : { causationId: trace.causationId }) });
    reply.header(CORRELATION_ID_HEADER, trace.correlationId);
    if (request.routeOptions.config && (request.routeOptions.config as { public?: boolean }).public === true) return;
    stateOf(request).principal = await dependencies.authenticator.authenticate({
      authorization: singleHeader(request, "authorization"),
      correlationId: trace.correlationId,
    });
  });

  app.setErrorHandler((error, request, reply) => sendProblem(error, request, reply, sink));
  app.setNotFoundHandler((request, reply) =>
    sendProblem(problem({ code: "resource_not_found", detail: "No resource exists at this path." }), request, reply, sink),
  );

  /** Resolves the trusted tenant context before body validation, so a body tenant is always refused. */
  async function resolveTenant(request: FastifyRequest): Promise<void> {
    const state = stateOf(request);
    const principal = principalOf(request);
    const selector = singleHeader(request, ACTIVE_TENANT_HEADER);
    const memberships = principal.tenantMemberships;
    const selected = selector !== undefined ? selector : memberships.length === 1 ? memberships[0] : undefined;
    if (selected === undefined || selected.trim() === "") {
      throw problem({
        code: "tenant_access_denied",
        detail: `Select one of your tenants with the ${ACTIVE_TENANT_HEADER} header.`,
        correlation_id: state.correlationId,
      });
    }
    const body = request.body;
    const bodyTenant = typeof body === "object" && body !== null && Object.hasOwn(body, "tenant_id") ? String((body as Record<string, unknown>).tenant_id) : undefined;
    // The state is looked up only for a member with no body tenant, so non-members learn nothing
    // about the tenant. Otherwise the resolver rejects on the body tenant or membership before it
    // reads the state, and the placeholder is never used.
    const selectedTenant = tenantId(selected);
    const lookUpState = memberships.includes(selectedTenant) && bodyTenant === undefined;
    const tenantState = lookUpState ? await dependencies.tenantStates.stateOf(selectedTenant, state.correlationId) : "ACTIVE";
    if (tenantState === undefined) {
      throw problem({ code: "tenant_access_denied", detail: "The authenticated principal is not authorized for the selected tenant.", correlation_id: state.correlationId });
    }
    state.tenantContext = resolveTenantContext({
      principal,
      selectedTenantId: selectedTenant,
      tenantState,
      correlationId: state.correlationId,
      ...(state.causationId === undefined ? {} : { causationId: state.causationId }),
      ...(bodyTenant === undefined ? {} : { bodyTenantId: bodyTenant }),
    });
  }

  function inTenant<T>(request: FastifyRequest, work: () => Promise<T>): Promise<T> {
    const context = stateOf(request).tenantContext;
    if (context === undefined) throw new Error("Route requires a tenant context but none was resolved.");
    return runWithTenantContext(context, work);
  }

  app.get("/health/live", { config: { public: true } }, async () => ({ status: "ok" }));

  const proof = dependencies.foundationProof;
  if (proof !== undefined) {
    app.post(
      "/v1/foundation/proofs",
      {
        preValidation: resolveTenant,
        schema: { body: { type: "object", additionalProperties: false, required: ["label"], properties: { label: nonBlank } } },
      },
      async (request, reply) => {
        const body = request.body as { readonly label: string };
        const result = await inTenant(request, () => proof({ label: body.label }, metadataOf(request)));
        return reply.code(201).send({ proof_record_id: result.proofRecordId, label: result.label, recorded_at: result.recordedAt });
      },
    );
  }

  const tenants = dependencies.tenantCommands;
  if (tenants !== undefined) {
    app.post(
      "/v1/platform/tenants",
      {
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["tenant_id", "display_name", "initial_administrator_actor_id"],
            properties: { tenant_id: nonBlank, display_name: nonBlank, initial_administrator_actor_id: nonBlank },
          },
        },
      },
      async (request, reply) => {
        const body = request.body as { readonly tenant_id: string; readonly display_name: string; readonly initial_administrator_actor_id: string };
        const tenant = await tenants.provisionTenant(
          platformContext(request),
          { tenantId: body.tenant_id, displayName: body.display_name, initialAdministratorActorId: body.initial_administrator_actor_id },
          metadataOf(request),
        );
        return reply.code(201).header("etag", `"${tenant.version}"`).header("location", `/v1/platform/tenants/${encodeURIComponent(tenant.id)}`).send(tenantBody(tenant));
      },
    );

    const lifecycle = {
      activate: tenants.activateTenant.bind(tenants),
      suspend: tenants.suspendTenant.bind(tenants),
      reactivate: tenants.reactivateTenant.bind(tenants),
      close: tenants.closeTenant.bind(tenants),
    } as const;
    for (const [verb, command] of Object.entries(lifecycle)) {
      app.post(
        `/v1/platform/tenants/:tenantId/${verb}`,
        {
          schema: {
            params: { type: "object", required: ["tenantId"], properties: { tenantId: nonBlank } },
            body: { type: "object", additionalProperties: false, properties: { reason: { type: "string", maxLength: 500 } } },
          },
        },
        async (request, reply) => {
          const { tenantId: target } = request.params as { readonly tenantId: string };
          const reason = (request.body as { readonly reason?: string } | undefined)?.reason;
          const expectedVersion = expectedVersionOf(request);
          let tenant: Readonly<TenantRepresentation>;
          try {
            tenant = await command(
              platformContext(request),
              { tenantId: target, expectedVersion, ...(reason === undefined ? {} : { reason }) },
              metadataOf(request),
            );
          } catch (error) {
            // A stale If-Match is a failed precondition (spec section 9), not a generic conflict.
            if (error instanceof PlatformProblem && error.problem.code === "tenant_version_conflict") {
              throw problem({ code: "precondition_failed", detail: "The tenant changed since the supplied If-Match version. Re-read it and retry." });
            }
            throw error;
          }
          return reply.code(200).header("etag", `"${tenant.version}"`).send(tenantBody(tenant));
        },
      );
    }
  }

  return app;
}

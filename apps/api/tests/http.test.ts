import assert from "node:assert/strict";
import test from "node:test";
import { finishedSpans, metricValue, resetSpans, serializedTelemetry, testTelemetry } from "../../../platform/observability/tests/support.ts";
import { PlatformProblem, problem, type UnexpectedErrorReport } from "../../../platform/problem-model/src/index.ts";
import {
  currentTenantContext,
  tenantId,
  type AuthenticatedPrincipal,
  type TenantId,
  type TenantOperationalState,
} from "../../../platform/tenant-context/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import { createBearerAuthenticator } from "../src/http/bearer-authenticator.ts";
import {
  buildApiServer,
  type FoundationProofCommand,
  type RequestAuthenticator,
  type TenantLifecycleCommands,
  type TenantRepresentation,
} from "../src/http/server.ts";

const A = tenantId("tenant_http_A");
const B = tenantId("tenant_http_B");
const PROBLEM_JSON = "application/problem+json";

const principals: Record<string, () => Readonly<AuthenticatedPrincipal>> = {
  "token-a": () => testPrincipal([A], { actor: "user_a" }),
  "token-ab": () => testPrincipal([A, B], { actor: "user_ab" }),
  "token-operator": () => testPrincipal([], { actor: "platform_operator" }),
};

const authenticator: RequestAuthenticator = {
  async authenticate({ authorization, correlationId }) {
    const token = authorization?.replace(/^Bearer /, "") ?? "";
    const principal = principals[token];
    if (principal === undefined) throw problem({ code: "authentication_failed", detail: "Authentication is required.", correlation_id: correlationId });
    return principal();
  },
};

function harness(options: { states?: Partial<Record<string, TenantOperationalState>>; proof?: FoundationProofCommand; tenants?: TenantLifecycleCommands } = {}) {
  const stateLookups: string[] = [];
  const reports: UnexpectedErrorReport[] = [];
  const calls: { input: unknown; metadata: unknown; tenant: TenantId; correlationId: string; causationId?: string }[] = [];
  const proof: FoundationProofCommand =
    options.proof ??
    (async (input, metadata) => {
      const context = currentTenantContext();
      calls.push({ input, metadata, tenant: context.tenantId, correlationId: context.correlationId, ...(context.causationId === undefined ? {} : { causationId: context.causationId }) });
      return { proofRecordId: "proof_1", label: input.label, recordedAt: "2026-09-24T12:00:00.000Z" };
    });
  const states = options.states ?? { [A]: "ACTIVE", [B]: "ACTIVE" };
  const app = buildApiServer({
    authenticator,
    tenantStates: {
      async stateOf(tenant) {
        stateLookups.push(tenant);
        return states[tenant];
      },
    },
    foundationProof: proof,
    ...(options.tenants === undefined ? {} : { tenantCommands: options.tenants }),
    unexpectedErrors: { record: (report) => void reports.push(report) },
  });
  return { app, calls, stateLookups, reports };
}

const post = (app: ReturnType<typeof harness>["app"], url: string, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, payload: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

test("P0-002 health is public and every response carries a correlation ID", async () => {
  const { app } = harness();
  const generated = await app.inject({ method: "GET", url: "/health/live" });
  assert.equal(generated.statusCode, 200);
  assert.match(String(generated.headers["x-correlation-id"]), /^corr_/);
  const echoed = await app.inject({ method: "GET", url: "/health/live", headers: { "x-correlation-id": "corr-client-123" } });
  assert.equal(echoed.headers["x-correlation-id"], "corr-client-123");
  const unsafe = await app.inject({ method: "GET", url: "/health/live", headers: { "x-correlation-id": "has space<script>" } });
  assert.notEqual(unsafe.headers["x-correlation-id"], "has space<script>", "an invalid inbound ID is replaced, never reflected");
});

test("P0-002 missing or invalid credentials return 401 problem+json with the request correlation ID", async () => {
  const { app, calls } = harness();
  for (const authorization of [undefined, "Bearer nope", "Basic abc"]) {
    const response = await post(app, "/v1/foundation/proofs", { label: "x" }, {
      "x-correlation-id": "corr-auth-1",
      ...(authorization === undefined ? {} : { authorization }),
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers["content-type"], PROBLEM_JSON);
    assert.equal(response.headers["www-authenticate"], 'Bearer realm="sintius"');
    assert.deepEqual(
      [response.json().code, response.json().status, response.json().correlation_id],
      ["authentication_failed", 401, "corr-auth-1"],
    );
  }
  assert.equal(calls.length, 0);
});

test("P0-001 the command runs in the trusted tenant context with ingress correlation, causation and idempotency key", async () => {
  const { app, calls } = harness();
  const response = await post(app, "/v1/foundation/proofs", { label: "phase-0" }, {
    authorization: "Bearer token-a",
    "idempotency-key": "8f14e45f-ceea-467f-a0e6-1c2d3e4f5a6b",
    "x-correlation-id": "corr-ingress-1",
    "x-causation-id": "evt_upstream_1",
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.headers["x-correlation-id"], "corr-ingress-1");
  assert.deepEqual(response.json(), { proof_record_id: "proof_1", label: "phase-0", recorded_at: "2026-09-24T12:00:00.000Z" });
  assert.deepEqual(calls, [{
    input: { label: "phase-0" },
    metadata: { idempotencyKey: "8f14e45f-ceea-467f-a0e6-1c2d3e4f5a6b" },
    tenant: A,
    correlationId: "corr-ingress-1",
    causationId: "evt_upstream_1",
  }]);
});

test("P0-001 a tenant in the request body is refused before any tenant lookup or command", async () => {
  const { app, calls, stateLookups } = harness();
  for (const tenant of [A, B]) {
    const response = await post(app, "/v1/foundation/proofs", { label: "x", tenant_id: tenant }, { authorization: "Bearer token-a" });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, "untrusted_tenant_context");
  }
  assert.deepEqual([calls.length, stateLookups.length], [0, 0]);
});

test("P0-001 several memberships require an explicit selection among them; non-members learn nothing", async () => {
  const { app, calls, stateLookups } = harness({ states: { [A]: "ACTIVE", [B]: "SUSPENDED" } });
  const unselected = await post(app, "/v1/foundation/proofs", { label: "x" }, { authorization: "Bearer token-ab" });
  assert.deepEqual([unselected.statusCode, unselected.json().code], [403, "tenant_access_denied"]);

  const selected = await post(app, "/v1/foundation/proofs", { label: "x" }, { authorization: "Bearer token-ab", "x-active-tenant": A });
  assert.equal(selected.statusCode, 201);
  assert.equal(calls[0]?.tenant, A);

  const suspended = await post(app, "/v1/foundation/proofs", { label: "x" }, { authorization: "Bearer token-ab", "x-active-tenant": B });
  assert.deepEqual([suspended.statusCode, suspended.json().code], [403, "tenant_not_active"]);

  stateLookups.length = 0;
  const foreign = await post(app, "/v1/foundation/proofs", { label: "x" }, { authorization: "Bearer token-a", "x-active-tenant": B });
  assert.deepEqual([foreign.statusCode, foreign.json().code], [403, "tenant_access_denied"]);
  assert.deepEqual(stateLookups, [], "the state of a tenant the caller does not belong to is never read");
  assert.equal(calls.length, 1);
});

test("P0-001 a member of a tenant that no longer exists gets the same generic denial", async () => {
  const { app } = harness({ states: {} });
  const response = await post(app, "/v1/foundation/proofs", { label: "x" }, { authorization: "Bearer token-a" });
  assert.deepEqual([response.statusCode, response.json().code], [403, "tenant_access_denied"]);
});

test("P0-002 malformed requests become 400 request_validation_failed with field errors and no command call", async () => {
  const { app, calls } = harness();
  const auth = { authorization: "Bearer token-a" };
  const extra = await post(app, "/v1/foundation/proofs", { label: "x", surprise: true }, auth);
  assert.equal(extra.statusCode, 400);
  assert.equal(extra.json().code, "request_validation_failed");
  assert.deepEqual(extra.json().errors, [{ path: "/surprise", code: "additionalProperties", message: "Property is not allowed." }]);

  const missing = await post(app, "/v1/foundation/proofs", {}, auth);
  assert.deepEqual(missing.json().errors, [{ path: "/label", code: "required", message: "Property is required." }]);

  const coerced = await post(app, "/v1/foundation/proofs", { label: 42 }, auth);
  assert.deepEqual([coerced.statusCode, coerced.json().errors[0].path], [400, "/label"], "types are never coerced");

  const invalidJson = await post(app, "/v1/foundation/proofs", "{not json", auth);
  assert.deepEqual([invalidJson.statusCode, invalidJson.json().code], [400, "request_validation_failed"]);
  assert.doesNotMatch(invalidJson.body, /Unexpected token|SyntaxError/, "parser internals are not echoed");

  const wrongType = await app.inject({ method: "POST", url: "/v1/foundation/proofs", payload: "label=x", headers: { ...auth, "content-type": "text/plain" } });
  assert.deepEqual([wrongType.statusCode, wrongType.json().code], [400, "request_validation_failed"]);

  const tooLarge = await post(app, "/v1/foundation/proofs", { label: "x".repeat(300 * 1024) }, auth);
  assert.deepEqual([tooLarge.statusCode, tooLarge.json().code], [400, "request_validation_failed"]);
  assert.equal(calls.length, 0);
});

test("P0-002 unknown routes return 404 problem+json", async () => {
  const { app } = harness();
  const response = await app.inject({ method: "GET", url: "/v1/nothing-here", headers: { authorization: "Bearer token-a" } });
  assert.deepEqual([response.statusCode, response.headers["content-type"], response.json().code], [404, PROBLEM_JSON, "resource_not_found"]);
});

test("P0-002 unexpected command failures are sanitized externally and reported internally", async () => {
  const { app, reports } = harness({
    proof: async () => {
      throw new Error("db password=hunter2 exploded");
    },
  });
  const response = await post(app, "/v1/foundation/proofs", { label: "x" }, { authorization: "Bearer token-a", "x-correlation-id": "corr-500" });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().code, "internal_error");
  assert.doesNotMatch(response.body, /hunter2|exploded/);
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.correlationId, "corr-500");
  assert.equal(reports[0]?.route, "/v1/foundation/proofs");
  assert.doesNotMatch(reports[0]?.errorMessage ?? "", /hunter2/);
});

test("P0-006 idempotency problems keep their status and an in-flight duplicate carries Retry-After", async () => {
  const { app } = harness({
    proof: async () => {
      throw problem({ code: "request_in_progress", detail: "Still processing.", retryAfterSeconds: 2 });
    },
  });
  const response = await post(app, "/v1/foundation/proofs", { label: "x" }, { authorization: "Bearer token-a" });
  assert.deepEqual([response.statusCode, response.headers["retry-after"], response.json().code], [409, "2", "request_in_progress"]);
});

test("P0-003 tenant lifecycle routes use If-Match and ETag, and map a stale version to 412", async () => {
  let version = 1;
  const received: unknown[] = [];
  const snapshot = (id: string, state: string): TenantRepresentation => ({
    id, displayName: "Tenant", state, version, createdAt: "2026-09-24T12:00:00.000Z", updatedAt: "2026-09-24T12:00:00.000Z",
  });
  const lifecycle = (state: string) => async (context: { actorId: string; correlationId: string }, input: { tenantId: string; expectedVersion: number; reason?: string }, metadata?: unknown) => {
    received.push({ actor: context.actorId, correlation: context.correlationId, input, metadata });
    if (input.expectedVersion !== version) throw problem({ code: "tenant_version_conflict", detail: "changed" });
    version += 1;
    return snapshot(input.tenantId, state);
  };
  const tenants = {
    provisionTenant: async (_context: unknown, input: { tenantId: string }) => snapshot(input.tenantId, "PROVISIONING"),
    activateTenant: lifecycle("ACTIVE"),
    suspendTenant: lifecycle("SUSPENDED"),
    reactivateTenant: lifecycle("ACTIVE"),
    closeTenant: lifecycle("CLOSED"),
  } as unknown as TenantLifecycleCommands;
  const { app } = harness({ tenants });
  const operator = { authorization: "Bearer token-operator", "idempotency-key": "8f14e45f-ceea-467f-a0e6-000000000001" };

  const created = await post(app, "/v1/platform/tenants", { tenant_id: "tenant_new", display_name: "New", initial_administrator_actor_id: "admin_new" }, operator);
  assert.deepEqual([created.statusCode, created.headers.etag, created.headers.location], [201, '"1"', "/v1/platform/tenants/tenant_new"]);
  assert.deepEqual(created.json(), {
    tenant_id: "tenant_new", display_name: "Tenant", state: "PROVISIONING", version: 1,
    created_at: "2026-09-24T12:00:00.000Z", updated_at: "2026-09-24T12:00:00.000Z",
  });

  const noPrecondition = await post(app, "/v1/platform/tenants/tenant_new/activate", {}, operator);
  assert.deepEqual([noPrecondition.statusCode, noPrecondition.json().errors[0].path], [400, "/headers/if-match"]);

  const activated = await post(app, "/v1/platform/tenants/tenant_new/activate", {}, { ...operator, "if-match": '"1"', "x-correlation-id": "corr-activate" });
  assert.deepEqual([activated.statusCode, activated.headers.etag, activated.json().state], [200, '"2"', "ACTIVE"]);
  assert.deepEqual(received[0], {
    actor: "platform_operator",
    correlation: "corr-activate",
    input: { tenantId: "tenant_new", expectedVersion: 1 },
    metadata: { idempotencyKey: "8f14e45f-ceea-467f-a0e6-000000000001" },
  });

  const stale = await post(app, "/v1/platform/tenants/tenant_new/suspend", { reason: "Fraud review" }, { ...operator, "if-match": '"1"' });
  assert.deepEqual([stale.statusCode, stale.json().code], [412, "precondition_failed"]);
  const suspended = await post(app, "/v1/platform/tenants/tenant_new/suspend", { reason: "Fraud review" }, { ...operator, "if-match": 'W/"2"' });
  assert.deepEqual([suspended.statusCode, suspended.json().state], [200, "SUSPENDED"]);
  assert.deepEqual((received.at(-1) as { input: unknown }).input, { tenantId: "tenant_new", expectedVersion: 2, reason: "Fraud review" });
});

test("the bearer adapter extracts only a well-formed credential and delegates every check", async () => {
  const seen: unknown[] = [];
  const adapter = createBearerAuthenticator({
    providerId: "idp_main",
    audience: "sintius-api",
    authenticator: {
      async authenticateInteractive(input) {
        seen.push(input);
        return testPrincipal([A]);
      },
    },
  });
  await adapter.authenticate({ authorization: "bearer abc.DEF-123_~+/=", correlationId: "corr_b" });
  assert.deepEqual(seen, [{ providerId: "idp_main", rawCredential: "abc.DEF-123_~+/=", requiredAudience: "sintius-api", correlationId: "corr_b" }]);
  for (const authorization of [undefined, "", "Bearer", "Bearer a b", "Token abc", `Bearer ${"a".repeat(20_000)}`]) {
    await assert.rejects(
      adapter.authenticate({ authorization, correlationId: "corr_b" }),
      (error: unknown) => error instanceof PlatformProblem && error.problem.code === "authentication_failed",
    );
  }
  assert.equal(seen.length, 1);
});

test("P0-002 request logs are labelled with the correlation ID and never include the credential", async () => {
  const lines: Record<string, unknown>[] = [];
  const app = buildApiServer({
    authenticator,
    tenantStates: { stateOf: async () => "ACTIVE" },
    logger: { level: "info", stream: { write: (line: string) => void lines.push(JSON.parse(line)) } },
  });
  await app.inject({ method: "GET", url: "/health/live", headers: { "x-correlation-id": "corr-log-1", authorization: "Bearer token-a" } });
  const requestLines = lines.filter((line) => line.msg === "incoming request" || line.msg === "request completed");
  assert.equal(requestLines.length, 2);
  for (const line of requestLines) {
    assert.equal(line.correlation_id, "corr-log-1");
    assert.equal(Object.hasOwn(line, "reqId"), false, "the default label is replaced");
  }
  assert.doesNotMatch(JSON.stringify(lines), /token-a/, "the bearer credential never reaches logs");
});

test("D15 each request is a server span named by its route, problems are counted by code, and nothing sensitive is exported", async () => {
  testTelemetry();
  const unauthorizedBefore = await metricValue("sintius.http.problems", { "sintius.problem.code": "authentication_failed", "http.response.status_code": 401 });
  const internalBefore = await metricValue("sintius.http.problems", { "sintius.problem.code": "internal_error" });
  resetSpans();
  const { app } = harness({
    proof: async () => {
      throw new Error("db password=hunter2 exploded");
    },
  });
  await post(app, "/v1/foundation/proofs", { label: "x" }, { "x-correlation-id": "corr-otel-401" });
  await post(app, "/v1/foundation/proofs", { label: "x" }, { authorization: "Bearer token-a", "x-correlation-id": "corr-otel-500" });

  const servers = finishedSpans().filter((span) => span.name === "POST /v1/foundation/proofs");
  assert.deepEqual(
    servers.map((span) => [span.attributes["sintius.correlation_id"], span.attributes["http.response.status_code"], span.attributes["sintius.problem.code"]]),
    [["corr-otel-401", 401, "authentication_failed"], ["corr-otel-500", 500, "internal_error"]],
  );
  assert.equal(servers[1]!.status.code, 2, "a 5xx marks the server span as an error");
  assert.notEqual(servers[0]!.status.code, 2, "a 401 is an outcome, not a fault");
  assert.equal(await metricValue("sintius.http.problems", { "sintius.problem.code": "authentication_failed", "http.response.status_code": 401 }) - unauthorizedBefore, 1);
  assert.equal(await metricValue("sintius.http.problems", { "sintius.problem.code": "internal_error" }) - internalBefore, 1);
  assert.doesNotMatch(serializedTelemetry(finishedSpans()), /token-a|Bearer|hunter2/);
});

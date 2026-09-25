import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import pg from "pg";
import { createAuthenticator } from "../../../modules/identity-tenant/application/authentication.ts";
import type { IdentityProviderPolicy, VerifiedCredentialClaims } from "../../../modules/identity-tenant/application/authentication-ports.ts";
import { AllowListAuthorizer } from "../../../modules/identity-tenant/tests/in-memory-persistence.ts";
import type { EventEnvelope } from "../../../platform/event-envelope/src/index.ts";
import { finishedSpans, metricValue, resetSpans, serializedTelemetry, testTelemetry } from "../../../platform/observability/tests/support.ts";
import { PostgresInboxPersistence, PostgresOutboxStore } from "../../../platform/outbox/infrastructure/postgres/store.ts";
import { PostgresEventPublisher } from "../../../platform/outbox/infrastructure/postgres/transport.ts";
import { createDeliveryWorker, createIdempotentConsumer, createOutboxDispatcher, type InboxStore } from "../../../platform/outbox/src/index.ts";
import { tenantId } from "../../../platform/tenant-context/src/index.ts";
import { composePostgresApi } from "../src/composition/postgres.ts";
import { createBearerAuthenticator } from "../src/http/bearer-authenticator.ts";

/**
 * P0-010 through HTTP on PostgreSQL: a real Fastify ingress, the provider-neutral authentication
 * service (only signature verification is a test double), tenant lifecycle over HTTP, live RBAC,
 * the idempotent proof and the outbox dispatcher, all joined by the one ingress correlation ID.
 */

const { Pool } = pg;
testTelemetry();
const adminUrl = process.env.SINTIUS_MIGRATION_DATABASE_URL ?? "postgresql://sintius_admin@127.0.0.1:54329/sintius";
const appUrl = process.env.SINTIUS_DATABASE_URL ?? "postgresql://sintius_app@127.0.0.1:54329/sintius";
const dispatcherUrl = process.env.SINTIUS_DISPATCHER_DATABASE_URL ?? "postgresql://sintius_dispatcher@127.0.0.1:54329/sintius";
const admin = new Pool({ connectionString: adminUrl, max: 2 });
const NOW = new Date("2026-09-24T12:00:00.000Z");
const A = tenantId("tenant_http_pg_A");
const B = tenantId("tenant_http_pg_B");

const policy: IdentityProviderPolicy = Object.freeze({
  id: "oidc-admin",
  mechanism: "oidc",
  issuer: "https://idp.example.test",
  allowedAudiences: Object.freeze(["sintius-api"]),
  clockSkewSeconds: 30,
  requireMfa: true,
  allowedWorkloadScopes: Object.freeze([]),
});

function claims(credentialId: string, subject: string, tenants: readonly string[]): Readonly<VerifiedCredentialClaims> {
  return Object.freeze({
    mechanism: "oidc" as const,
    credentialId,
    subject,
    issuer: policy.issuer,
    audiences: Object.freeze(["sintius-api"]),
    tenantIds: Object.freeze(tenants.map((value) => tenantId(value))),
    authenticationMethods: Object.freeze(["pwd", "mfa"]),
    scopes: Object.freeze([]),
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
}

// Test-only verifier: stands in for signature/JWKS validation, which awaits the identity-provider decision.
const credentials = new Map([
  // Platform operators have no identity model yet; this membership only satisfies the interactive-principal rule.
  ["operator-token", claims("cred_operator", "platform_operator", ["tenant_platform_operations"])],
  ["user-a-token", claims("cred_user_a", "proof_user", [A])],
  ["user-b-token", claims("cred_user_b", "proof_user", [B])],
]);
const revoked = new Set<string>();

let api: ReturnType<typeof composePostgresApi>;

beforeEach(async () => {
  await api?.close();
  revoked.clear();
  await admin.query(
    "TRUNCATE foundation_proof_record, idempotency_record, outbox_event, audit_event, tenant_role_assignment, tenant_role, tenant RESTART IDENTITY CASCADE",
  );
  api = composePostgresApi({
    authenticator: createBearerAuthenticator({
      providerId: "oidc-admin",
      audience: "sintius-api",
      authenticator: createAuthenticator({
        policies: { findById: async (id) => (id === policy.id ? policy : undefined) },
        verifier: {
          verify: async (raw) => {
            const value = credentials.get(raw);
            if (value === undefined) throw new Error("signature invalid");
            return value;
          },
        },
        credentialStatus: { isRevoked: async (id) => revoked.has(id) },
        clock: () => NOW,
      }),
    }),
    platformAuthorizer: new AllowListAuthorizer(["tenant:provision", "tenant:manage_lifecycle"]),
    connectionString: appUrl,
    clock: () => NOW,
    enableFoundationProof: true,
  });
});

after(async () => {
  await api?.close();
  await admin.end();
});

const call = (method: "POST" | "GET", url: string, token: string, headers: Record<string, string> = {}, body?: unknown) =>
  api.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });

async function activeTenantOverHttp(id: string, suffix: string) {
  const created = await call("POST", "/v1/platform/tenants", "operator-token", { "idempotency-key": `8f14e45f-ceea-467f-a0e6-00000000100${suffix}` }, {
    tenant_id: id, display_name: id, initial_administrator_actor_id: `admin_${id}`,
  });
  assert.equal(created.statusCode, 201, created.body);
  const activated = await call("POST", `/v1/platform/tenants/${id}/activate`, "operator-token", {
    "idempotency-key": `8f14e45f-ceea-467f-a0e6-00000000200${suffix}`,
    "if-match": created.headers.etag as string,
  }, {});
  assert.equal(activated.statusCode, 200, activated.body);
  assert.equal(activated.json().state, "ACTIVE");
}

test("P0-010 one ingress correlation ID spans HTTP, RBAC, idempotent commit, audit and dispatch on PostgreSQL", async () => {
  await activeTenantOverHttp(A, "1");
  await activeTenantOverHttp(B, "2");
  for (const tenant of [A, B]) {
    await admin.query(`INSERT INTO tenant_role (tenant_id, role_code, permissions) VALUES ($1, 'proof_operator', '["foundation:proof:execute"]')`, [tenant]);
  }
  await admin.query(`INSERT INTO tenant_role_assignment (tenant_id, actor_id, role_code) VALUES ($1, 'proof_user', 'proof_operator')`, [A]);

  const key = "8f14e45f-ceea-467f-a0e6-1c2d3e4f5a6b";
  const trace = { "idempotency-key": key, "x-correlation-id": "corr-p0-010-ingress" };

  const denied = await call("POST", "/v1/foundation/proofs", "user-b-token", trace, { label: "phase-0-exit" });
  assert.deepEqual([denied.statusCode, denied.json().code], [403, "permission_denied"], "tenant B's member holds no grant there");

  const first = await call("POST", "/v1/foundation/proofs", "user-a-token", trace, { label: "phase-0-exit" });
  const replay = await call("POST", "/v1/foundation/proofs", "user-a-token", { ...trace, "x-correlation-id": "corr-p0-010-retry" }, { label: "phase-0-exit" });
  assert.equal(first.statusCode, 201, first.body);
  assert.deepEqual([replay.statusCode, replay.json()], [201, first.json()], "the retry replays the stored response");
  assert.equal(first.headers["x-correlation-id"], "corr-p0-010-ingress");

  const conflict = await call("POST", "/v1/foundation/proofs", "user-a-token", trace, { label: "changed" });
  assert.deepEqual([conflict.statusCode, conflict.json().code], [409, "idempotency_key_reused_with_different_payload"]);
  const noKey = await call("POST", "/v1/foundation/proofs", "user-a-token", {}, { label: "phase-0-exit" });
  assert.deepEqual([noKey.statusCode, noKey.json().code], [400, "idempotency_key_required"]);
  const smuggled = await call("POST", "/v1/foundation/proofs", "user-a-token", trace, { label: "phase-0-exit", tenant_id: B });
  assert.deepEqual([smuggled.statusCode, smuggled.json().code], [400, "untrusted_tenant_context"]);

  revoked.add("cred_user_a");
  const afterRevocation = await call("POST", "/v1/foundation/proofs", "user-a-token", trace, { label: "phase-0-exit" });
  assert.deepEqual([afterRevocation.statusCode, afterRevocation.json().code], [401, "authentication_failed"], "a revoked credential cannot even replay");

  const evidence = await admin.query(
    `SELECT (SELECT count(*)::int FROM foundation_proof_record WHERE tenant_id = $1) AS records,
            (SELECT correlation_id FROM foundation_proof_record WHERE tenant_id = $1) AS record_correlation,
            (SELECT correlation_id FROM audit_event WHERE tenant_id = $1 AND action = 'foundation.proof_recorded') AS audit_correlation,
            (SELECT count(*)::int FROM foundation_proof_record WHERE tenant_id = $2) AS tenant_b_records`,
    [A, B],
  );
  assert.deepEqual(evidence.rows[0], { records: 1, record_correlation: "corr-p0-010-ingress", audit_correlation: "corr-p0-010-ingress", tenant_b_records: 0 });

  const published: EventEnvelope[] = [];
  const store = new PostgresOutboxStore({ connectionString: dispatcherUrl });
  try {
    const report = await createOutboxDispatcher({
      store,
      publisher: { publish: async (event) => void published.push(event as EventEnvelope) },
      clock: () => NOW,
      workerId: "http_gate_worker",
    })();
    assert.deepEqual([report.leased, report.published], [3, 3], "tenant A and B streams plus the proof are dispatchable heads");
    await createOutboxDispatcher({ store, publisher: { publish: async (event) => void published.push(event as EventEnvelope) }, clock: () => NOW, workerId: "http_gate_worker" })();
  } finally {
    await store.close();
  }
  const proofEvent = published.find((event) => event.type.endsWith("foundation.proof_recorded.v1"));
  assert.deepEqual(
    [proofEvent?.tenant_id, proofEvent?.correlation_id, proofEvent?.actor.id, proofEvent?.data.proof_record_id],
    [A, "corr-p0-010-ingress", "proof_user", first.json().proof_record_id],
    "the published event carries the ingress correlation ID",
  );
  assert.equal(published.length, 5, "two provisioned, two activated and one proof event");
});

test("P0-010 / D15 one trace spans HTTP ingress, the command transaction, audit, dispatch, delivery and consumption", async () => {
  await activeTenantOverHttp(A, "3");
  await admin.query(`INSERT INTO tenant_role (tenant_id, role_code, permissions) VALUES ($1, 'proof_operator', '["foundation:proof:execute"]')`, [A]);
  await admin.query(`INSERT INTO tenant_role_assignment (tenant_id, actor_id, role_code) VALUES ($1, 'proof_user', 'proof_operator')`, [A]);
  const executedBefore = await metricValue("sintius.idempotency.requests", { "sintius.command.scope": "foundation.proof.record", "sintius.idempotency.outcome": "executed" });
  const replayedBefore = await metricValue("sintius.idempotency.requests", { "sintius.command.scope": "foundation.proof.record", "sintius.idempotency.outcome": "replayed" });
  resetSpans();

  const headers = { "idempotency-key": "8f14e45f-ceea-467f-a0e6-7c2d3e4f5a6b", "x-correlation-id": "corr-d15-trace" };
  const first = await call("POST", "/v1/foundation/proofs", "user-a-token", headers, { label: "traced" });
  assert.equal(first.statusCode, 201, first.body);
  const replay = await call("POST", "/v1/foundation/proofs", "user-a-token", { ...headers, "x-correlation-id": "corr-d15-replay" }, { label: "traced" });
  assert.equal(replay.statusCode, 201);

  const proofType = "com.subrevos.foundation.proof_recorded.v1";
  const clock = () => NOW;
  const outboxStore = new PostgresOutboxStore({ connectionString: dispatcherUrl });
  const publisher = new PostgresEventPublisher({ routes: [{ consumer: "billing.projector", eventTypes: [proofType] }], clock, connectionString: dispatcherUrl });
  const deliveryStore = new PostgresOutboxStore({ connectionString: dispatcherUrl, queue: { kind: "delivery", consumer: "billing.projector" } });
  const inbox = new PostgresInboxPersistence<{ readonly inbox: InboxStore }>({ connectionString: appUrl, unitOfWork: () => ({}) });
  try {
    await createOutboxDispatcher({ store: outboxStore, publisher, clock, workerId: "trace_relay" })();
    const consume = createIdempotentConsumer({ consumer: "billing.projector", persistence: inbox, clock, handle: async () => {} });
    const report = await createDeliveryWorker({ store: deliveryStore, consume, clock, workerId: "trace_billing", queueName: "billing.projector" })();
    assert.equal(report.published, 1);
  } finally {
    await Promise.all([outboxStore.close(), publisher.close(), deliveryStore.close(), inbox.close()]);
  }

  const spans = finishedSpans();
  const server = spans.find((span) => span.name === "POST /v1/foundation/proofs" && span.attributes["sintius.correlation_id"] === "corr-d15-trace");
  assert.ok(server, "the request produced a server span named by its route template");
  const trace = spans.filter((span) => span.spanContext().traceId === server.spanContext().traceId);
  const named = (name: string) => {
    const found = trace.find((span) => span.name === name);
    assert.ok(found, `${name} is in the request's trace; trace has ${trace.map((span) => span.name).join(", ")}`);
    return found;
  };
  const command = named("command foundation.proof.record");
  const outboxHandOver = named(`outbox hand-over ${proofType}`);
  const deliveryHandOver = named(`billing.projector hand-over ${proofType}`);
  const consumed = named(`consume ${proofType}`);
  const parentOf = (span: typeof server) => span.parentSpanContext?.spanId;
  assert.equal(parentOf(command), server.spanContext().spanId, "the command runs under the request");
  assert.equal(parentOf(outboxHandOver), command.spanContext().spanId, "dispatch continues the trace stored with the outbox entry");
  assert.equal(parentOf(deliveryHandOver), outboxHandOver.spanContext().spanId, "delivery continues the trace stored with the delivery");
  assert.equal(parentOf(consumed), deliveryHandOver.spanContext().spanId);

  assert.deepEqual(command.events.map((event) => [event.name, event.attributes?.["sintius.audit.action"]]), [["audit.recorded", "foundation.proof_recorded"]]);
  assert.equal(command.attributes["sintius.idempotency.outcome"], "executed");
  assert.deepEqual(
    [server, command, outboxHandOver, deliveryHandOver, consumed].map((span) => span.attributes["sintius.correlation_id"]),
    ["corr-d15-trace", "corr-d15-trace", "corr-d15-trace", "corr-d15-trace", "corr-d15-trace"],
  );
  assert.equal(server.attributes["http.route"], "/v1/foundation/proofs");
  assert.equal(server.attributes["http.response.status_code"], 201);

  const replayCommand = spans.find((span) => span.name === "command foundation.proof.record" && span.attributes["sintius.correlation_id"] === "corr-d15-replay");
  assert.equal(replayCommand?.attributes["sintius.idempotency.outcome"], "replayed");
  assert.equal(await metricValue("sintius.idempotency.requests", { "sintius.command.scope": "foundation.proof.record", "sintius.idempotency.outcome": "executed" }) - executedBefore, 1);
  assert.equal(await metricValue("sintius.idempotency.requests", { "sintius.command.scope": "foundation.proof.record", "sintius.idempotency.outcome": "replayed" }) - replayedBefore, 1);

  const serialized = serializedTelemetry(spans);
  assert.doesNotMatch(serialized, /user-a-token|Bearer/, "the credential never reaches telemetry");
  assert.doesNotMatch(serialized, /tenant_http_pg_A/, "tenant identifiers are not span attributes");
});

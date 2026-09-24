import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PlatformProblem } from "../../problem-model/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import {
  TenantScopedCache,
  defineTenantCommand,
  inTenantTransaction,
  resolveTenantContext,
  runWithTenantContext,
  tenantId,
  type KeyValueStore,
  type TenantId,
  type TenantTransactionAdapter,
} from "../../tenant-context/src/index.ts";
import { buildEventEnvelope, type BuildEventInput } from "../src/index.ts";

const repoRoot = resolve(import.meta.dirname, "../../..");
const schema = JSON.parse(
  readFileSync(resolve(repoRoot, "docs/pre-implementation/contracts/events/envelope.schema.json"), "utf8"),
) as {
  required: string[];
  properties: Record<string, { pattern?: string; enum?: string[]; const?: string }>;
  additionalProperties: boolean;
};

const tenantA = tenantId("tenant_A");
const recordedAt = new Date("2026-09-24T10:00:00.000Z");
const dependencies = { newEventId: () => "evt_fixed_1", clock: () => recordedAt };

function contextFor(tenant: TenantId, options: { kind?: "interactive" | "workload"; causationId?: string } = {}) {
  const kind = options.kind ?? "interactive";
  return resolveTenantContext({
    principal: testPrincipal([tenant], { actor: kind === "workload" ? "svc_billing" : "user_1", kind }),
    selectedTenantId: tenant,
    tenantState: "ACTIVE",
    correlationId: "corr_evt_1",
    ...(options.causationId === undefined ? {} : { causationId: options.causationId }),
  });
}

function input(overrides: Partial<BuildEventInput> = {}): BuildEventInput {
  return {
    eventType: "tenant.activated.v1",
    sourceContext: "identity-tenant",
    aggregateType: "Tenant",
    aggregateId: "tenant_A",
    aggregateVersion: 2,
    occurredAt: new Date("2026-09-24T09:59:59.500Z"),
    classification: "CONFIDENTIAL_BUSINESS",
    data: { previous_state: "PROVISIONING", new_state: "ACTIVE" },
    ...overrides,
  };
}

function build(overrides: Partial<BuildEventInput> = {}, kind: "interactive" | "workload" = "interactive", causationId?: string) {
  return runWithTenantContext(contextFor(tenantA, { kind, ...(causationId === undefined ? {} : { causationId }) }), () =>
    buildEventEnvelope(input(overrides), dependencies),
  );
}

function isProblem(code: string) {
  return (error: unknown): boolean => error instanceof PlatformProblem && error.problem.code === code;
}

test("the envelope conforms to the published event envelope schema", () => {
  const envelope = build({ dataschema: "https://schemas.example.com/events/tenant.activated.v1.json", subject: "tenant/tenant_A" }, "interactive", "cmd_9");
  const keys = Object.keys(envelope);
  for (const required of schema.required) assert.ok(keys.includes(required), `missing required field ${required}`);
  if (schema.additionalProperties === false) {
    for (const key of keys) assert.ok(key in schema.properties, `field ${key} is not in the schema`);
  }
  assert.match(envelope.type, new RegExp(schema.properties.type?.pattern as string));
  assert.equal(envelope.specversion, schema.properties.specversion?.const);
  assert.equal(envelope.datacontenttype, schema.properties.datacontenttype?.const);
  assert.ok((schema.properties.data_classification?.enum as string[]).includes(envelope.data_classification));
  assert.deepEqual(Object.keys(envelope.actor).sort(), ["delegated_by", "id", "type"]);
  assert.ok((schema.properties.actor as unknown as { properties: { type: { enum: string[] } } }).properties.type.enum.includes(envelope.actor.type));
  assert.ok(Number.isInteger(envelope.aggregate_version) && envelope.aggregate_version >= 1);
  assert.equal(new Date(envelope.time).toISOString(), envelope.time);
  assert.equal(new Date(envelope.occurred_at).toISOString(), envelope.occurred_at);
});

test("tenant, actor, correlation and causation come only from the trusted context", () => {
  const envelope = build({}, "interactive", "cmd_9");
  assert.equal(envelope.tenant_id, "tenant_A");
  assert.equal(envelope.correlation_id, "corr_evt_1");
  assert.equal(envelope.causation_id, "cmd_9");
  assert.deepEqual(envelope.actor, { type: "USER", id: "user_1", delegated_by: null });
  assert.equal(envelope.source, "urn:sub-rev-os:tenant:tenant_A:context:identity-tenant");
  assert.equal(envelope.type, "com.subrevos.tenant.activated.v1");
  assert.equal(envelope.id, "evt_fixed_1");
  assert.equal(envelope.time, envelope.recorded_at);
  assert.equal(envelope.recorded_at, "2026-09-24T10:00:00.000Z");
  assert.equal(envelope.occurred_at, "2026-09-24T09:59:59.500Z");

  assert.equal(build().causation_id, null);
  assert.equal(build({}, "workload").actor.type, "SERVICE");
  assert.equal(build({}, "workload").actor.id, "svc_billing");
});

test("building an envelope fails closed without a trusted context", () => {
  assert.throws(() => buildEventEnvelope(input(), dependencies), isProblem("tenant_context_missing"));
});

test("payloads that restate tenant identity are rejected", () => {
  for (const data of [{ tenantId: "tenant_B" }, { tenant_id: "tenant_A" }, { outer: { list: [{ TenantId: "x" }] } }]) {
    assert.throws(() => build({ data }), isProblem("tenant_context_mismatch"));
  }
});

test("invalid event metadata and non-JSON payloads are rejected", () => {
  const rejected: Array<Partial<BuildEventInput>> = [
    { eventType: "tenant.activated" },
    { eventType: "Tenant.Activated.v1" },
    { eventType: "a.b.c.v1" },
    { sourceContext: "Identity Tenant" },
    { classification: "SECRET" as never },
    { aggregateVersion: 0 },
    { aggregateVersion: 1.5 },
    { aggregateType: " " },
    { aggregateId: "" },
    { data: [] as never },
    { data: null as never },
    { data: { value: Number.NaN } },
    { data: { value: undefined } },
    { data: { value: () => 1 } },
    { data: { value: 10n } },
    { data: { when: new Date() } },
  ];
  for (const overrides of rejected) assert.throws(() => build(overrides), isProblem("invalid_trusted_context"), JSON.stringify(Object.keys(overrides)));
});

test("timestamps must be valid and an event cannot occur after it is recorded", () => {
  assert.throws(() => build({ occurredAt: new Date("not a date") }), isProblem("invalid_timestamp"));
  assert.throws(() => build({ occurredAt: new Date("2026-09-24T10:00:00.001Z") }), isProblem("invalid_timestamp"));
  assert.doesNotThrow(() => build({ occurredAt: recordedAt }));
});

test("the envelope is immutable and isolated from later changes to the input payload", () => {
  const data = { nested: { values: [1, 2, 3] } };
  const envelope = build({ data });
  data.nested.values.push(4);
  assert.deepEqual(envelope.data, { nested: { values: [1, 2, 3] } });
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.actor), true);
  assert.equal(Object.isFrozen(envelope.data), true);
  assert.equal(Object.isFrozen((envelope.data as { nested: { values: number[] } }).nested.values), true);
  assert.throws(() => {
    (envelope as { tenant_id: string }).tenant_id = "tenant_B";
  }, TypeError);
});

test("event identifiers are unique by default and injectable for determinism", () => {
  const context = contextFor(tenantA);
  const [first, second] = runWithTenantContext(context, () => [
    buildEventEnvelope(input({ occurredAt: new Date("2020-01-01T00:00:00.000Z") })),
    buildEventEnvelope(input({ occurredAt: new Date("2020-01-01T00:00:00.000Z") })),
  ]) as [
    ReturnType<typeof buildEventEnvelope>,
    ReturnType<typeof buildEventEnvelope>,
  ];
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^evt_[0-9a-f-]{36}$/);
});

test("one trusted tenant reaches the command, transaction, cache and event envelope together", async () => {
  const bound: string[] = [];
  const adapter: TenantTransactionAdapter = {
    begin: async (scope) => {
      bound.push(scope.tenantId);
      return { tenantId: scope.tenantId, commit: async () => undefined, rollback: async () => undefined };
    },
  };
  const entries = new Map<string, string>();
  const store: KeyValueStore<string> = {
    get: async (key) => entries.get(key),
    set: async (key, value) => void entries.set(key, value),
    delete: async (key) => void entries.delete(key),
  };
  const cache = new TenantScopedCache<string>(store, "identity-tenant");

  const activate = defineTenantCommand<{ readonly reason: string }, ReturnType<typeof buildEventEnvelope>>(async (context, command) =>
    inTenantTransaction(adapter, async (transaction) => {
      await cache.set(["tenant-state"], "ACTIVE");
      const envelope = buildEventEnvelope(input({ data: { reason: command.reason, bound_tenant: transaction.tenantId } }), dependencies);
      assert.equal(envelope.tenant_id, context.tenantId);
      return envelope;
    }),
  );

  const results = [];
  for (const tenant of [tenantId("tenant_A"), tenantId("tenant_B")]) {
    results.push(await runWithTenantContext(contextFor(tenant), () => activate({ reason: "onboarding complete" })));
  }

  assert.deepEqual(bound, ["tenant_A", "tenant_B"]);
  assert.deepEqual([...entries.keys()].sort(), ["tenant:tenant_A:identity-tenant:tenant-state", "tenant:tenant_B:identity-tenant:tenant-state"]);
  assert.deepEqual(results.map((envelope) => envelope.tenant_id), ["tenant_A", "tenant_B"]);
  assert.deepEqual(results.map((envelope) => envelope.data.bound_tenant), ["tenant_A", "tenant_B"]);
  assert.equal(new Set(results.map((envelope) => envelope.correlation_id)).size, 1);
});

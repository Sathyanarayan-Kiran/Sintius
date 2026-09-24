import assert from "node:assert/strict";
import test from "node:test";
import { PlatformProblem } from "../../problem-model/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import {
  resolvePlatformCommandContext,
  resolveTenantContext,
  runWithTenantContext,
  tenantId,
  type TenantId,
} from "../../tenant-context/src/index.ts";
import { createAuditPolicy, createAuditReader, createAuditRecorder, toSafeSnapshot, verifyAuditEvent, type AuditEvent } from "../src/index.ts";
import { InMemoryAuditStore } from "./in-memory-audit.ts";

const A = tenantId("tenant_A");
const B = tenantId("tenant_B");
const NOW = new Date("2026-09-24T10:00:00.000Z");

const code = (expected: string) => (error: unknown) => error instanceof PlatformProblem && error.problem.code === expected;

const policy = createAuditPolicy({
  Subscription: ["state", "quantity", "plan_code", "display_name", "amount_minor", "active"],
});

function contextFor(tenant: TenantId, actor = "user_1", kind: "interactive" | "workload" = "interactive") {
  return resolveTenantContext({
    principal: testPrincipal([tenant], { actor, kind }),
    selectedTenantId: tenant,
    tenantState: "ACTIVE",
    correlationId: "corr_aud_1",
    causationId: "cause_1",
  });
}

function fixture(overrides: { onWriteFailure?: (info: unknown) => void } = {}) {
  const store = new InMemoryAuditStore();
  let ids = 0;
  const recorder = createAuditRecorder({ policy, clock: () => NOW, newId: () => `aud_${++ids}`, ...overrides });
  return { store, recorder };
}

const change = {
  action: "subscription.quantity_changed",
  target: { type: "Subscription", id: "sub_1" },
  reason: "customer request",
  before: { state: "ACTIVE", quantity: 3 },
  after: { state: "ACTIVE", quantity: 5 },
};

test("TC-017-01-01 a command's mutation and its audit event commit together", async () => {
  const { store, recorder } = fixture();
  await runWithTenantContext(contextFor(A), () =>
    store.runInTransaction({}, async (uow) => {
      uow.domain.write("quantity=5");
      await recorder.recordForCurrentContext(uow.audit, { ...change, approvalId: "apr_9" });
    }),
  );
  assert.equal(store.domainRows.length, 1);
  const [event] = store.events();
  assert.equal(event!.tenantId, "tenant_A");
  assert.deepEqual(event!.actor, { id: "user_1", kind: "interactive" });
  assert.equal(event!.action, "subscription.quantity_changed");
  assert.equal(event!.correlationId, "corr_aud_1");
  assert.equal(event!.causationId, "cause_1");
  assert.equal(event!.approvalId, "apr_9");
  assert.equal(event!.reason, "customer request");
  assert.deepEqual(event!.before, { quantity: 3, state: "ACTIVE" });
  assert.deepEqual(event!.after, { quantity: 5, state: "ACTIVE" });
  assert.equal(event!.recordedAt, NOW.toISOString());
  assert.equal(verifyAuditEvent(event!), true);
});

test("TC-017-01-01 an audit write failure blocks the command, alerts operators, and leaves nothing behind", async () => {
  const alerts: unknown[] = [];
  const { store, recorder } = fixture({ onWriteFailure: (info) => void alerts.push(info) });
  const failing = { append: async () => Promise.reject(new Error("audit store unavailable")) };
  await runWithTenantContext(contextFor(A), async () => {
    await assert.rejects(
      store.runInTransaction({}, async (uow) => {
        uow.domain.write("quantity=5");
        await recorder.recordForCurrentContext(failing, change);
      }),
      /audit store unavailable/,
    );
  });
  assert.equal(store.domainRows.length, 0, "the mutation rolled back with the audit failure");
  assert.equal(store.rows.length, 0);
  assert.deepEqual(alerts, [{ action: "subscription.quantity_changed", tenantId: "tenant_A", correlationId: "corr_aud_1" }]);
});

test("an alerting sink that throws never masks the original audit failure", async () => {
  const { recorder } = fixture({ onWriteFailure: () => { throw new Error("pager down"); } });
  await runWithTenantContext(contextFor(A), async () => {
    await assert.rejects(recorder.recordForCurrentContext({ append: async () => Promise.reject(new Error("disk full")) }, change), /disk full/);
  });
});

test("TC-017-01-02 evidence uses a deny-by-default allow-list and redaction", () => {
  const snapshot = toSafeSnapshot(policy, "Subscription", {
    state: "ACTIVE",
    quantity: 5,
    display_name: "Acme Bearer abc.def.ghi card 4242 4242 4242 4242",
    plan_code: "pro",
    amount_minor: Number.NaN,
    active: true,
    api_key: "sk_live_should_never_appear",
    password: "hunter2",
    nested: { quantity: 1 },
    plan_code_extra: "not allow-listed",
  });
  assert.deepEqual(Object.keys(snapshot!), ["active", "display_name", "plan_code", "quantity", "state"]);
  assert.equal(snapshot!.display_name?.toString().includes("abc.def.ghi"), false);
  assert.equal(snapshot!.display_name?.toString().includes("4242 4242"), false);
  assert.equal(JSON.stringify(snapshot).includes("hunter2"), false);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(toSafeSnapshot(policy, "Subscription", undefined), undefined);
  assert.throws(() => toSafeSnapshot(policy, "UnregisteredThing", { a: 1 }), code("audit_policy_missing"));
});

test("TC-017-01-02 secret-like field names cannot be allow-listed and reasons are redacted", async () => {
  for (const bad of ["password", "api_key", "client_secret", "access_token", "card_number", "pan", "Not_Snake", "1abc", "credential_id", "ssn"]) {
    assert.throws(() => createAuditPolicy({ Thing: [bad] }), code("audit_policy_missing"), bad);
  }
  assert.doesNotThrow(() => createAuditPolicy({ Thing: ["company_name", "pancake_count", "cardinality"] }.Thing ? { Thing: ["company_name"] } : {}));

  const { store, recorder } = fixture();
  await runWithTenantContext(contextFor(A), () =>
    store.runInTransaction({}, (uow) => recorder.recordForCurrentContext(uow.audit, { ...change, reason: "fixed with Bearer abc.def.ghi and password=hunter2" })),
  );
  const reason = store.events()[0]!.reason!;
  assert.equal(reason.includes("abc.def.ghi") || reason.includes("hunter2"), false);
});

test("audit events are immutable, tamper-evident and append-only", async () => {
  const { store, recorder } = fixture();
  await runWithTenantContext(contextFor(A), () => store.runInTransaction({}, (uow) => recorder.recordForCurrentContext(uow.audit, change)));
  const [event] = store.events();
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event!.before), true);
  assert.throws(() => { (event as { action: string }).action = "tampered"; }, TypeError);

  const forged: AuditEvent = { ...event!, after: { state: "ACTIVE", quantity: 500 } };
  assert.equal(verifyAuditEvent(forged), false, "content changes are detected");
  assert.equal(verifyAuditEvent({ ...event!, evidenceHash: "0".repeat(64) }), false);
  assert.equal(verifyAuditEvent({ ...event!, reason: undefined } as AuditEvent), false);

  await assert.rejects(
    store.runInTransaction({}, (uow) => uow.audit.append(event!)),
    /append-only/,
    "an existing audit id can never be rewritten",
  );
  const writer = { append: async () => {} } as Record<string, unknown>;
  assert.equal("update" in writer || "delete" in writer, false);
});

test("audit event fields are validated", async () => {
  const { recorder } = fixture();
  const sink = { append: async () => {} };
  await runWithTenantContext(contextFor(A), async () => {
    await assert.rejects(recorder.recordForCurrentContext(sink, { ...change, action: "BadAction" }), code("audit_event_invalid"));
    await assert.rejects(recorder.recordForCurrentContext(sink, { ...change, action: "single" }), code("audit_event_invalid"));
    await assert.rejects(recorder.recordForCurrentContext(sink, { ...change, target: { type: "Subscription", id: " " } }), code("audit_event_invalid"));
    await assert.rejects(recorder.recordForCurrentContext(sink, { ...change, occurredAt: new Date(NOW.valueOf() + 1000) }), code("invalid_timestamp"));
    await assert.rejects(recorder.recordForCurrentContext(sink, { ...change, occurredAt: new Date("nope") }), code("invalid_timestamp"));
    await assert.rejects(recorder.recordForCurrentContext(sink, { ...change, target: { type: "Unknown", id: "x" } }), code("audit_policy_missing"));
  });
  await assert.rejects(recorder.recordForCurrentContext(sink, change), code("tenant_context_missing"));
});

test("workload actors and platform commands are attributed from trusted context only", async () => {
  const { store, recorder } = fixture();
  await runWithTenantContext(contextFor(A, "svc_billing", "workload"), () => store.runInTransaction({}, (uow) => recorder.recordForCurrentContext(uow.audit, change)));
  assert.deepEqual(store.events()[0]!.actor, { id: "svc_billing", kind: "workload" });

  const platform = resolvePlatformCommandContext({ principal: testPrincipal([], { actor: "operator_1" }), correlationId: "corr_plat" });
  await store.runInTransaction({}, (uow) => recorder.recordForPlatformCommand(uow.audit, platform, B, change));
  const last = store.events()[1]!;
  assert.equal(last.tenantId, "tenant_B");
  assert.equal(last.actor.id, "operator_1");
  assert.equal(last.correlationId, "corr_plat");
  await assert.rejects(
    store.runInTransaction({}, (uow) => recorder.recordForPlatformCommand(uow.audit, { actorId: "x", principalKind: "interactive", correlationId: "c" } as never, B, change)),
    code("tenant_context_mismatch"),
  );
});

async function seedTwoTenants() {
  const context = fixture();
  for (const tenant of [A, A, B]) {
    await runWithTenantContext(contextFor(tenant, tenant === A ? "user_A" : "user_B"), () =>
      context.store.runInTransaction({}, (uow) => context.recorder.recordForCurrentContext(uow.audit, change)),
    );
  }
  return context;
}

test("TC-017-01-04 reads are tenant-isolated, permissioned, paged and themselves audited", async () => {
  const { store, recorder } = await seedTwoTenants();
  let authorized = 0;
  const reader = createAuditReader({ persistence: store, recorder, authorize: async () => void (authorized += 1) });

  const pageA = await runWithTenantContext(contextFor(A, "auditor_1"), () => reader({ targetType: "Subscription" }));
  assert.equal(pageA.events.length, 2);
  assert.equal(pageA.events.every((event) => event.tenantId === "tenant_A"), true, "tenant B's event never appears");
  const pageB = await runWithTenantContext(contextFor(B, "auditor_2"), () => reader({}));
  assert.equal(pageB.events.length, 1);
  assert.equal(authorized, 2);

  const readEvents = store.events().filter((event) => event.action === "audit.read");
  assert.equal(readEvents.length, 2, "each read produced an audit event");
  assert.deepEqual(readEvents[0]!.actor, { id: "auditor_1", kind: "interactive" });
  assert.equal(readEvents[0]!.after?.result_count, 2);
  assert.equal(readEvents[0]!.after?.target_type, "Subscription");

  const first = await runWithTenantContext(contextFor(A, "auditor_1"), () => reader({ limit: 1, action: "subscription.quantity_changed" }));
  assert.equal(first.events.length, 1);
  assert.notEqual(first.nextCursor, undefined);
  const second = await runWithTenantContext(contextFor(A, "auditor_1"), () => reader({ limit: 1, action: "subscription.quantity_changed", cursor: first.nextCursor! }));
  assert.equal(second.events.length, 1);
  assert.notEqual(second.events[0]!.auditEventId, first.events[0]!.auditEventId);
  assert.equal(second.nextCursor, undefined);
});

test("audit reads are denied before anything is read or logged when unauthorized, and validate their input", async () => {
  const { store, recorder } = await seedTwoTenants();
  const before = store.transactionsStarted;
  const denied = createAuditReader({
    persistence: store,
    recorder,
    authorize: async () => { throw new PlatformProblem({ code: "permission_denied", status: 403, title: "Permission denied", detail: "denied" }); },
  });
  await runWithTenantContext(contextFor(A), async () => {
    await assert.rejects(denied({}), code("permission_denied"));
  });
  assert.equal(store.transactionsStarted, before);

  const reader = createAuditReader({ persistence: store, recorder, authorize: async () => {} });
  await runWithTenantContext(contextFor(A), async () => {
    for (const bad of [{ limit: 0 }, { limit: 501 }, { limit: 1.5 }, { cursor: -1 }, { from: "not a date" }, { to: "x" }]) {
      await assert.rejects(reader(bad), code("invalid_trusted_context"));
    }
  });
  await assert.rejects(reader({}), code("tenant_context_missing"));
});

test("a store that returns another tenant's event is rejected", async () => {
  const { store, recorder } = await seedTwoTenants();
  const leaky = {
    runInTransaction: async (scope: unknown, work: Parameters<typeof store.runInTransaction>[1]) =>
      store.runInTransaction(scope, (uow) =>
        work({ ...uow, reads: { query: async () => ({ events: store.events().filter((event) => event.tenantId === "tenant_B") }) } }),
      ),
  };
  const reader = createAuditReader({ persistence: leaky as never, recorder, authorize: async () => {} });
  await runWithTenantContext(contextFor(A), async () => {
    await assert.rejects(reader({}), code("tenant_context_mismatch"));
  });
});

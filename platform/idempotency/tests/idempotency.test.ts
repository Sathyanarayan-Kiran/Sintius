import assert from "node:assert/strict";
import test from "node:test";
import { PlatformProblem, problem } from "../../problem-model/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import { resolveTenantContext, runWithTenantContext, tenantId, type TenantId } from "../../tenant-context/src/index.ts";
import {
  canonicalJson,
  canonicalRequestHash,
  createIdempotentExecutor,
  type IdempotencyPersistence,
  type StoredResponse,
} from "../src/index.ts";
import { InMemoryIdempotentPersistence, type TestUnitOfWork } from "./in-memory-idempotency.ts";

const A = tenantId("tenant_A");
const B = tenantId("tenant_B");
const KEY = "8f14e45f-ceea-467f-a0e6-1c2d3e4f5a6b";
const SCOPE = "subscription.change_quantity";
const NOW = new Date("2026-09-24T10:00:00.000Z");
const DAY = 24 * 3600 * 1000;

const code = (expected: string) => (error: unknown) => error instanceof PlatformProblem && error.problem.code === expected;

function contextFor(tenant: TenantId, actor = "user_1") {
  return resolveTenantContext({
    principal: testPrincipal([tenant], { actor }),
    selectedTenantId: tenant,
    tenantState: "ACTIVE",
    correlationId: "corr_idem_1",
  });
}

function fixture(options: { now?: () => Date; retentionSeconds?: number } = {}) {
  const persistence = new InMemoryIdempotentPersistence();
  const execute = createIdempotentExecutor({
    persistence,
    clock: options.now ?? (() => NOW),
    ...(options.retentionSeconds === undefined ? {} : { retentionSeconds: options.retentionSeconds }),
  });
  let runs = 0;
  const allow = async () => {};
  const work = (label = "effect") => async (uow: TestUnitOfWork): Promise<StoredResponse> => {
    runs += 1;
    uow.effects.record(`${label}#${runs}`);
    uow.outbox.append(`event#${runs}`);
    return { status: 201, body: { id: `res_${runs}`, quantity: 5 } };
  };
  return { persistence, execute, allow, work, runs: () => runs };
}

const request = (payload: unknown = { subscription_id: "sub_1", quantity: 5 }, key: string | undefined = KEY, scope = SCOPE) => ({
  scope,
  key,
  payload: payload as never,
});

test("TC-001-02-01 canonical hashing is deterministic and rejects non-JSON input", () => {
  assert.equal(canonicalRequestHash(SCOPE, { a: 1, b: { c: [1, 2], d: null } }), canonicalRequestHash(SCOPE, { b: { d: null, c: [1, 2] }, a: 1 }));
  assert.equal(canonicalRequestHash(SCOPE, { a: 1, skipped: undefined }), canonicalRequestHash(SCOPE, { a: 1 }));
  assert.equal(canonicalJson(-0), "0");
  assert.match(canonicalRequestHash(SCOPE, {}), /^[0-9a-f]{64}$/);
  assert.notEqual(canonicalRequestHash(SCOPE, { a: [1, 2] }), canonicalRequestHash(SCOPE, { a: [2, 1] }));
  assert.notEqual(canonicalRequestHash(SCOPE, { a: 1 }), canonicalRequestHash("other.scope", { a: 1 }));
  assert.notEqual(canonicalRequestHash(SCOPE, { a: "1" }), canonicalRequestHash(SCOPE, { a: 1 }));
  class Custom {}
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 10n, new Date(), new Custom(), () => 1, cycle]) {
    assert.throws(() => canonicalJson({ bad }), code("invalid_trusted_context"));
  }
});

test("TC-001-02-01 an identical retry replays the original response with exactly one effect", async () => {
  const { persistence, execute, allow, work, runs } = fixture();
  const first = await runWithTenantContext(contextFor(A), () => execute(request(), allow, work()));
  const second = await runWithTenantContext(contextFor(A), () => execute(request({ quantity: 5, subscription_id: "sub_1" }), allow, work()));

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.deepEqual(second.response, first.response);
  assert.equal(second.response.status, 201);
  assert.equal(Object.isFrozen(second.response) && Object.isFrozen(second.response.body), true);
  assert.equal(runs(), 1, "the protected command ran once");
  assert.equal(persistence.effects.length, 1);
  assert.equal(persistence.outbox.length, 1, "the command's event is persisted exactly once");
});

test("TC-001-02-01 reusing a key with a different payload is a 409 and leaves the original intact", async () => {
  const { persistence, execute, allow, work, runs } = fixture();
  const original = await runWithTenantContext(contextFor(A), () => execute(request(), allow, work()));
  await runWithTenantContext(contextFor(A), async () => {
    await assert.rejects(execute(request({ subscription_id: "sub_1", quantity: 9 }), allow, work()), (error: unknown) => {
      assert.ok(error instanceof PlatformProblem);
      assert.equal(error.problem.code, "idempotency_key_reused_with_different_payload");
      assert.equal(error.problem.status, 409);
      assert.equal(error.problem.correlation_id, "corr_idem_1");
      return true;
    });
    const again = await execute(request(), allow, work());
    assert.deepEqual(again.response, original.response);
  });
  assert.equal(runs(), 1);
  assert.equal(persistence.effects.length, 1);
});

test("a failed transaction leaves no record, so the retry executes and succeeds once", async () => {
  const { persistence, execute, allow, work, runs } = fixture();
  await runWithTenantContext(contextFor(A), async () => {
    await assert.rejects(
      execute(request(), allow, async (uow) => {
        uow.effects.record("partial");
        uow.outbox.append("partial-event");
        throw new Error("downstream failure after a write");
      }),
      /downstream failure/,
    );
    assert.equal(persistence.records.size, 0);
    assert.equal(persistence.effects.length, 0);
    assert.equal(persistence.outbox.length, 0);

    const retry = await execute(request(), allow, work());
    assert.equal(retry.replayed, false);
    assert.equal((await execute(request(), allow, work())).replayed, true);
  });
  assert.equal(runs(), 1);
  assert.equal(persistence.effects.length, 1);
});

test("TC-001-02-02 a concurrent duplicate race produces one effect and identical responses", async () => {
  const { persistence, execute, allow, runs } = fixture();
  const slowWork = async (uow: TestUnitOfWork): Promise<StoredResponse> => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    uow.effects.record("charge");
    uow.outbox.append("charged");
    return { status: 201, body: { id: `res_${runs() + 1}` } };
  };
  let started = 0;
  const counted = async (uow: TestUnitOfWork) => {
    started += 1;
    return slowWork(uow);
  };
  const results = await Promise.all(
    Array.from({ length: 12 }, () => runWithTenantContext(contextFor(A), () => execute(request(), allow, counted))),
  );
  assert.equal(started, 1, "the effect ran once");
  assert.equal(results.filter((result) => !result.replayed).length, 1);
  assert.equal(results.filter((result) => result.replayed).length, 11);
  for (const result of results) assert.deepEqual(result.response, results[0]!.response);
  assert.deepEqual(persistence.effects, ["charge"]);
  assert.deepEqual(persistence.outbox, ["charged"]);
});

test("TC-001-02-02 concurrent requests with one key but different payloads: one wins, the other conflicts", async () => {
  const { persistence, execute, allow, work, runs } = fixture();
  const outcomes = await Promise.allSettled([
    runWithTenantContext(contextFor(A), () => execute(request({ quantity: 1 }), allow, work())),
    runWithTenantContext(contextFor(A), () => execute(request({ quantity: 2 }), allow, work())),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
  assert.ok(code("idempotency_key_reused_with_different_payload")(rejected.reason));
  assert.equal(runs(), 1);
  assert.equal(persistence.effects.length, 1);
});

test("TC-001-02-03 the same key is isolated between tenants and between command scopes", async () => {
  const { persistence, execute, allow, work, runs } = fixture();
  const forA = await runWithTenantContext(contextFor(A), () => execute(request(), allow, work()));
  const forB = await runWithTenantContext(contextFor(B), () => execute(request(), allow, work()));
  const otherScope = await runWithTenantContext(contextFor(A), () => execute(request(undefined, KEY, "invoice.finalize"), allow, work()));

  assert.equal(forA.replayed, false);
  assert.equal(forB.replayed, false, "tenant B never sees tenant A's record");
  assert.equal(otherScope.replayed, false, "the same key on another command does not collide");
  assert.notDeepEqual(forA.response, forB.response);
  assert.equal(runs(), 3);
  assert.equal(persistence.records.size, 3);
  // Each tenant still replays its own record.
  assert.equal((await runWithTenantContext(contextFor(B), () => execute(request(), allow, work()))).replayed, true);
});

test("the Idempotency-Key is mandatory and validated; nothing runs on invalid input", async () => {
  const { persistence, execute, allow, work } = fixture();
  await runWithTenantContext(contextFor(A), async () => {
    await assert.rejects(execute({ scope: SCOPE, key: undefined, payload: {} }, allow, work()), code("idempotency_key_required"));
    await assert.rejects(execute(request(undefined, ""), allow, work()), code("idempotency_key_required"));
    for (const bad of ["short", "has space in it 123456789", `${"a".repeat(129)}`, "bad/slash/in/key/123456"]) {
      await assert.rejects(execute(request(undefined, bad), allow, work()), code("idempotency_key_invalid"));
    }
    await assert.rejects(execute(request(undefined, KEY, "Bad Scope!"), allow, work()), code("invalid_trusted_context"));
    await assert.rejects(execute(request({ tenantId: "tenant_B", quantity: 1 }), allow, work()), code("untrusted_tenant_context"));
    await assert.rejects(execute(request({ nested: [{ TenantID: "tenant_B" }] }), allow, work()), code("untrusted_tenant_context"));
  });
  await assert.rejects(execute(request(), allow, work()), code("tenant_context_missing"));
  assert.equal(persistence.transactionsStarted, 0);
});

test("replay does not bypass current authorization", async () => {
  const { persistence, execute, allow, work, runs } = fixture();
  await runWithTenantContext(contextFor(A), () => execute(request(), allow, work()));
  const before = persistence.transactionsStarted;
  const deny = async () => {
    throw problem({ code: "permission_denied", detail: "denied" });
  };
  await runWithTenantContext(contextFor(A, "revoked_user"), async () => {
    await assert.rejects(execute(request(), deny, work()), code("permission_denied"));
  });
  assert.equal(persistence.transactionsStarted, before, "no lookup happens before authorization");
  assert.equal(runs(), 1);
});

test("records expire per retention policy; only expired rows are purged", async () => {
  let current = NOW;
  const { persistence, execute, allow, work, runs } = fixture({ now: () => current, retentionSeconds: 3600 });
  await runWithTenantContext(contextFor(A), () => execute(request(), allow, work()));
  await runWithTenantContext(contextFor(A), () => execute(request({ quantity: 6 }, "second-key-0123456789"), allow, work()));

  current = new Date(NOW.valueOf() + 1800 * 1000);
  assert.equal((await runWithTenantContext(contextFor(A), () => execute(request(), allow, work()))).replayed, true);
  assert.equal(await persistence.purgeExpired(current.toISOString()), 0);

  current = new Date(NOW.valueOf() + 3600 * 1000);
  assert.equal(await persistence.purgeExpired(current.toISOString()), 2);
  const afterExpiry = await runWithTenantContext(contextFor(A), () => execute(request(), allow, work()));
  assert.equal(afterExpiry.replayed, false, "an expired key can be used again");
  assert.equal(runs(), 3);
  assert.equal(new Date(persistence.records.values().next().value!.expiresAt).valueOf() - current.valueOf(), 3600 * 1000);
});

test("the default retention is seven days", async () => {
  const { persistence, execute, allow, work } = fixture();
  await runWithTenantContext(contextFor(A), () => execute(request(), allow, work()));
  const [record] = [...persistence.records.values()];
  assert.equal(Date.parse(record!.expiresAt) - NOW.valueOf(), 7 * DAY);
});

test("store anomalies fail closed: in-flight, half-written and cross-tenant records", async () => {
  const uowFor = (claim: () => Promise<never>): IdempotencyPersistence<TestUnitOfWork> => ({
    runInTransaction: async (_scope, work) =>
      work({ idempotency: { claim: claim as never, complete: async () => {} }, effects: { record() {} }, outbox: { append() {} } }),
  });
  const run = (claim: () => Promise<unknown>) =>
    runWithTenantContext(contextFor(A), () =>
      createIdempotentExecutor({ persistence: uowFor(claim as never), clock: () => NOW })(request(), async () => {}, async () => ({ status: 200, body: {} })),
    );
  const hash = canonicalRequestHash(SCOPE, { subscription_id: "sub_1", quantity: 5 });
  const base = { scope: SCOPE, key: KEY, requestHash: hash, createdAt: NOW.toISOString(), expiresAt: new Date(NOW.valueOf() + DAY).toISOString() };

  await assert.rejects(
    run(async () => ({ kind: "in_progress", retryAfterSeconds: 2 })),
    (error: unknown) => code("request_in_progress")(error) && (error as PlatformProblem).retryAfterSeconds === 2,
  );
  await assert.rejects(run(async () => ({ kind: "existing", record: { ...base, tenantId: A, status: "processing" } })), code("request_in_progress"));
  await assert.rejects(
    run(async () => ({ kind: "existing", record: { ...base, tenantId: B, status: "completed", response: { status: 200, body: {} } } })),
    code("tenant_context_mismatch"),
  );
});

test("invalid responses are rejected and roll back the whole transaction", async () => {
  const { persistence, execute, allow } = fixture();
  await runWithTenantContext(contextFor(A), async () => {
    await assert.rejects(execute(request(), allow, async (uow) => (uow.effects.record("x"), { status: 42, body: {} })), code("invalid_trusted_context"));
    await assert.rejects(execute(request(), allow, async (uow) => (uow.effects.record("y"), { status: 200, body: { when: new Date() } as never })), code("invalid_trusted_context"));
  });
  assert.equal(persistence.records.size, 0);
  assert.equal(persistence.effects.length, 0);
});

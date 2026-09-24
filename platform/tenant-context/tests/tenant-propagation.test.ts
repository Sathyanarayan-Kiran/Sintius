import assert from "node:assert/strict";
import test from "node:test";
import { PlatformProblem } from "../../problem-model/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import {
  InMemoryKeyValueStore,
  TenantScopedCache,
  actorId,
  currentTenantContext,
  defineTenantCommand,
  inTenantTransaction,
  resolveTenantContext,
  runWithTenantContext,
  tenantId,
  tenantScopedKey,
  withCausation,
  type KeyValueStore,
  type TenantContext,
  type TenantId,
  type TenantTransaction,
  type TenantTransactionAdapter,
  type TenantTransactionScope,
} from "../src/index.ts";

const tenantA = tenantId("tenant_A");
const tenantB = tenantId("tenant_B");

function principalFor(memberships: readonly TenantId[], actor = "user_1", kind: "interactive" | "workload" = "interactive") {
  return testPrincipal(memberships, { actor, kind });
}

function contextFor(tenant: TenantId, correlationId = "corr_1", actor = "user_1", causationId?: string) {
  return resolveTenantContext({
    principal: principalFor([tenantA, tenantB], actor),
    selectedTenantId: tenant,
    tenantState: "ACTIVE",
    correlationId,
    ...(causationId === undefined ? {} : { causationId }),
  });
}

function isProblem(code: string) {
  return (error: unknown): boolean => error instanceof PlatformProblem && error.problem.code === code;
}

class MemoryStore implements KeyValueStore<string> {
  readonly entries = new Map<string, string>();
  readonly ttls = new Map<string, number | undefined>();
  async get(key: string): Promise<string | undefined> {
    return this.entries.get(key);
  }
  async set(key: string, value: string, options?: { readonly ttlSeconds?: number }): Promise<void> {
    this.entries.set(key, value);
    this.ttls.set(key, options?.ttlSeconds);
  }
  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

class FakeTransactionAdapter implements TenantTransactionAdapter {
  readonly scopes: TenantTransactionScope[] = [];
  readonly log: string[] = [];
  bindTo: TenantId | undefined;
  async begin(scope: TenantTransactionScope): Promise<TenantTransaction> {
    this.scopes.push(scope);
    const bound = this.bindTo ?? scope.tenantId;
    this.log.push(`begin:${bound}`);
    return {
      tenantId: bound,
      commit: async () => void this.log.push("commit"),
      rollback: async () => void this.log.push("rollback"),
    };
  }
}

// --- Downstream context override attempts (TC-001-01-02 hardening) ------------------------------

test("a forged context literal cannot be activated", () => {
  const forged = Object.freeze({ tenantId: tenantB, actorId: actorId("user_1"), principalKind: "interactive" as const, correlationId: "corr_x" });
  assert.throws(() => runWithTenantContext(forged as TenantContext, () => "never"), isProblem("tenant_context_mismatch"));
  assert.throws(() => withCausation(forged as TenantContext, "cmd_1"), isProblem("tenant_context_mismatch"));
});

test("code running inside a tenant context cannot switch tenant or actor", () => {
  const contextA = contextFor(tenantA);
  const contextB = contextFor(tenantB);
  const otherActor = contextFor(tenantA, "corr_1", "user_2");
  runWithTenantContext(contextA, () => {
    assert.throws(() => runWithTenantContext(contextB, () => "never"), isProblem("tenant_context_mismatch"));
    assert.throws(() => runWithTenantContext(otherActor, () => "never"), isProblem("tenant_context_mismatch"));
    assert.equal(currentTenantContext().tenantId, tenantA);
    assert.equal(runWithTenantContext(contextA, () => currentTenantContext().tenantId), tenantA);
  });
});

test("a derived child context changes only the causation ID", async () => {
  const parent = contextFor(tenantA, "corr_7", "user_1", "cmd_parent");
  const child = withCausation(parent, "evt_9");
  assert.equal(child.tenantId, parent.tenantId);
  assert.equal(child.actorId, parent.actorId);
  assert.equal(child.correlationId, "corr_7");
  assert.equal(child.causationId, "evt_9");
  assert.equal(Object.isFrozen(child), true);
  assert.equal(parent.causationId, "cmd_parent");
  await runWithTenantContext(parent, async () => {
    await Promise.resolve();
    assert.equal(runWithTenantContext(child, () => currentTenantContext().causationId), "evt_9");
  });
  assert.throws(() => withCausation(parent, "  "), isProblem("invalid_trusted_context"));
});

test("tenant commands fail closed without context and reject any tenant identity in their input", async () => {
  const seen: string[] = [];
  const command = defineTenantCommand<{ readonly name: string; readonly nested?: unknown }, string>((context, input) => {
    seen.push(`${context.tenantId}:${input.name}`);
    return context.tenantId;
  });

  await assert.rejects(() => command({ name: "x" }), isProblem("tenant_context_missing"));

  const context = contextFor(tenantA, "corr_cmd");
  await runWithTenantContext(context, async () => {
    assert.equal(await command({ name: "ok", nested: { list: [{ safe: 1 }] } }), tenantA);
    const buried = (depth: number): unknown => (depth === 0 ? { tenantId: "tenant_B" } : { next: buried(depth - 1) });
    const attempts: object[] = [
      { name: "a", tenantId: "tenant_B" },
      { name: "b", tenant_id: "tenant_B" },
      { name: "c", TenantID: "tenant_B" },
      { name: "d", nested: { deep: { tenant_id: "tenant_B" } } },
      { name: "e", nested: [{ ok: true }, { "tenant-id": "tenant_B" }] },
      { name: "f", nested: buried(30) },
    ];
    for (const attempt of attempts) {
      await assert.rejects(
        () => command(attempt as { readonly name: string }),
        (error: unknown) => isProblem("untrusted_tenant_context")(error) && (error as PlatformProblem).problem.correlation_id === "corr_cmd",
      );
    }
    assert.throws(() => runWithTenantContext(contextFor(tenantB), () => "never"), isProblem("tenant_context_mismatch"));
  });
  assert.deepEqual(seen, ["tenant_A:ok"]);
});

// --- Cache namespaces ---------------------------------------------------------------------------

test("cache keys are namespaced by the trusted tenant and cannot collide or cross tenants", async () => {
  const store = new MemoryStore();
  const cache = new TenantScopedCache<string>(store, "catalog.plans");

  await runWithTenantContext(contextFor(tenantA), async () => {
    await cache.set(["plan", "p1"], "A-value", { ttlSeconds: 30 });
    assert.equal(await cache.get("plan", "p1"), "A-value");
  });
  await runWithTenantContext(contextFor(tenantB), async () => {
    assert.equal(await cache.get("plan", "p1"), undefined);
    await cache.set(["plan", "p1"], "B-value");
    await cache.delete("plan", "p1");
  });
  await runWithTenantContext(contextFor(tenantA), async () => {
    assert.equal(await cache.get("plan", "p1"), "A-value");
  });

  assert.deepEqual([...store.entries.keys()], ["tenant:tenant_A:catalog.plans:plan:p1"]);
  assert.equal(store.ttls.get("tenant:tenant_A:catalog.plans:plan:p1"), 30);

  await runWithTenantContext(contextFor(tenantA), async () => {
    assert.notEqual(tenantScopedKey("ns", "a:b"), tenantScopedKey("ns", "a", "b"));
    assert.equal(tenantScopedKey("ns", "tenant:tenant_B"), "tenant:tenant_A:ns:tenant%3Atenant_B");
  });
});

test("cache access fails closed without context and rejects malformed keys", async () => {
  const cache = new TenantScopedCache<string>(new MemoryStore(), "catalog");
  await assert.rejects(async () => cache.get("k"), isProblem("tenant_context_missing"));
  await runWithTenantContext(contextFor(tenantA), async () => {
    assert.throws(() => tenantScopedKey("Bad Namespace", "k"), isProblem("invalid_trusted_context"));
    assert.throws(() => tenantScopedKey("ns"), isProblem("invalid_trusted_context"));
    assert.throws(() => tenantScopedKey("ns", ""), isProblem("invalid_trusted_context"));
    assert.throws(() => tenantScopedKey("ns", "x".repeat(257)), isProblem("invalid_trusted_context"));
  });
});

// --- Transaction boundary port ------------------------------------------------------------------

test("transactions are bound to the trusted tenant, commit on success and roll back on failure", async () => {
  const adapter = new FakeTransactionAdapter();
  const context = contextFor(tenantA, "corr_tx", "user_1", "cmd_tx");

  const result = await runWithTenantContext(context, () => inTenantTransaction(adapter, async (tx) => tx.tenantId));
  assert.equal(result, tenantA);
  assert.deepEqual(adapter.scopes, [{ tenantId: tenantA, correlationId: "corr_tx", causationId: "cmd_tx" }]);
  assert.deepEqual(adapter.log, ["begin:tenant_A", "commit"]);

  adapter.log.length = 0;
  await assert.rejects(
    () => runWithTenantContext(context, () => inTenantTransaction(adapter, async () => { throw new Error("boom"); })),
    /boom/,
  );
  assert.deepEqual(adapter.log, ["begin:tenant_A", "rollback"]);

  await assert.rejects(() => inTenantTransaction(adapter, async () => "x"), isProblem("tenant_context_missing"));
});

test("an adapter that binds the wrong tenant is rolled back and rejected", async () => {
  const adapter = new FakeTransactionAdapter();
  adapter.bindTo = tenantB;
  await assert.rejects(
    () => runWithTenantContext(contextFor(tenantA), () => inTenantTransaction(adapter, async () => "never")),
    isProblem("tenant_context_mismatch"),
  );
  assert.deepEqual(adapter.log, ["begin:tenant_B", "rollback"]);
});

test("TC-001-01-03 the in-process cache adapter keeps tenants apart, expires, evicts and never shares mutable values", async () => {
  let now = 1_000_000;
  const store = new InMemoryKeyValueStore<{ readonly plans: string[] }>({ maxEntries: 3, clock: () => now });
  const cache = new TenantScopedCache(store, "catalog.plans");

  await runWithTenantContext(contextFor(tenantA), async () => {
    await cache.set(["list"], { plans: ["a1"] }, { ttlSeconds: 10 });
    const read = await cache.get("list");
    read!.plans.push("mutated");
    assert.deepEqual(await cache.get("list"), { plans: ["a1"] }, "a caller cannot mutate the cached value");
  });
  await runWithTenantContext(contextFor(tenantB), async () => {
    assert.equal(await cache.get("list"), undefined, "tenant B cannot read tenant A's entry");
    await cache.set(["list"], { plans: ["b1"] });
  });
  await runWithTenantContext(contextFor(tenantA), async () => {
    assert.deepEqual(await cache.get("list"), { plans: ["a1"] });
    now += 10_000;
    assert.equal(await cache.get("list"), undefined, "expired at its TTL");
    await cache.set(["x"], { plans: [] });
    await cache.set(["y"], { plans: [] });
    await cache.get("x");
    await cache.set(["z"], { plans: [] });
  });
  assert.equal(store.size, 3, "bounded to maxEntries");
  await runWithTenantContext(contextFor(tenantB), async () => {
    assert.equal(await cache.get("list"), undefined, "the least recently used entry (B's list) was evicted");
  });
  await runWithTenantContext(contextFor(tenantA), async () => {
    assert.deepEqual(await cache.get("x"), { plans: [] }, "a recently read entry survives eviction");
  });
  assert.throws(() => new InMemoryKeyValueStore({ maxEntries: 0 }), RangeError);
  await assert.rejects(store.set("k", { plans: [] }, { ttlSeconds: -1 }), RangeError);
});

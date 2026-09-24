import assert from "node:assert/strict";
import test from "node:test";
import { createAuditPolicy, createAuditRecorder, type AuditEvent } from "../../../platform/audit/src/index.ts";
import type { EventEnvelope } from "../../../platform/event-envelope/src/index.ts";
import type { IdempotencyRecord } from "../../../platform/idempotency/src/index.ts";
import { PlatformProblem, problem } from "../../../platform/problem-model/src/index.ts";
import { resolveTenantContext, runWithTenantContext, tenantId } from "../../../platform/tenant-context/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import { FOUNDATION_PROOF_AUDIT_FIELDS, createFoundationProofCommand } from "../application/proof-command.ts";
import type { FoundationProofPersistence, FoundationProofRecord, FoundationProofUnitOfWork } from "../application/ports.ts";
import { testIdempotencyKey } from "../../../tests/support/idempotency-key.ts";

const NOW = new Date("2026-09-24T10:00:00.000Z");

class InMemoryProofPersistence implements FoundationProofPersistence {
  committed = {
    records: [] as FoundationProofRecord[],
    audit: [] as AuditEvent[],
    outbox: [] as EventEnvelope[],
    idempotency: new Map<string, IdempotencyRecord>(),
  };
  transactionsStarted = 0;
  failAt: "record" | "audit" | "outbox" | undefined;

  async runInTransaction<T>(_scope: unknown, work: (unitOfWork: FoundationProofUnitOfWork) => Promise<T>): Promise<T> {
    this.transactionsStarted += 1;
    const staged = {
      records: [...this.committed.records],
      audit: [...this.committed.audit],
      outbox: [...this.committed.outbox],
      idempotency: new Map(this.committed.idempotency),
    };
    const fail = (point: typeof this.failAt) => {
      if (this.failAt === point) throw new Error(`injected ${point} failure`);
    };
    const unitOfWork: FoundationProofUnitOfWork = {
      idempotency: {
        claim: async (input) => {
          const key = `${input.tenantId}|${input.scope}|${input.key}`;
          const existing = staged.idempotency.get(key);
          if (existing !== undefined) return { kind: "existing" as const, record: existing };
          staged.idempotency.set(key, {
            tenantId: input.tenantId,
            scope: input.scope,
            key: input.key,
            requestHash: input.requestHash,
            status: "processing",
            createdAt: input.now,
            expiresAt: input.expiresAt,
          });
          return { kind: "claimed" as const };
        },
        complete: async (input) => {
          const key = `${input.tenantId}|${input.scope}|${input.key}`;
          const claimed = staged.idempotency.get(key);
          if (claimed === undefined || claimed.status !== "processing") throw new Error("complete without claim");
          staged.idempotency.set(key, { ...claimed, status: "completed", response: input.response });
        },
      },
      records: {
        insert: async (record) => {
          fail("record");
          staged.records.push(record);
        },
      },
      audit: {
        append: async (event) => {
          fail("audit");
          staged.audit.push(event);
        },
      },
      outbox: {
        append: async (event) => {
          fail("outbox");
          staged.outbox.push(event);
        },
      },
    };
    const result = await work(unitOfWork);
    this.committed = staged;
    return result;
  }
}

function tenantContext(id = "tenant_proof_A", actor = "proof_user_A") {
  const tenant = tenantId(id);
  return resolveTenantContext({
    principal: testPrincipal([tenant], { actor }),
    selectedTenantId: tenant,
    tenantState: "ACTIVE",
    correlationId: `corr_${id}`,
  });
}

function fixture(allowed = true) {
  const persistence = new InMemoryProofPersistence();
  let sequence = 0;
  const command = createFoundationProofCommand({
    persistence,
    authorizer: {
      assertPermission: async () => {
        if (!allowed) throw problem({ code: "permission_denied", detail: "Denied." });
      },
    },
    audit: createAuditRecorder({
      policy: createAuditPolicy(FOUNDATION_PROOF_AUDIT_FIELDS),
      clock: () => NOW,
      newId: () => `aud_proof_${++sequence}`,
    }),
    clock: () => NOW,
    newProofRecordId: () => `proof_record_${++sequence}`,
    newEventId: () => `evt_proof_${++sequence}`,
  });
  return { command, persistence };
}

const rejectsWith = (code: string) => (error: unknown) => error instanceof PlatformProblem && error.problem.code === code;

test("P0-010 exact retry returns the stored proof and commits one mutation, audit and event", async () => {
  const { command, persistence } = fixture();
  const metadata = { idempotencyKey: testIdempotencyKey("foundation-proof-replay-key-0001") };
  await runWithTenantContext(tenantContext(), async () => {
    const first = await command({ label: "phase-0-release-gate" }, metadata);
    const replay = await command({ label: "phase-0-release-gate" }, metadata);
    assert.deepEqual(replay, first);
  });
  assert.equal(persistence.committed.records.length, 1);
  assert.equal(persistence.committed.audit.length, 1);
  assert.equal(persistence.committed.outbox.length, 1);
  assert.equal(persistence.committed.idempotency.size, 1);
  assert.equal(persistence.committed.outbox[0]?.type, "com.subrevos.foundation.proof_recorded.v1");
});

test("P0-010 authorization precedes replay lookup and changed payloads conflict", async () => {
  const metadata = { idempotencyKey: testIdempotencyKey("foundation-proof-conflict-key-001") };
  const allowed = fixture();
  await runWithTenantContext(tenantContext(), async () => {
    await allowed.command({ label: "original" }, metadata);
    await assert.rejects(allowed.command({ label: "changed" }, metadata), rejectsWith("idempotency_key_reused_with_different_payload"));
  });

  const denied = createFoundationProofCommand({
    persistence: allowed.persistence,
    authorizer: { assertPermission: async () => { throw problem({ code: "permission_denied", detail: "Denied." }); } },
    audit: createAuditRecorder({ policy: createAuditPolicy(FOUNDATION_PROOF_AUDIT_FIELDS), clock: () => NOW }),
    clock: () => NOW,
  });
  const before = allowed.persistence.transactionsStarted;
  await runWithTenantContext(tenantContext(), async () => {
    await assert.rejects(denied({ label: "original" }, metadata), rejectsWith("permission_denied"));
  });
  assert.equal(allowed.persistence.transactionsStarted, before);
});

for (const point of ["record", "audit", "outbox"] as const) {
  test(`P0-010 ${point} failure rolls the entire proof transaction back`, async () => {
    const { command, persistence } = fixture();
    persistence.failAt = point;
    await runWithTenantContext(tenantContext(), async () => {
      await assert.rejects(command({ label: "rollback" }, { idempotencyKey: testIdempotencyKey(`foundation-proof-${point}-failure-0001`) }));
    });
    assert.equal(persistence.committed.records.length, 0);
    assert.equal(persistence.committed.audit.length, 0);
    assert.equal(persistence.committed.outbox.length, 0);
    assert.equal(persistence.committed.idempotency.size, 0);
  });
}

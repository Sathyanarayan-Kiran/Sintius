import assert from "node:assert/strict";
import test from "node:test";
import { PlatformProblem, problem } from "../../../platform/problem-model/src/index.ts";
import { testPrincipal } from "../../../tests/support/authenticated-principal.ts";
import { actorId, currentTenantContext, resolveTenantContext, runWithTenantContext, tenantId, type TenantId } from "../../../platform/tenant-context/src/index.ts";
import { createAuditPolicy, createAuditRecorder } from "../../../platform/audit/src/index.ts";
import { APPROVAL_AUDIT_FIELDS, createApprovalCommands } from "../application/approval-commands.ts";
import type { ApprovalAuthorizer } from "../application/approval-ports.ts";
import { cancelApproval, decideApproval, expireApproval, proposeApproval, type ApprovalPolicy, type ApprovalTarget } from "../domain/approval.ts";
import { InMemoryApprovalStore } from "./in-memory-approvals.ts";

const A = tenantId("tenant_A");
const B = tenantId("tenant_B");
const NOW = new Date("2026-09-24T10:00:00.000Z");
const HOUR = 3600 * 1000;

const denied = (code: string) => (error: unknown) => error instanceof PlatformProblem && error.problem.code === code;

const target: ApprovalTarget = { actionType: "pricing:rate_card:activate", targetType: "RateCard", targetId: "rc_1", targetVersion: 3 };

const policy = (overrides: Partial<ApprovalPolicy> = {}): ApprovalPolicy => ({
  tenantId: A,
  actionType: target.actionType,
  requiredApprovals: 1,
  separationOfDuties: true,
  expiresAfterSeconds: 3600,
  ...overrides,
});

function contextFor(
  tenant: TenantId,
  actor: string,
  options: { kind?: "interactive" | "workload"; assurance?: "single-factor" | "mfa" | "workload" } = {},
) {
  const kind = options.kind ?? "interactive";
  return resolveTenantContext({
    principal: testPrincipal([tenant], { actor, kind, ...(options.assurance === undefined ? {} : { assurance: options.assurance }) }),
    selectedTenantId: tenant,
    tenantState: "ACTIVE",
    correlationId: "corr_appr_1",
  });
}

/** Grants by actor and tenant, standing in for the tenant authorizer that is composed at the app root. */
function authorizerWith(grants: Record<string, readonly string[]>): ApprovalAuthorizer & { calls: string[] } {
  const calls: string[] = [];
  const holds = (permission: string) => {
    const context = currentTenantContext();
    return (grants[`${context.tenantId}:${context.actorId}`] ?? []).includes(permission);
  };
  return {
    calls,
    async assertPermission(permission: string) {
      calls.push(permission);
      if (!holds(permission)) throw problem({ code: "permission_denied", detail: "denied" });
    },
    async hasPermission(permission: string) {
      return holds(permission);
    },
  };
}

function fixture() {
  const store = new InMemoryApprovalStore();
  store.seedPolicy(policy());
  const authorizer = authorizerWith({
    "tenant_A:maker_1": ["approval:request:propose"],
    "tenant_A:checker_1": ["approval:request:decide"],
    "tenant_A:checker_2": ["approval:request:decide"],
    "tenant_A:dual": ["approval:request:propose", "approval:request:decide"],
    "tenant_A:svc_1": ["approval:request:decide"],
    "tenant_B:checker_B": ["approval:request:decide", "approval:request:propose"],
  });
  let ids = 0;
  let events = 0;
  const audit = createAuditRecorder({ policy: createAuditPolicy(APPROVAL_AUDIT_FIELDS), clock: () => NOW, newId: () => `aud_${++events}` });
  const commands = createApprovalCommands({ persistence: store, authorizer, audit, clock: () => NOW, newApprovalId: () => `apr_${++ids}`, newEventId: () => `evt_${++events}` });
  return { store, authorizer, commands };
}

const decision = (approvalId: string, expectedVersion = 1, overrides: Record<string, unknown> = {}) => ({
  approvalId,
  decision: "approve" as const,
  expectedVersion,
  target,
  ...overrides,
});

test("TC-002-03-02 aggregate: the maker cannot approve their own request when policy requires separation", () => {
  const request = proposeApproval({ ...target, id: "apr_1", policy: policy(), makerId: actorId("maker_1") }, NOW);
  assert.equal(request.status, "PENDING");
  const attempt = { approverId: actorId("maker_1"), decision: "approve" as const, expectedVersion: 1, target };
  assert.throws(() => decideApproval(request, attempt, NOW), denied("separation_of_duties_violation"));
  const approved = decideApproval(request, { ...attempt, approverId: actorId("checker_1") }, NOW);
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.version, 2);
  const relaxed = proposeApproval({ ...target, id: "apr_2", policy: policy({ separationOfDuties: false }), makerId: actorId("maker_1") }, NOW);
  assert.equal(decideApproval(relaxed, attempt, NOW).status, "APPROVED");
});

test("TC-002-03-02 aggregate: distinct approvers, terminal states, expiry, stale versions and target mismatch", () => {
  const request = proposeApproval({ ...target, id: "apr_1", policy: policy({ requiredApprovals: 2 }), makerId: actorId("maker_1") }, NOW);
  const by = (approver: string, extra: Record<string, unknown> = {}) => ({ approverId: actorId(approver), decision: "approve" as const, expectedVersion: 1, target, ...extra });

  const first = decideApproval(request, by("checker_1"), NOW);
  assert.equal(first.status, "PENDING");
  assert.throws(() => decideApproval(first, by("checker_1", { expectedVersion: 2 }), NOW), denied("separation_of_duties_violation"));
  const second = decideApproval(first, by("checker_2", { expectedVersion: 2 }), NOW);
  assert.equal(second.status, "APPROVED");
  assert.throws(() => decideApproval(second, by("checker_3", { expectedVersion: 3 }), NOW), denied("approval_not_pending"));

  const rejected = decideApproval(request, by("checker_1", { decision: "reject", reason: " no " }), NOW);
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.decisions[0]!.reason, "no");
  assert.throws(() => decideApproval(rejected, by("checker_2", { expectedVersion: 2 }), NOW), denied("approval_not_pending"), "a rejected request is never reused");

  assert.throws(() => decideApproval(request, by("checker_1"), new Date(NOW.valueOf() + HOUR)), denied("approval_expired"));
  assert.throws(() => decideApproval(request, by("checker_1", { expectedVersion: 9 }), NOW), denied("approval_version_conflict"));
  for (const changed of [{ actionType: "payments:payment:refund" }, { targetType: "Invoice" }, { targetId: "rc_2" }, { targetVersion: 4 }]) {
    assert.throws(() => decideApproval(request, by("checker_1", { target: { ...target, ...changed } }), NOW), denied("approval_target_mismatch"));
  }
  assert.throws(
    () => proposeApproval({ ...target, actionType: "payments:payment:refund", id: "x", policy: policy(), makerId: actorId("m") }, NOW),
    denied("approval_target_mismatch"),
  );
});

test("TC-002-03-02 aggregate: cancellation is maker-only and pending-only; expiry is a time-driven transition", () => {
  const request = proposeApproval({ ...target, id: "apr_1", policy: policy(), makerId: actorId("maker_1") }, NOW);
  assert.throws(() => cancelApproval(request, actorId("checker_1"), 1), denied("permission_denied"));
  const cancelled = cancelApproval(request, actorId("maker_1"), 1);
  assert.equal(cancelled.status, "CANCELLED");
  assert.throws(() => cancelApproval(cancelled, actorId("maker_1"), 2), denied("approval_not_pending"));
  assert.throws(() => decideApproval(cancelled, { approverId: actorId("checker_1"), decision: "approve", expectedVersion: 2, target }, NOW), denied("approval_not_pending"));

  assert.throws(() => expireApproval(request, 1, NOW), denied("approval_not_pending"), "not yet expired");
  const expired = expireApproval(request, 1, new Date(NOW.valueOf() + HOUR));
  assert.equal(expired.status, "EXPIRED");
  assert.throws(() => decideApproval(expired, { approverId: actorId("checker_1"), decision: "approve", expectedVersion: 2, target }, NOW), denied("approval_not_pending"));
  assert.equal(Object.isFrozen(expired) && Object.isFrozen(expired.decisions), true);
});

test("TC-002-03-02 propose then second-party approve commits decision, audit and event atomically", async () => {
  const { store, commands } = fixture();
  const request = await runWithTenantContext(contextFor(A, "maker_1"), () => commands.proposeApproval(target));
  assert.equal(request.status, "PENDING");
  assert.equal(request.makerId, "maker_1");

  await runWithTenantContext(contextFor(A, "maker_1"), async () => {
    await assert.rejects(commands.decideApproval(decision(request.id)), denied("permission_denied"));
  });

  const approved = await runWithTenantContext(contextFor(A, "checker_1"), () => commands.decideApproval(decision(request.id)));
  assert.equal(approved.status, "APPROVED");
  assert.deepEqual(
    store.committed.audit.map((row) => [row.action, row.actor.id]),
    [["approval.requested", "maker_1"], ["approval.approved", "checker_1"]],
  );
  assert.deepEqual(
    store.committed.outbox.map((row) => [row.type, row.aggregate_version, row.tenant_id]),
    [["com.subrevos.approval.requested.v1", 1, "tenant_A"], ["com.subrevos.approval.decided.v1", 2, "tenant_A"]],
  );

  await runWithTenantContext(contextFor(A, "checker_2"), async () => {
    await assert.rejects(commands.decideApproval(decision(request.id, 2, { decision: "reject" })), denied("approval_not_pending"));
  });
});

test("an actor holding both permissions still cannot approve their own proposal", async () => {
  const { store, commands } = fixture();
  const request = await runWithTenantContext(contextFor(A, "dual"), () => commands.proposeApproval(target));
  await runWithTenantContext(contextFor(A, "dual"), async () => {
    await assert.rejects(commands.decideApproval(decision(request.id)), denied("separation_of_duties_violation"));
  });
  assert.equal(store.committed.approvals.get(`tenant_A|${request.id}`)?.status, "PENDING");
});

test("human approval requires an interactive principal with MFA step-up; nothing is loaded first", async () => {
  const { store, commands } = fixture();
  const request = await runWithTenantContext(contextFor(A, "maker_1"), () => commands.proposeApproval(target));
  const before = store.transactionsStarted;

  await runWithTenantContext(contextFor(A, "svc_1", { kind: "workload" }), async () => {
    await assert.rejects(commands.decideApproval(decision(request.id)), denied("permission_denied"));
  });
  await runWithTenantContext(contextFor(A, "checker_1", { assurance: "single-factor" }), async () => {
    await assert.rejects(commands.decideApproval(decision(request.id)), denied("authentication_assurance_insufficient"));
  });
  assert.equal(store.transactionsStarted, before, "rejected before any transaction");
  assert.equal(store.committed.approvals.get(`tenant_A|${request.id}`)?.status, "PENDING");
});

test("the decision must name the exact governed action, resource and version", async () => {
  const { store, commands } = fixture();
  const request = await runWithTenantContext(contextFor(A, "maker_1"), () => commands.proposeApproval(target));
  await runWithTenantContext(contextFor(A, "checker_1"), async () => {
    await assert.rejects(commands.decideApproval(decision(request.id, 1, { target: { ...target, targetVersion: 4 } })), denied("approval_target_mismatch"));
    await assert.rejects(commands.decideApproval(decision(request.id, 5)), denied("approval_version_conflict"));
  });
  assert.equal(store.committed.approvals.get(`tenant_A|${request.id}`)?.version, 1);
});

test("requests and policies are invisible across tenants; unknown policies are rejected", async () => {
  const { store, commands } = fixture();
  const request = await runWithTenantContext(contextFor(A, "maker_1"), () => commands.proposeApproval(target));

  await runWithTenantContext(contextFor(B, "checker_B"), async () => {
    await assert.rejects(commands.decideApproval(decision(request.id)), denied("approval_not_found"));
    await assert.rejects(commands.proposeApproval(target), denied("approval_policy_not_found"));
  });
  await runWithTenantContext(contextFor(A, "maker_1"), async () => {
    await assert.rejects(commands.proposeApproval({ ...target, actionType: "payments:payment:refund" }), denied("approval_policy_not_found"));
  });
  assert.equal(store.committed.approvals.size, 1);
});

test("cancel is atomic with audit and event, and only the maker can withdraw", async () => {
  const { store, commands } = fixture();
  const request = await runWithTenantContext(contextFor(A, "maker_1"), () => commands.proposeApproval(target));
  await runWithTenantContext(contextFor(A, "dual"), async () => {
    await assert.rejects(commands.cancelApproval({ approvalId: request.id, expectedVersion: 1 }), denied("permission_denied"));
  });
  const cancelled = await runWithTenantContext(contextFor(A, "maker_1"), () => commands.cancelApproval({ approvalId: request.id, expectedVersion: 1 }));
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(store.committed.audit.at(-1)?.action, "approval.cancelled");
  assert.equal(store.committed.outbox.at(-1)?.type, "com.subrevos.approval.cancelled.v1");
});

test("a failed audit write leaves an approval pending and unchanged", async () => {
  const { store, commands } = fixture();
  const request = await runWithTenantContext(contextFor(A, "maker_1"), () => commands.proposeApproval(target));
  store.failAuditOnce = true;
  await runWithTenantContext(contextFor(A, "checker_1"), async () => {
    await assert.rejects(commands.decideApproval(decision(request.id)));
  });
  assert.equal(store.committed.approvals.get(`tenant_A|${request.id}`)?.status, "PENDING");
  assert.equal(store.committed.audit.length, 1);
  assert.equal(store.committed.outbox.length, 1);
});

test("D4 named approver requirements: Product and Finance must each approve; one person cannot satisfy both", () => {
  const PRODUCT = "pricing:rate_card:activate";
  const FINANCE = "billing:invoice:finalize";
  const governed = policy({ approverRequirements: [{ permission: PRODUCT, count: 1 }, { permission: FINANCE, count: 1 }] });
  const request = proposeApproval({ ...target, id: "apr_d4", policy: governed, makerId: actorId("maker_1") }, NOW);
  assert.equal(request.requiredApprovals, 2);
  const decideAs = (current: typeof request, approver: string, permissions: readonly string[], kind: "approve" | "reject" = "approve") =>
    decideApproval(current, { approverId: actorId(approver), decision: kind, expectedVersion: current.version, target, approverPermissions: permissions }, NOW);

  assert.throws(() => decideAs(request, "checker_1", []), denied("approval_approver_not_eligible"), "no required permission, no vote");
  const afterDual = decideAs(request, "both_hats", [PRODUCT, FINANCE]);
  assert.deepEqual([afterDual.status, afterDual.decisions[0]!.creditedPermission], ["PENDING", PRODUCT], "a dual-role approver counts once, toward the first unmet requirement");
  assert.throws(() => decideAs(afterDual, "product_2", [PRODUCT]), denied("approval_approver_not_eligible"), "Product is already satisfied");
  const approved = decideAs(afterDual, "finance_1", [FINANCE]);
  assert.deepEqual([approved.status, approved.decisions.map((decision) => decision.creditedPermission)], ["APPROVED", [PRODUCT, FINANCE]]);

  const rejected = decideAs(request, "finance_1", [FINANCE], "reject");
  assert.equal(rejected.status, "REJECTED", "any qualifying approver may reject");

  for (const approverRequirements of [[{ permission: PRODUCT, count: 0 }], [{ permission: PRODUCT, count: 1 }, { permission: PRODUCT, count: 1 }], [{ permission: " ", count: 1 }]]) {
    assert.throws(() => proposeApproval({ ...target, id: "apr_bad", policy: policy({ approverRequirements }), makerId: actorId("maker_1") }, NOW), denied("invalid_trusted_context"));
  }
});

test("D4 the handler credits decisions from the approver's live permissions", async () => {
  const PRODUCT = "pricing:rate_card:activate";
  const FINANCE = "billing:invoice:finalize";
  const store = new InMemoryApprovalStore();
  store.seedPolicy(policy({ approverRequirements: [{ permission: PRODUCT, count: 1 }, { permission: FINANCE, count: 1 }] }));
  const authorizer = authorizerWith({
    "tenant_A:maker_1": ["approval:request:propose"],
    "tenant_A:product_1": ["approval:request:decide", PRODUCT],
    "tenant_A:finance_1": ["approval:request:decide", FINANCE],
    "tenant_A:decider_only": ["approval:request:decide"],
  });
  let ids = 0;
  const audit = createAuditRecorder({ policy: createAuditPolicy(APPROVAL_AUDIT_FIELDS), clock: () => NOW, newId: () => `aud_d4_${++ids}` });
  const commands = createApprovalCommands({ persistence: store, authorizer, audit, clock: () => NOW, newApprovalId: () => `apr_d4_${++ids}`, newEventId: () => `evt_d4_${++ids}` });
  const proposed = await runWithTenantContext(contextFor(A, "maker_1"), () => commands.proposeApproval(target));
  await runWithTenantContext(contextFor(A, "decider_only"), async () => {
    await assert.rejects(commands.decideApproval(decision(proposed.id)), denied("approval_approver_not_eligible"));
  });
  const afterProduct = await runWithTenantContext(contextFor(A, "product_1"), () => commands.decideApproval(decision(proposed.id)));
  assert.equal(afterProduct.status, "PENDING");
  const afterFinance = await runWithTenantContext(contextFor(A, "finance_1"), () => commands.decideApproval(decision(proposed.id, afterProduct.version)));
  assert.equal(afterFinance.status, "APPROVED");
});

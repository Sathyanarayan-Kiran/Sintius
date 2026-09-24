import { problem } from "../../../platform/problem-model/src/index.ts";
import type { ActorId, TenantId } from "../../../platform/tenant-context/src/index.ts";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";
export type ApprovalDecisionKind = "approve" | "reject";

/** Shape this module needs from the tenant-configured policy (owned by Identity & Tenant). */
export interface ApprovalPolicy {
  readonly tenantId: TenantId;
  readonly actionType: string;
  readonly requiredApprovals: number;
  readonly separationOfDuties: boolean;
  readonly expiresAfterSeconds: number;
}

export interface ApprovalDecision {
  readonly actorId: ActorId;
  readonly decision: ApprovalDecisionKind;
  readonly decidedAt: string;
  readonly reason?: string;
}

/** Immutable evidence record: every transition produces a new frozen snapshot with a higher version. */
export interface ApprovalRequest {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly actionType: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly targetVersion: number;
  readonly makerId: ActorId;
  readonly requiredApprovals: number;
  readonly separationOfDuties: boolean;
  readonly status: ApprovalStatus;
  readonly decisions: readonly Readonly<ApprovalDecision>[];
  readonly version: number;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** The exact governed change a decision applies to; any difference is rejected. */
export interface ApprovalTarget {
  readonly actionType: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly targetVersion: number;
}

export interface ProposeApprovalInput extends ApprovalTarget {
  readonly id: string;
  readonly policy: Readonly<ApprovalPolicy>;
  readonly makerId: ActorId;
}

function requireNonBlank(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw problem({ code: "invalid_trusted_context", detail: `${field} must not be blank.` });
  }
}

function instant(value: Date): Date {
  if (Number.isNaN(value.valueOf())) {
    throw problem({ code: "invalid_timestamp", detail: "Approval commands require a valid instant." });
  }
  return value;
}

function assertPending(request: Readonly<ApprovalRequest>, expectedVersion: number): void {
  if (request.version !== expectedVersion) {
    throw problem({ code: "approval_version_conflict", detail: "The approval request changed after this command was prepared." });
  }
  if (request.status !== "PENDING") {
    throw problem({ code: "approval_not_pending", detail: "The approval request has already been settled." });
  }
}

export function proposeApproval(input: ProposeApprovalInput, now: Date): Readonly<ApprovalRequest> {
  const { policy } = input;
  requireNonBlank(input.id, "approval id");
  requireNonBlank(input.actionType, "actionType");
  requireNonBlank(input.targetType, "targetType");
  requireNonBlank(input.targetId, "targetId");
  if (input.actionType !== policy.actionType) {
    throw problem({ code: "approval_target_mismatch", detail: "The request does not match the governing policy action." });
  }
  if (!Number.isInteger(input.targetVersion) || input.targetVersion < 1) {
    throw problem({ code: "invalid_trusted_context", detail: "targetVersion must be an integer of at least 1." });
  }
  if (!Number.isInteger(policy.requiredApprovals) || policy.requiredApprovals < 1 || !(policy.expiresAfterSeconds > 0)) {
    throw problem({ code: "invalid_trusted_context", detail: "Approval policy is invalid." });
  }
  const created = instant(now);
  return Object.freeze({
    id: input.id,
    tenantId: policy.tenantId,
    actionType: input.actionType,
    targetType: input.targetType,
    targetId: input.targetId,
    targetVersion: input.targetVersion,
    makerId: input.makerId,
    requiredApprovals: policy.requiredApprovals,
    separationOfDuties: policy.separationOfDuties,
    status: "PENDING" as const,
    decisions: Object.freeze([]),
    version: 1,
    createdAt: created.toISOString(),
    expiresAt: new Date(created.valueOf() + policy.expiresAfterSeconds * 1000).toISOString(),
  });
}

/**
 * Records one decision. Settled, expired or mismatched requests are never reused; the maker cannot
 * decide when the policy requires separation of duties; one actor cannot supply two decisions.
 */
export function decideApproval(
  request: Readonly<ApprovalRequest>,
  input: {
    readonly approverId: ActorId;
    readonly decision: ApprovalDecisionKind;
    readonly expectedVersion: number;
    readonly target: Readonly<ApprovalTarget>;
    readonly reason?: string;
  },
  now: Date,
): Readonly<ApprovalRequest> {
  assertPending(request, input.expectedVersion);
  const decidedAt = instant(now);
  if (decidedAt.valueOf() >= Date.parse(request.expiresAt)) {
    throw problem({ code: "approval_expired", detail: "The approval request has expired." });
  }
  const { target } = input;
  if (
    target.actionType !== request.actionType ||
    target.targetType !== request.targetType ||
    target.targetId !== request.targetId ||
    target.targetVersion !== request.targetVersion
  ) {
    throw problem({ code: "approval_target_mismatch", detail: "The decision does not match the governed action, resource and version." });
  }
  if (request.separationOfDuties && input.approverId === request.makerId) {
    throw problem({ code: "separation_of_duties_violation", detail: "A proposer cannot decide their own request." });
  }
  if (request.decisions.some((existing) => existing.actorId === input.approverId)) {
    throw problem({ code: "separation_of_duties_violation", detail: "An actor may supply only one decision per request." });
  }
  const reason = input.reason?.trim();
  const entry: ApprovalDecision = Object.freeze({
    actorId: input.approverId,
    decision: input.decision,
    decidedAt: decidedAt.toISOString(),
    ...(reason === undefined || reason.length === 0 ? {} : { reason }),
  });
  const decisions = Object.freeze([...request.decisions, entry]);
  const approvals = decisions.filter((item) => item.decision === "approve").length;
  const status: ApprovalStatus = input.decision === "reject" ? "REJECTED" : approvals >= request.requiredApprovals ? "APPROVED" : "PENDING";
  return Object.freeze({ ...request, decisions, status, version: request.version + 1 });
}

/** Only the maker may withdraw a still-pending request. */
export function cancelApproval(request: Readonly<ApprovalRequest>, actorId: ActorId, expectedVersion: number): Readonly<ApprovalRequest> {
  assertPending(request, expectedVersion);
  if (actorId !== request.makerId) {
    throw problem({ code: "permission_denied", detail: "Only the proposer may cancel this request." });
  }
  return Object.freeze({ ...request, status: "CANCELLED" as const, version: request.version + 1 });
}

/** Time-driven transition applied by a sweeper; an unexpired request is left untouched by rejection. */
export function expireApproval(request: Readonly<ApprovalRequest>, expectedVersion: number, now: Date): Readonly<ApprovalRequest> {
  assertPending(request, expectedVersion);
  if (instant(now).valueOf() < Date.parse(request.expiresAt)) {
    throw problem({ code: "approval_not_pending", detail: "The approval request has not yet expired." });
  }
  return Object.freeze({ ...request, status: "EXPIRED" as const, version: request.version + 1 });
}

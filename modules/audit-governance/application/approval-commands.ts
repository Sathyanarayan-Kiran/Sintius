import { randomUUID } from "node:crypto";
import { buildEventEnvelope } from "../../../platform/event-envelope/src/index.ts";
import { problem } from "../../../platform/problem-model/src/index.ts";
import { currentTenantContext } from "../../../platform/tenant-context/src/index.ts";
import {
  cancelApproval,
  decideApproval,
  proposeApproval,
  type ApprovalDecisionKind,
  type ApprovalRequest,
  type ApprovalTarget,
} from "../domain/approval.ts";
import type { ApprovalAuditAction, ApprovalAuthorizer, ApprovalPersistence, ApprovalUnitOfWork } from "./approval-ports.ts";

export interface DecideApprovalCommand {
  readonly approvalId: string;
  readonly decision: ApprovalDecisionKind;
  readonly expectedVersion: number;
  /** The exact action, resource and version the approver believes they are deciding. */
  readonly target: Readonly<ApprovalTarget>;
  readonly reason?: string;
}

export interface CancelApprovalCommand {
  readonly approvalId: string;
  readonly expectedVersion: number;
}

/**
 * Maker-checker handlers. Proposing needs `approval:request:propose`; deciding needs
 * `approval:request:decide`, an interactive (human) principal and MFA step-up. The decision, audit
 * fact and outbox event commit in one unit of work.
 */
export function createApprovalCommands(dependencies: {
  readonly persistence: ApprovalPersistence;
  readonly authorizer: ApprovalAuthorizer;
  readonly clock: () => Date;
  readonly newApprovalId?: () => string;
  readonly newEventId?: () => string;
}) {
  const newApprovalId = dependencies.newApprovalId ?? (() => `apr_${randomUUID()}`);

  const scopeOf = () => {
    const context = currentTenantContext();
    return { correlationId: context.correlationId, ...(context.causationId === undefined ? {} : { causationId: context.causationId }) };
  };

  async function record(
    unitOfWork: ApprovalUnitOfWork,
    request: Readonly<ApprovalRequest>,
    action: ApprovalAuditAction,
    eventType: string,
    now: Date,
    details: Record<string, string | number>,
  ): Promise<void> {
    const context = currentTenantContext();
    await unitOfWork.audit.append({
      action,
      tenantId: context.tenantId,
      actorId: context.actorId,
      targetType: "ApprovalRequest",
      targetId: request.id,
      correlationId: context.correlationId,
      ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
      occurredAt: now.toISOString(),
      details,
    });
    await unitOfWork.outbox.append(
      buildEventEnvelope(
        {
          eventType,
          sourceContext: "audit-governance",
          aggregateType: "ApprovalRequest",
          aggregateId: request.id,
          aggregateVersion: request.version,
          occurredAt: now,
          classification: "CONFIDENTIAL_BUSINESS",
          data: { action_type: request.actionType, status: request.status, maker_id: request.makerId },
        },
        { clock: () => now, ...(dependencies.newEventId === undefined ? {} : { newEventId: dependencies.newEventId }) },
      ),
    );
  }

  async function load(unitOfWork: ApprovalUnitOfWork, approvalId: string): Promise<Readonly<ApprovalRequest>> {
    const context = currentTenantContext();
    const request = await unitOfWork.approvals.findById(context.tenantId, approvalId);
    // Defense in depth on top of the tenant-scoped repository contract.
    if (request === undefined || request.tenantId !== context.tenantId) {
      throw problem({ code: "approval_not_found", detail: "The approval request does not exist.", correlation_id: context.correlationId });
    }
    return request;
  }

  async function propose(input: ApprovalTarget): Promise<Readonly<ApprovalRequest>> {
    await dependencies.authorizer.assertPermission("approval:request:propose");
    const context = currentTenantContext();
    const now = dependencies.clock();
    return dependencies.persistence.runInTransaction(scopeOf(), async (unitOfWork) => {
      const policy = await unitOfWork.policies.findByActionType(context.tenantId, input.actionType);
      if (policy === undefined || policy.tenantId !== context.tenantId) {
        throw problem({ code: "approval_policy_not_found", detail: "No approval policy governs this action.", correlation_id: context.correlationId });
      }
      const request = proposeApproval({ ...input, id: newApprovalId(), policy, makerId: context.actorId }, now);
      await unitOfWork.approvals.insert(request);
      await record(unitOfWork, request, "approval.requested", "approval.requested.v1", now, {
        action_type: request.actionType,
        target_id: request.targetId,
      });
      return request;
    });
  }

  async function decide(input: DecideApprovalCommand): Promise<Readonly<ApprovalRequest>> {
    await dependencies.authorizer.assertPermission("approval:request:decide");
    const context = currentTenantContext();
    if (context.principalKind !== "interactive") {
      throw problem({ code: "permission_denied", detail: "Approvals must be decided by an interactive user.", correlation_id: context.correlationId });
    }
    if (context.assurance !== "mfa") {
      throw problem({
        code: "authentication_assurance_insufficient",
        detail: "Multi-factor authentication is required to decide an approval.",
        correlation_id: context.correlationId,
      });
    }
    const now = dependencies.clock();
    return dependencies.persistence.runInTransaction(scopeOf(), async (unitOfWork) => {
      const current = await load(unitOfWork, input.approvalId);
      const next = decideApproval(
        current,
        {
          approverId: context.actorId,
          decision: input.decision,
          expectedVersion: input.expectedVersion,
          target: input.target,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
        now,
      );
      await unitOfWork.approvals.update(next, current.version);
      await record(unitOfWork, next, input.decision === "approve" ? "approval.approved" : "approval.rejected", "approval.decided.v1", now, {
        decision: input.decision,
        resulting_status: next.status,
        previous_version: current.version,
      });
      return next;
    });
  }

  async function cancel(input: CancelApprovalCommand): Promise<Readonly<ApprovalRequest>> {
    await dependencies.authorizer.assertPermission("approval:request:propose");
    const context = currentTenantContext();
    const now = dependencies.clock();
    return dependencies.persistence.runInTransaction(scopeOf(), async (unitOfWork) => {
      const current = await load(unitOfWork, input.approvalId);
      const next = cancelApproval(current, context.actorId, input.expectedVersion);
      await unitOfWork.approvals.update(next, current.version);
      await record(unitOfWork, next, "approval.cancelled", "approval.cancelled.v1", now, { previous_version: current.version });
      return next;
    });
  }

  return Object.freeze({ proposeApproval: propose, decideApproval: decide, cancelApproval: cancel });
}

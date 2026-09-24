import type { AuditEvent } from "../../../platform/audit/src/index.ts";
import type { EventEnvelope } from "../../../platform/event-envelope/src/index.ts";
import { problem } from "../../../platform/problem-model/src/index.ts";
import type { ApprovalPersistence, ApprovalUnitOfWork } from "../application/approval-ports.ts";
import type { ApprovalPolicy, ApprovalRequest } from "../domain/approval.ts";

/**
 * TEST DOUBLE ONLY: tenant-keyed maps with stage-then-commit semantics. It exercises handler
 * logic and tenant scoping; it is not evidence of PostgreSQL atomicity, RLS or audit immutability.
 */
interface Store {
  approvals: Map<string, ApprovalRequest>;
  audit: AuditEvent[];
  outbox: EventEnvelope[];
}

const key = (...parts: string[]) => parts.map(encodeURIComponent).join("|");

export class InMemoryApprovalStore implements ApprovalPersistence {
  committed: Store = { approvals: new Map(), audit: [], outbox: [] };
  policies = new Map<string, ApprovalPolicy>();
  transactionsStarted = 0;
  failAuditOnce = false;

  seedPolicy(policy: ApprovalPolicy): void {
    this.policies.set(key(policy.tenantId, policy.actionType), policy);
  }

  async runInTransaction<T>(_scope: unknown, work: (unitOfWork: ApprovalUnitOfWork) => Promise<T>): Promise<T> {
    this.transactionsStarted += 1;
    const staged: Store = { approvals: new Map(this.committed.approvals), audit: [...this.committed.audit], outbox: [...this.committed.outbox] };
    const unitOfWork: ApprovalUnitOfWork = {
      policies: { findByActionType: async (tenant, actionType) => this.policies.get(key(tenant, actionType)) },
      approvals: {
        insert: async (request) => {
          staged.approvals.set(key(request.tenantId, request.id), request);
        },
        findById: async (tenant, id) => staged.approvals.get(key(tenant, id)),
        update: async (request, expectedVersion) => {
          const stored = staged.approvals.get(key(request.tenantId, request.id));
          if (stored === undefined || stored.version !== expectedVersion) {
            throw problem({ code: "approval_version_conflict", detail: "Changed concurrently." });
          }
          staged.approvals.set(key(request.tenantId, request.id), request);
        },
      },
      audit: {
        append: async (record) => {
          if (this.failAuditOnce) {
            this.failAuditOnce = false;
            throw new Error("injected audit failure");
          }
          staged.audit.push(record);
        },
      },
      outbox: {
        append: async (envelope) => {
          staged.outbox.push(envelope);
        },
      },
    };
    const result = await work(unitOfWork);
    this.committed = staged;
    return result;
  }
}

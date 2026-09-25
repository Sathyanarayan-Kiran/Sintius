import { tenantId, type TenantId } from "../../../../platform/tenant-context/src/index.ts";

/**
 * Identity & Tenant owns `approval_policy`. This reader is handed to the approval persistence at the
 * composition root and runs on the approval transaction's client, so Audit & Governance reads
 * policies through a published shape without touching this module's table directly.
 */
export interface PolicyQuery {
  query(sql: string, parameters?: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export interface ApprovalPolicyRecord {
  readonly tenantId: TenantId;
  readonly actionType: string;
  readonly requiredApprovals: number;
  readonly separationOfDuties: boolean;
  readonly expiresAfterSeconds: number;
  readonly approverRequirements: readonly { readonly permission: string; readonly count: number }[];
}

export function createPostgresApprovalPolicyReader(transaction: PolicyQuery) {
  return {
    async findByActionType(tenant: TenantId, actionType: string): Promise<Readonly<ApprovalPolicyRecord> | undefined> {
      const result = await transaction.query(
        `SELECT tenant_id, action_type, required_approvals, separation_of_duties, expires_after_seconds, approver_requirements
           FROM approval_policy
          WHERE tenant_id = $1 AND action_type = $2 AND tenant_id = current_setting('app.tenant_id', true)`,
        [tenant, actionType],
      );
      const row = result.rows[0];
      if (row === undefined) return undefined;
      const requirements = Array.isArray(row.approver_requirements) ? row.approver_requirements : [];
      return Object.freeze({
        tenantId: tenantId(String(row.tenant_id)),
        actionType: String(row.action_type),
        requiredApprovals: Number(row.required_approvals),
        separationOfDuties: Boolean(row.separation_of_duties),
        expiresAfterSeconds: Number(row.expires_after_seconds),
        approverRequirements: Object.freeze(
          requirements.map((item: { permission?: unknown; count?: unknown }) => Object.freeze({ permission: String(item.permission), count: Number(item.count) })),
        ),
      });
    },
  };
}

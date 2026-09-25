import type { Permission } from "./authorization.ts";

/**
 * Approval policies every tenant receives at provisioning (D9 review, 2026-09-25). Master spec §62:
 * "Pricing activation → Product + Finance approval". With named approvers (D4), the Product
 * approver is a holder of `pricing:rate_card:activate` (the Product Manager persona) and the Finance
 * approver a holder of `billing:invoice:finalize` without a limit (the Finance Controller persona);
 * the proposer can never approve their own request. Tenants may tighten these later.
 */
export interface DefaultApprovalPolicy {
  readonly actionType: Permission;
  readonly requiredApprovals: number;
  readonly separationOfDuties: boolean;
  readonly expiresAfterSeconds: number;
  readonly approverRequirements: readonly { readonly permission: Permission; readonly count: number }[];
}

export const DEFAULT_APPROVAL_POLICIES: readonly DefaultApprovalPolicy[] = Object.freeze([
  Object.freeze({
    actionType: "pricing:rate_card:activate" as const,
    requiredApprovals: 2,
    separationOfDuties: true,
    expiresAfterSeconds: 7 * 24 * 60 * 60,
    approverRequirements: Object.freeze([
      Object.freeze({ permission: "pricing:rate_card:activate" as const, count: 1 }),
      Object.freeze({ permission: "billing:invoice:finalize" as const, count: 1 }),
    ]),
  }),
]);

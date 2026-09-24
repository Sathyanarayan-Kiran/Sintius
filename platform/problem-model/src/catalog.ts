/**
 * Registry of every externally visible problem code. A code, its HTTP status and its title are a
 * published API contract (docs/pre-implementation/13-api-specification.md section 11): changing an
 * entry is a breaking change and is caught by the golden contract test.
 */
export const PROBLEM_CATALOG = Object.freeze({
  invalid_trusted_context: Object.freeze({ status: 400, title: "Invalid trusted context" }),
  authentication_failed: Object.freeze({ status: 401, title: "Authentication failed" }),
  authentication_assurance_insufficient: Object.freeze({ status: 403, title: "Authentication assurance insufficient" }),
  workload_scope_denied: Object.freeze({ status: 403, title: "Workload scope denied" }),
  untrusted_tenant_context: Object.freeze({ status: 400, title: "Untrusted tenant context" }),
  tenant_access_denied: Object.freeze({ status: 403, title: "Tenant access denied" }),
  tenant_not_active: Object.freeze({ status: 403, title: "Tenant unavailable" }),
  invalid_timestamp: Object.freeze({ status: 422, title: "Invalid timestamp" }),
  tenant_display_name_required: Object.freeze({ status: 422, title: "Invalid tenant" }),
  tenant_version_conflict: Object.freeze({ status: 409, title: "Tenant version conflict" }),
  invalid_tenant_transition: Object.freeze({ status: 409, title: "Invalid tenant transition" }),
  platform_access_denied: Object.freeze({ status: 403, title: "Platform access denied" }),
  tenant_not_found: Object.freeze({ status: 404, title: "Tenant not found" }),
  tenant_already_exists: Object.freeze({ status: 409, title: "Tenant already exists" }),
  tenant_reason_required: Object.freeze({ status: 422, title: "Reason required" }),
  permission_denied: Object.freeze({ status: 403, title: "Permission denied" }),
  unknown_permission: Object.freeze({ status: 500, title: "Unknown permission" }),
  role_not_found: Object.freeze({ status: 404, title: "Role not found" }),
  role_assignment_exists: Object.freeze({ status: 409, title: "Role assignment exists" }),
  role_assignment_not_found: Object.freeze({ status: 404, title: "Role assignment not found" }),
  separation_of_duties_violation: Object.freeze({ status: 403, title: "Separation of duties violation" }),
  approval_policy_not_found: Object.freeze({ status: 404, title: "Approval policy not found" }),
  approval_not_found: Object.freeze({ status: 404, title: "Approval not found" }),
  approval_not_pending: Object.freeze({ status: 409, title: "Approval not pending" }),
  approval_expired: Object.freeze({ status: 409, title: "Approval expired" }),
  approval_version_conflict: Object.freeze({ status: 409, title: "Approval version conflict" }),
  approval_target_mismatch: Object.freeze({ status: 409, title: "Approval target mismatch" }),
  idempotency_key_required: Object.freeze({ status: 400, title: "Idempotency key required" }),
  idempotency_key_invalid: Object.freeze({ status: 400, title: "Idempotency key invalid" }),
  idempotency_key_reused_with_different_payload: Object.freeze({ status: 409, title: "Idempotency key reused with different payload" }),
  request_in_progress: Object.freeze({ status: 409, title: "Request in progress" }),
  dead_letter_not_resolvable: Object.freeze({ status: 409, title: "Dead letter not resolvable" }),
  dead_letter_reason_required: Object.freeze({ status: 422, title: "Reason required" }),
  tenant_context_missing: Object.freeze({ status: 500, title: "Tenant context required" }),
  tenant_context_mismatch: Object.freeze({ status: 500, title: "Tenant context mismatch" }),
  internal_error: Object.freeze({ status: 500, title: "Internal error" }),
} as const);

export type ProblemCode = keyof typeof PROBLEM_CATALOG;

export const PROBLEM_STATUSES = Object.freeze([400, 401, 403, 404, 409, 412, 422, 429, 500, 503] as const);
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

export function isRegisteredProblemCode(code: string): code is ProblemCode {
  return Object.hasOwn(PROBLEM_CATALOG, code);
}

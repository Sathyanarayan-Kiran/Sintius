/**
 * Registry of every externally visible problem code. A code, its HTTP status and its title are a
 * published API contract (docs/pre-implementation/13-api-specification.md section 11): changing an
 * entry is a breaking change and is caught by the golden contract test.
 */
export const PROBLEM_CATALOG = Object.freeze({
  invalid_trusted_context: Object.freeze({ status: 400, title: "Invalid trusted context" }),
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

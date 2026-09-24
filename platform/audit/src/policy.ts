import { problem, redactSensitiveText } from "../../problem-model/src/index.ts";
import type { AuditSnapshot } from "./model.ts";

const FIELD_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const FORBIDDEN_FRAGMENTS = /password|passwd|secret|token|api_?key|credential|private_?key|cvv|ssn/;
const FORBIDDEN_WORDS = /(^|_)(pan|card)(_|$)/;

/** Fields the platform itself records; a policy always contains this entry. */
const BUILT_IN: Readonly<Record<string, readonly string[]>> = Object.freeze({
  AuditQuery: Object.freeze(["action", "target_type", "target_id", "actor_id", "correlation_id", "result_count"]),
});

export interface AuditPolicy {
  allowedFields(targetType: string): readonly string[] | undefined;
}

/**
 * Deny-by-default redaction policy: per target type, the ONLY fields that may appear in audit
 * `before`/`after`. Names that look like secrets or card data cannot be allow-listed at all.
 */
export function createAuditPolicy(fields: Readonly<Record<string, readonly string[]>>): AuditPolicy {
  const registry = new Map<string, readonly string[]>();
  for (const [targetType, allowed] of Object.entries({ ...BUILT_IN, ...fields })) {
    for (const field of allowed) {
      if (!FIELD_PATTERN.test(field) || FORBIDDEN_FRAGMENTS.test(field) || FORBIDDEN_WORDS.test(field)) {
        throw problem({ code: "audit_policy_missing", detail: `Field "${field}" cannot be allow-listed for audit evidence.` });
      }
    }
    registry.set(targetType, Object.freeze([...new Set(allowed)].sort()));
  }
  return Object.freeze({ allowedFields: (targetType: string) => registry.get(targetType) });
}

/**
 * Projects a value onto its allow-list. Unknown target types fail closed; non-scalar values,
 * non-finite numbers and un-listed keys are dropped; strings pass through the shared redactor.
 */
export function toSafeSnapshot(
  policy: AuditPolicy,
  targetType: string,
  value: Readonly<Record<string, unknown>> | undefined,
): AuditSnapshot | undefined {
  if (value === undefined) return undefined;
  const allowed = policy.allowedFields(targetType);
  if (allowed === undefined) {
    throw problem({ code: "audit_policy_missing", detail: `No audit policy is registered for target type "${targetType}".` });
  }
  const snapshot: Record<string, string | number | boolean | null> = {};
  for (const field of allowed) {
    if (!Object.hasOwn(value, field)) continue;
    const candidate = value[field];
    if (candidate === null || typeof candidate === "boolean") snapshot[field] = candidate;
    else if (typeof candidate === "string") snapshot[field] = redactSensitiveText(candidate);
    else if (typeof candidate === "number" && Number.isFinite(candidate)) snapshot[field] = candidate;
  }
  return Object.freeze(snapshot);
}

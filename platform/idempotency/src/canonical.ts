import { createHash, timingSafeEqual } from "node:crypto";
import { problem } from "../../problem-model/src/index.ts";

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const MAX_DEPTH = 32;

function invalid(detail: string): never {
  throw problem({ code: "invalid_trusted_context", detail });
}

/**
 * Deterministic JSON: object keys sorted, `undefined` properties dropped, -0 normalized, and
 * anything that is not plain JSON (non-finite numbers, bigint, Date, class instances, functions,
 * cycles or excessive depth) rejected so two different requests can never hash alike by accident.
 */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) invalid("Request payload is nested too deeply to canonicalize.");
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) invalid("Request payload contains a non-finite number.");
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item === undefined ? null : item, depth + 1)).join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) invalid("Request payload must contain only plain objects.");
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child, depth + 1)}`).join(",")}}`;
    }
    default:
      return invalid("Request payload is not JSON compatible.");
  }
}

/** SHA-256 over the canonical form of the command scope and payload, as lowercase hex. */
export function canonicalRequestHash(scope: string, payload: unknown): string {
  return createHash("sha256").update(canonicalJson({ scope, payload })).digest("hex");
}

export function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

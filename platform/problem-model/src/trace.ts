import { randomUUID } from "node:crypto";

export const CORRELATION_ID_HEADER = "x-correlation-id";
export const CAUSATION_ID_HEADER = "x-causation-id";

/**
 * Trace identifiers appear in logs, response headers and event envelopes, so only a conservative
 * character set is accepted: no whitespace, control characters or separators that could enable
 * header injection or log forging.
 */
const TRACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isValidTraceId(value: unknown): value is string {
  return typeof value === "string" && TRACE_ID_PATTERN.test(value);
}

export function newTraceId(prefix = "corr"): string {
  return `${prefix}_${randomUUID()}`;
}

export interface InboundTraceIds {
  readonly correlationId?: string | null;
  readonly causationId?: string | null;
}

export interface ResolvedTraceIds {
  readonly correlationId: string;
  readonly causationId?: string;
}

/**
 * Untrusted inbound identifiers are never reflected unless they pass validation. A missing or
 * invalid correlation ID is replaced with a generated one; an invalid causation ID is dropped
 * because an absent causation is a legitimate state, while an absent correlation ID is not.
 */
export function resolveTraceIds(inbound: InboundTraceIds = {}, generate: () => string = newTraceId): ResolvedTraceIds {
  const correlationId = isValidTraceId(inbound.correlationId) ? inbound.correlationId : generate();
  return Object.freeze({
    correlationId,
    ...(isValidTraceId(inbound.causationId) ? { causationId: inbound.causationId } : {}),
  });
}

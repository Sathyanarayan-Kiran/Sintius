import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { PlatformProblem, redactSensitiveText } from "../../problem-model/src/index.ts";

/**
 * The only tracing surface application code uses (decision D15). It wraps `@opentelemetry/api`, so
 * modules never touch OpenTelemetry directly, and it enforces PII-safe conventions: attribute keys
 * are allow-listed by shape, secret-like keys are refused, string values are redacted and bounded,
 * and errors are recorded as a type, problem code and redacted message, never a raw stack or payload.
 */
export const INSTRUMENTATION_SCOPE = "sintius";
export { SpanKind, SpanStatusCode };
export type { Context, Span };

export type SafeAttributeValue = string | number | boolean;
export type SafeAttributes = Readonly<Record<string, SafeAttributeValue | undefined>>;

const ATTRIBUTE_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
const SECRET_KEY = /pass(word|wd)?|secret|token|authorization|credential|api[_.-]?key|private[_.-]?key|cookie|session|card|pan\b|cvv/i;
const MAX_STRING = 256;
const MAX_KEY = 96;

/** Validates and redacts attributes; an unsafe key is a programming error and throws. */
export function safeAttributes(input: SafeAttributes = {}): Attributes {
  const output: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key.length > MAX_KEY || !ATTRIBUTE_KEY.test(key)) throw new TypeError(`Telemetry attribute key "${key}" is not a dotted lowercase name.`);
    if (SECRET_KEY.test(key)) throw new TypeError(`Telemetry attribute key "${key}" looks like it carries a secret.`);
    if (typeof value === "string") output[key] = redactSensitiveText(value).slice(0, MAX_STRING);
    else if (typeof value === "number" ? Number.isFinite(value) : typeof value === "boolean") output[key] = value;
    else throw new TypeError(`Telemetry attribute "${key}" must be a string, finite number or boolean.`);
  }
  return output;
}

function tracer() {
  return trace.getTracer(INSTRUMENTATION_SCOPE);
}

/** Marks a span failed with a safe description of the error. */
export function recordFailure(span: Span, error: unknown): void {
  const problem = error instanceof PlatformProblem ? error.problem : undefined;
  span.setAttributes(
    safeAttributes({
      "error.type": problem?.code ?? (error instanceof Error ? error.name : typeof error),
      ...(problem === undefined ? {} : { "sintius.problem.code": problem.code, "sintius.problem.status": problem.status }),
    }),
  );
  // Expected client-side problems (4xx) are outcomes, not faults; only unexpected errors mark the span as ERROR.
  if (problem === undefined || problem.status >= 500) {
    const message = error instanceof Error ? redactSensitiveText(error.message).slice(0, MAX_STRING) : "non-error failure";
    span.setStatus({ code: SpanStatusCode.ERROR, message });
  }
}

/** Runs `work` in a new active span that ends when `work` settles. */
export async function withSpan<T>(
  name: string,
  options: { readonly kind?: SpanKind; readonly attributes?: SafeAttributes; readonly parent?: Context },
  work: (span: Span) => Promise<T>,
): Promise<T> {
  const parent = options.parent ?? context.active();
  return tracer().startActiveSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes: safeAttributes(options.attributes) },
    parent,
    async (span) => {
      try {
        return await work(span);
      } catch (error) {
        recordFailure(span, error);
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/** Starts a span that the caller ends explicitly (for example across framework hooks). */
export function startSpan(name: string, options: { readonly kind?: SpanKind; readonly attributes?: SafeAttributes } = {}): Span {
  return tracer().startSpan(name, { kind: options.kind ?? SpanKind.INTERNAL, attributes: safeAttributes(options.attributes) }, context.active());
}

/** Runs `work` with `span` as the active span, so spans started inside become its children. */
export function runInSpan<T>(span: Span, work: () => T): T {
  return context.with(trace.setSpan(context.active(), span), work);
}

export function setSpanAttributes(span: Span, attributes: SafeAttributes): void {
  span.setAttributes(safeAttributes(attributes));
}

/** Adds a named event to the active span, if any. */
export function addSpanEvent(name: string, attributes: SafeAttributes = {}): void {
  trace.getActiveSpan()?.addEvent(name, safeAttributes(attributes));
}

// --- Trace context carried beside stored events -------------------------------------------------

/**
 * W3C trace context (`traceparent`, optional `tracestate`) of the active span. It is stored in its
 * own column next to an outbox entry or delivery rather than inside the event envelope, because the
 * published envelope contract does not allow extra fields. Dispatch and consumption continue the
 * trace from it, so one trace spans ingress, transaction, dispatch and consumption.
 */
export type TraceCarrier = Readonly<{ traceparent: string; tracestate?: string }>;

const TRACEPARENT = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

export function currentTraceCarrier(): TraceCarrier | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return toCarrier(carrier);
}

/** Validates an untrusted stored value; anything malformed is ignored rather than propagated. */
export function toCarrier(value: unknown): TraceCarrier | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { traceparent, tracestate } = value as Record<string, unknown>;
  if (typeof traceparent !== "string" || !TRACEPARENT.test(traceparent)) return undefined;
  return Object.freeze({
    traceparent,
    ...(typeof tracestate === "string" && tracestate.length <= 512 ? { tracestate } : {}),
  });
}

/** Parent context for work that continues a stored trace; a root context when there is none. */
export function contextFromCarrier(carrier: unknown): Context {
  const valid = toCarrier(carrier);
  return valid === undefined ? ROOT_CONTEXT : propagation.extract(ROOT_CONTEXT, { ...valid });
}

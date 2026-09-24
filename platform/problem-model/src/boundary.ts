import { PROBLEM_CONTENT_TYPE, PlatformProblem, problem, type ProblemDetails, type ProblemStatus } from "./problem.ts";
import { redactSensitiveText } from "./redaction.ts";
import { CORRELATION_ID_HEADER, isValidTraceId, newTraceId } from "./trace.ts";

/** Transport-neutral error response; an HTTP adapter copies these fields verbatim. */
export interface ProblemResponse {
  readonly status: ProblemStatus;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<ProblemDetails>;
}

/** Trusted identifiers established at ingress; never taken from an error or request body. */
export interface ProblemBoundaryContext {
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly route?: string;
}

export type UnexpectedErrorReason = "unhandled_exception" | "server_problem";

/** Internal-only evidence. It must never be serialized into a response. */
export interface UnexpectedErrorReport {
  readonly reason: UnexpectedErrorReason;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly route?: string;
  readonly responseCode: string;
  readonly errorName: string;
  readonly errorMessage: string;
  readonly stack?: string;
}

export interface UnexpectedErrorSink {
  record(report: UnexpectedErrorReport): void;
}

export type BoundaryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: ProblemResponse };

function describeThrown(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSensitiveText(error.message),
      ...(error.stack === undefined ? {} : { stack: redactSensitiveText(error.stack) }),
    };
  }
  return { name: typeof error, message: redactSensitiveText(String(error)) };
}

function pickCorrelationId(context: ProblemBoundaryContext, carried: string | undefined): string {
  if (isValidTraceId(context.correlationId)) return context.correlationId;
  if (isValidTraceId(carried)) return carried;
  return newTraceId();
}

function safelyRecord(sink: UnexpectedErrorSink | undefined, report: UnexpectedErrorReport): void {
  if (sink === undefined) return;
  try {
    sink.record(report);
  } catch {
    // Telemetry failure must never change the response returned to the caller.
  }
}

/**
 * Maps any thrown value to the canonical problem response.
 *
 * - A cataloged PlatformProblem is returned as-is, built field by field from an allow-list.
 * - Anything else becomes a fixed, non-sensitive 500; the original error is redacted and handed
 *   only to the internal sink.
 * - The trusted ingress correlation ID always wins so one request has one trace.
 */
export function mapErrorToProblemResponse(
  error: unknown,
  context: ProblemBoundaryContext = {},
  sink?: UnexpectedErrorSink,
  clock: () => Date = () => new Date(),
): ProblemResponse {
  const known = error instanceof PlatformProblem ? error.problem : undefined;
  const correlationId = pickCorrelationId(context, known?.correlation_id);

  const details: ProblemDetails =
    known ?? problem({ code: "internal_error", detail: "An unexpected error occurred. Quote the correlation ID when contacting support." }).problem;

  if (known === undefined || known.status >= 500) {
    const evidence = describeThrown(error);
    safelyRecord(sink, {
      reason: known === undefined ? "unhandled_exception" : "server_problem",
      occurredAt: clock().toISOString(),
      correlationId,
      ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
      ...(context.route === undefined ? {} : { route: context.route }),
      responseCode: details.code,
      errorName: evidence.name,
      errorMessage: evidence.message,
      ...(evidence.stack === undefined ? {} : { stack: evidence.stack }),
    });
  }

  const body: ProblemDetails = Object.freeze({
    type: details.type,
    title: details.title,
    status: details.status,
    code: details.code,
    detail: details.detail,
    correlation_id: correlationId,
    ...(details.errors === undefined ? {} : { errors: details.errors }),
  });

  return Object.freeze({
    status: details.status,
    headers: Object.freeze({ "content-type": PROBLEM_CONTENT_TYPE, [CORRELATION_ID_HEADER]: correlationId }),
    body,
  });
}

/** Runs an operation and converts any failure, synchronous or asynchronous, into a problem response. */
export async function runAtProblemBoundary<T>(
  context: ProblemBoundaryContext,
  operation: () => T | Promise<T>,
  sink?: UnexpectedErrorSink,
  clock?: () => Date,
): Promise<BoundaryResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, response: mapErrorToProblemResponse(error, context, sink, clock) };
  }
}

export {
  INSTRUMENTATION_SCOPE,
  SpanKind,
  SpanStatusCode,
  addSpanEvent,
  contextFromCarrier,
  currentTraceCarrier,
  recordFailure,
  runInSpan,
  safeAttributes,
  setSpanAttributes,
  startSpan,
  toCarrier,
  withSpan,
} from "./telemetry.ts";
export type { Context, SafeAttributeValue, SafeAttributes, Span, TraceCarrier } from "./telemetry.ts";
export { registerQueueGauges, telemetryMetrics } from "./metrics.ts";
export type { IdempotencyOutcome, QueueOutcome, QueueStatsSnapshot } from "./metrics.ts";

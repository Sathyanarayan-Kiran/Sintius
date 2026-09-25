import assert from "node:assert/strict";
import test from "node:test";
import { SpanStatusCode } from "@opentelemetry/api";
import { problem } from "../../problem-model/src/index.ts";
import {
  SpanKind,
  addSpanEvent,
  contextFromCarrier,
  currentTraceCarrier,
  registerQueueGauges,
  safeAttributes,
  telemetryMetrics,
  toCarrier,
  withSpan,
} from "../src/index.ts";
import { finishedSpans, metricValue, resetSpans, serializedTelemetry, testTelemetry } from "./support.ts";

testTelemetry();

test("D15 attributes are shape-checked, secret-like keys are refused and values are redacted", () => {
  assert.deepEqual(safeAttributes({ "sintius.command.scope": "tenant.provision", "http.response.status_code": 201, ok: true, skipped: undefined }), {
    "sintius.command.scope": "tenant.provision",
    "http.response.status_code": 201,
    ok: true,
  });
  for (const key of ["authorization", "http.request.header.authorization", "user.password", "api_key", "session.id", "Bad Key", "a..b"]) {
    assert.throws(() => safeAttributes({ [key]: "x" }), TypeError, key);
  }
  assert.doesNotMatch(String(safeAttributes({ "error.detail": "failed with password=hunter2 Bearer abc.def" })["error.detail"]), /hunter2|abc\.def/);
  assert.equal(String(safeAttributes({ "long.value": "x".repeat(1000) })["long.value"]).length, 256);
  assert.throws(() => safeAttributes({ "bad.number": Number.NaN }), TypeError);
});

test("D15 spans nest, record expected problems as outcomes and unexpected errors as redacted failures", async () => {
  resetSpans();
  await withSpan("outer", { kind: SpanKind.SERVER, attributes: { "sintius.test": "nesting" } }, async () => {
    await withSpan("inner", {}, async () => addSpanEvent("audit.recorded", { "sintius.audit.action": "tenant.activated" }));
    await assert.rejects(
      withSpan("expected", {}, async () => {
        throw problem({ code: "permission_denied", detail: "denied" });
      }),
    );
    await assert.rejects(
      withSpan("unexpected", {}, async () => {
        throw new Error("db failed: password=hunter2");
      }),
    );
  });
  const byName = Object.fromEntries(finishedSpans().map((span) => [span.name, span]));
  const outer = byName.outer!;
  for (const child of ["inner", "expected", "unexpected"]) {
    assert.equal(byName[child]!.parentSpanContext?.spanId, outer.spanContext().spanId, `${child} is a child of outer`);
    assert.equal(byName[child]!.spanContext().traceId, outer.spanContext().traceId);
  }
  assert.deepEqual(byName.inner!.events.map((event) => [event.name, event.attributes]), [["audit.recorded", { "sintius.audit.action": "tenant.activated" }]]);
  assert.equal(byName.expected!.attributes["sintius.problem.code"], "permission_denied");
  assert.notEqual(byName.expected!.status.code, SpanStatusCode.ERROR, "a 4xx problem is an outcome, not a fault");
  assert.equal(byName.unexpected!.status.code, SpanStatusCode.ERROR);
  assert.doesNotMatch(serializedTelemetry(finishedSpans()), /hunter2/, "no secret reaches telemetry");
});

test("D15 a stored trace carrier continues the trace; malformed carriers start a fresh root", async () => {
  resetSpans();
  let carrier: ReturnType<typeof currentTraceCarrier>;
  await withSpan("command", {}, async () => {
    carrier = currentTraceCarrier();
  });
  assert.ok(carrier && /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/.test(carrier.traceparent));
  await withSpan("dispatch", { kind: SpanKind.PRODUCER, parent: contextFromCarrier(carrier) }, async () => {});
  await withSpan("orphan", { parent: contextFromCarrier({ traceparent: "not-a-traceparent" }) }, async () => {});
  const [command, dispatch, orphan] = finishedSpans();
  assert.equal(dispatch!.spanContext().traceId, command!.spanContext().traceId, "dispatch joins the command's trace");
  assert.equal(dispatch!.parentSpanContext?.spanId, command!.spanContext().spanId);
  assert.notEqual(orphan!.spanContext().traceId, command!.spanContext().traceId);
  assert.equal(orphan!.parentSpanContext, undefined);
  assert.equal(toCarrier({ traceparent: carrier!.traceparent, extra: "ignored" })?.traceparent, carrier!.traceparent);
  assert.equal(toCarrier("00-abc"), undefined);
});

test("D15 counters and queue gauges report low-cardinality values", async () => {
  const before = await metricValue("sintius.idempotency.requests", { "sintius.command.scope": "test.scope", "sintius.idempotency.outcome": "replayed" });
  telemetryMetrics.idempotency("test.scope", "replayed");
  telemetryMetrics.idempotency("test.scope", "replayed");
  telemetryMetrics.idempotency("test.scope", "executed");
  assert.equal(await metricValue("sintius.idempotency.requests", { "sintius.command.scope": "test.scope", "sintius.idempotency.outcome": "replayed" }) - before, 2);
  telemetryMetrics.queueOutcome("test.queue", "published", 0);
  assert.equal(await metricValue("sintius.queue.outcomes", { "sintius.queue.name": "test.queue" }), 0, "zero counts are not recorded");

  const unregister = registerQueueGauges("test.gauges", async () => ({
    pending: 4, leased: 1, deadLetter: 2, blockedStreams: 1, oldestDeadLetterAgeSeconds: 30, oldestUnpublishedAgeSeconds: 42,
  }));
  assert.equal(await metricValue("sintius.queue.dead_letters", { "sintius.queue.name": "test.gauges" }), 2);
  assert.equal(await metricValue("sintius.queue.oldest_unpublished_age_seconds", { "sintius.queue.name": "test.gauges" }), 42);
  unregister();
});

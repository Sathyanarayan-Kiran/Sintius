import { AggregationTemporality, InMemoryMetricExporter, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { startTelemetry, type TelemetryHandle } from "../src/sdk.ts";

/**
 * TEST SUPPORT ONLY. Registers in-memory telemetry once per test process (OpenTelemetry globals can
 * be set only once) and exposes the finished spans and cumulative metric values for assertions.
 */
interface TestTelemetry {
  readonly handle: TelemetryHandle;
  readonly spans: InMemorySpanExporter;
  readonly metricExporter: InMemoryMetricExporter;
  readonly reader: PeriodicExportingMetricReader;
}

let installed: TestTelemetry | undefined;

export function testTelemetry(): TestTelemetry {
  if (installed === undefined) {
    const spans = new InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 3_600_000 });
    const handle = startTelemetry({ serviceName: "sintius-test", spanProcessor: new SimpleSpanProcessor(spans), metricReader: reader });
    installed = { handle, spans, metricExporter, reader };
  }
  return installed;
}

export function finishedSpans(): readonly ReadableSpan[] {
  return testTelemetry().spans.getFinishedSpans();
}

export function resetSpans(): void {
  testTelemetry().spans.reset();
}

/** Current cumulative value of a counter or gauge for data points whose attributes include `match`. */
export async function metricValue(name: string, match: Readonly<Record<string, string | number | boolean>> = {}): Promise<number> {
  const telemetry = testTelemetry();
  telemetry.metricExporter.reset();
  await telemetry.reader.forceFlush();
  let total = 0;
  for (const resourceMetrics of telemetry.metricExporter.getMetrics()) {
    for (const scope of resourceMetrics.scopeMetrics) {
      for (const metric of scope.metrics) {
        if (metric.descriptor.name !== name) continue;
        for (const point of metric.dataPoints) {
          if (Object.entries(match).every(([key, value]) => point.attributes[key] === value)) total += Number(point.value);
        }
      }
    }
  }
  return total;
}

/** Every attribute, event and status message of the given spans, serialized for leak assertions. */
export function serializedTelemetry(spans: readonly ReadableSpan[]): string {
  return JSON.stringify(
    spans.map((span) => ({ name: span.name, attributes: span.attributes, events: span.events.map((event) => [event.name, event.attributes]), status: span.status })),
  );
}

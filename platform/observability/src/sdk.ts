import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider, PeriodicExportingMetricReader, type MetricReader } from "@opentelemetry/sdk-metrics";
import { BasicTracerProvider, BatchSpanProcessor, type SpanExporter, type SpanProcessor } from "@opentelemetry/sdk-trace-base";

export interface TelemetryOptions {
  readonly serviceName: string;
  readonly serviceVersion?: string;
  /** OTLP/HTTP collector base URL, for example http://127.0.0.1:4318. Defaults to OTEL_EXPORTER_OTLP_ENDPOINT. */
  readonly otlpEndpoint?: string;
  /** Replaces the OTLP span pipeline (tests use an in-memory exporter). */
  readonly spanProcessor?: SpanProcessor;
  /** Replaces the OTLP metric reader (tests use an in-memory exporter). */
  readonly metricReader?: MetricReader;
}

export interface TelemetryHandle {
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Starts OpenTelemetry for one process (decision D15): async-local context propagation, W3C trace
 * context, and trace and metric pipelines exporting OTLP to an OpenTelemetry Collector. The
 * production backend is chosen with the cloud; only the collector's exporter configuration changes.
 * Call once at the process composition root, before serving traffic.
 */
export function startTelemetry(options: TelemetryOptions): TelemetryHandle {
  const endpoint = (options.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:4318").replace(/\/$/, "");
  const resource = resourceFromAttributes({
    "service.name": options.serviceName,
    ...(options.serviceVersion === undefined ? {} : { "service.version": options.serviceVersion }),
  });

  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [options.spanProcessor ?? new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }) as SpanExporter)],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      options.metricReader ??
        new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }), exportIntervalMillis: 15_000 }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  return {
    async forceFlush() {
      await Promise.all([tracerProvider.forceFlush(), meterProvider.forceFlush()]);
    },
    async shutdown() {
      await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
      trace.disable();
      metrics.disable();
      propagation.disable();
      context.disable();
    },
  };
}

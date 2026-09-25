-- Decision D15: W3C trace context stored beside each outbox entry and delivery, so dispatch and
-- consumption continue the trace of the command that wrote the event. It is a separate column
-- because the published event envelope contract does not allow extra fields.

ALTER TABLE outbox_event
  ADD COLUMN IF NOT EXISTS trace_context jsonb
  CHECK (trace_context IS NULL OR (jsonb_typeof(trace_context) = 'object' AND length(trace_context::text) <= 1024));

ALTER TABLE event_delivery
  ADD COLUMN IF NOT EXISTS trace_context jsonb
  CHECK (trace_context IS NULL OR (jsonb_typeof(trace_context) = 'object' AND length(trace_context::text) <= 1024));

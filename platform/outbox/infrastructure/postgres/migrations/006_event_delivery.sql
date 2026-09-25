-- Interim event transport (decision D14, within ADR-009): a PostgreSQL-backed consumer queue.
-- The outbox dispatcher's publisher fans each event out to one delivery row per subscribed
-- consumer; each consumer leases its own deliveries with the same head-of-stream rules as the
-- outbox, so a consumer's dead letter blocks only that consumer's stream for that aggregate.
-- Only the relay workload role (sintius_dispatcher) touches this table: it inserts deliveries,
-- leases them and records outcomes. Consumers process deliveries through the tenant-bound inbox.

CREATE TABLE IF NOT EXISTS event_delivery (
  entry_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  consumer text NOT NULL CHECK (consumer ~ '^[a-z][a-z0-9_.:-]{0,63}$'),
  tenant_id text NOT NULL,
  event_id text NOT NULL CHECK (btrim(event_id) <> ''),
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  aggregate_type text NOT NULL CHECK (btrim(aggregate_type) <> ''),
  aggregate_id text NOT NULL CHECK (btrim(aggregate_id) <> ''),
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 1),
  envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'delivered', 'dead', 'skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL,
  enqueued_at timestamptz NOT NULL,
  leased_by text,
  lease_expires_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 2000),
  delivered_at timestamptz,
  resolution jsonb,
  -- Republishing the same event (at-least-once dispatch) never creates a second delivery.
  UNIQUE (consumer, tenant_id, event_id),
  FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id),
  CHECK ((status = 'leased') = (leased_by IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((status = 'delivered') = (delivered_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS event_delivery_open_stream_idx
  ON event_delivery (consumer, tenant_id, aggregate_type, aggregate_id, entry_id)
  WHERE status NOT IN ('delivered', 'skipped');

ALTER TABLE event_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_delivery FORCE ROW LEVEL SECURITY;

REVOKE ALL ON event_delivery FROM PUBLIC;
GRANT SELECT, INSERT ON event_delivery TO sintius_dispatcher;
GRANT UPDATE (status, attempts, next_attempt_at, leased_by, lease_expires_at, last_error, delivered_at, resolution)
  ON event_delivery TO sintius_dispatcher;

DROP POLICY IF EXISTS relay_read ON event_delivery;
CREATE POLICY relay_read ON event_delivery FOR SELECT TO sintius_dispatcher USING (true);
DROP POLICY IF EXISTS relay_insert ON event_delivery;
CREATE POLICY relay_insert ON event_delivery FOR INSERT TO sintius_dispatcher WITH CHECK (true);
DROP POLICY IF EXISTS relay_update ON event_delivery;
CREATE POLICY relay_update ON event_delivery FOR UPDATE TO sintius_dispatcher USING (true) WITH CHECK (true);

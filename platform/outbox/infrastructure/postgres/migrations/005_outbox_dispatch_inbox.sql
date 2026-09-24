-- Outbox relay and consumer inbox. The dispatcher runs as its own workload role: it may lease and
-- mark outbox rows across tenants, but cannot append events, rewrite envelopes or read domain tables.
-- Operator dead-letter resolution uses the same role and audits against the entry's own tenant.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sintius_dispatcher') THEN
    CREATE ROLE sintius_dispatcher LOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

ALTER TABLE outbox_event
  ADD CONSTRAINT outbox_event_lease_consistency
  CHECK ((status = 'leased') = (leased_by IS NOT NULL AND lease_expires_at IS NOT NULL));

ALTER TABLE outbox_event
  ADD CONSTRAINT outbox_event_published_consistency
  CHECK ((status = 'published') = (published_at IS NOT NULL));

ALTER TABLE outbox_event
  ADD CONSTRAINT outbox_event_last_error_length
  CHECK (last_error IS NULL OR length(last_error) <= 2000);

-- Head-of-stream lookups only ever inspect unfinished entries.
CREATE INDEX IF NOT EXISTS outbox_event_open_stream_idx
  ON outbox_event (tenant_id, aggregate_type, aggregate_id, entry_id)
  WHERE status NOT IN ('published', 'skipped');

GRANT SELECT ON outbox_event TO sintius_dispatcher;
GRANT UPDATE (status, attempts, next_attempt_at, leased_by, lease_expires_at, last_error, published_at, resolution)
  ON outbox_event TO sintius_dispatcher;

DROP POLICY IF EXISTS dispatcher_read ON outbox_event;
CREATE POLICY dispatcher_read ON outbox_event FOR SELECT TO sintius_dispatcher USING (true);
DROP POLICY IF EXISTS dispatcher_update ON outbox_event;
CREATE POLICY dispatcher_update ON outbox_event FOR UPDATE TO sintius_dispatcher USING (true) WITH CHECK (true);

-- Dead-letter resolution audit rows: only for the tenant the transaction bound after resolving the entry.
GRANT INSERT ON audit_event TO sintius_dispatcher;
DROP POLICY IF EXISTS dispatcher_dead_letter_audit ON audit_event;
CREATE POLICY dispatcher_dead_letter_audit ON audit_event
  FOR INSERT TO sintius_dispatcher
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE IF NOT EXISTS inbox_record (
  tenant_id text NOT NULL,
  consumer text NOT NULL CHECK (consumer ~ '^[a-z][a-z0-9_.:-]{0,63}$'),
  event_id text NOT NULL CHECK (btrim(event_id) <> ''),
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, consumer, event_id),
  FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
);

ALTER TABLE inbox_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_record FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inbox_record;
CREATE POLICY tenant_isolation ON inbox_record
  FOR ALL TO sintius_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

REVOKE ALL ON inbox_record FROM PUBLIC;
GRANT SELECT, INSERT ON inbox_record TO sintius_app;

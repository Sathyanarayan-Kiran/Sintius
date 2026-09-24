-- Tenant-scoped idempotency records. The primary key is the database serialization point for
-- concurrent retries; INSERT ... ON CONFLICT waits for the winning transaction to finish.

CREATE TABLE IF NOT EXISTS idempotency_record (
  tenant_id text NOT NULL,
  command_scope text NOT NULL CHECK (btrim(command_scope) <> ''),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 128),
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  status text NOT NULL CHECK (status IN ('processing', 'completed')),
  response_status integer CHECK (response_status BETWEEN 100 AND 599),
  response_body jsonb,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  PRIMARY KEY (tenant_id, command_scope, idempotency_key),
  FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id),
  CHECK (
    (status = 'processing' AND response_status IS NULL AND response_body IS NULL)
    OR (status = 'completed' AND response_status IS NOT NULL AND response_body IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idempotency_record_expiry_idx ON idempotency_record (expires_at);

ALTER TABLE idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_record FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON idempotency_record;
CREATE POLICY tenant_isolation ON idempotency_record
  FOR ALL TO sintius_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

REVOKE ALL ON idempotency_record FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON idempotency_record TO sintius_app;

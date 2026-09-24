CREATE TABLE IF NOT EXISTS foundation_proof_record (
  tenant_id text NOT NULL,
  proof_record_id text NOT NULL CHECK (btrim(proof_record_id) <> ''),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  actor_id text NOT NULL CHECK (btrim(actor_id) <> ''),
  correlation_id text NOT NULL CHECK (btrim(correlation_id) <> ''),
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, proof_record_id),
  FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
);

ALTER TABLE foundation_proof_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE foundation_proof_record FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON foundation_proof_record;
CREATE POLICY tenant_isolation ON foundation_proof_record
  FOR ALL TO sintius_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

REVOKE ALL ON foundation_proof_record FROM PUBLIC;
GRANT SELECT, INSERT ON foundation_proof_record TO sintius_app;

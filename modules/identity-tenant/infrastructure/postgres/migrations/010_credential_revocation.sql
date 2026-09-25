-- Revoked credentials (P0-004, BL-002-02). Authentication reads this list on every request, before
-- any tenant is known, so it is keyed by the issuer and token ID and holds no tenant data. The
-- application role may only read it; revocations are written by the identity-provider feed or an
-- operator runbook under the migration role until a revocation command exists.

CREATE TABLE IF NOT EXISTS credential_revocation (
  issuer text NOT NULL CHECK (btrim(issuer) <> ''),
  credential_id text NOT NULL CHECK (btrim(credential_id) <> ''),
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- The credential's own expiry: after it the row can be purged, because the token is dead anyway.
  expires_at timestamptz NOT NULL,
  reason text CHECK (reason IS NULL OR length(reason) <= 500),
  PRIMARY KEY (issuer, credential_id)
);

CREATE INDEX IF NOT EXISTS credential_revocation_expiry_idx ON credential_revocation (expires_at);

ALTER TABLE credential_revocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential_revocation FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS revocation_read ON credential_revocation;
CREATE POLICY revocation_read ON credential_revocation FOR SELECT TO sintius_app USING (true);

REVOKE ALL ON credential_revocation FROM PUBLIC;
GRANT SELECT ON credential_revocation TO sintius_app;

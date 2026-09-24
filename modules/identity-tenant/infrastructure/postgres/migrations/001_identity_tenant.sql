-- Local-development baseline. Identifiers stay text until SPIKE-03 selects ULID or UUIDv7.
-- Production credentials must not use the trust authentication configured by compose.yaml.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sintius_app') THEN
    CREATE ROLE sintius_app LOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS tenant (
  tenant_id text PRIMARY KEY CHECK (btrim(tenant_id) <> ''),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  state text NOT NULL CHECK (state IN ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS tenant_identity_provider (
  tenant_id text NOT NULL,
  provider_id text NOT NULL CHECK (btrim(provider_id) <> ''),
  mechanism text NOT NULL CHECK (mechanism IN ('oidc', 'saml', 'workload_token')),
  issuer text NOT NULL CHECK (btrim(issuer) <> ''),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  PRIMARY KEY (tenant_id, provider_id),
  FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
);

CREATE TABLE IF NOT EXISTS tenant_role (
  tenant_id text NOT NULL,
  role_code text NOT NULL CHECK (btrim(role_code) <> ''),
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(permissions) = 'array'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'retired')),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  PRIMARY KEY (tenant_id, role_code),
  FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
);

CREATE TABLE IF NOT EXISTS tenant_role_assignment (
  tenant_id text NOT NULL,
  actor_id text NOT NULL CHECK (btrim(actor_id) <> ''),
  role_code text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, actor_id, role_code),
  FOREIGN KEY (tenant_id, role_code) REFERENCES tenant_role (tenant_id, role_code),
  CHECK ((status = 'active' AND revoked_at IS NULL) OR status = 'revoked')
);

CREATE TABLE IF NOT EXISTS approval_policy (
  tenant_id text NOT NULL,
  action_type text NOT NULL CHECK (btrim(action_type) <> ''),
  required_approvals integer NOT NULL CHECK (required_approvals >= 1),
  separation_of_duties boolean NOT NULL DEFAULT true,
  expires_after_seconds integer NOT NULL CHECK (expires_after_seconds > 0),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  PRIMARY KEY (tenant_id, action_type),
  FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
);

CREATE TABLE IF NOT EXISTS audit_event (
  tenant_id text NOT NULL,
  audit_event_id text NOT NULL CHECK (btrim(audit_event_id) <> ''),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  actor jsonb NOT NULL CHECK (jsonb_typeof(actor) = 'object'),
  action text NOT NULL CHECK (btrim(action) <> ''),
  target jsonb NOT NULL CHECK (jsonb_typeof(target) = 'object'),
  reason text,
  correlation_id text NOT NULL CHECK (btrim(correlation_id) <> ''),
  causation_id text,
  approval_id text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  evidence_hash text NOT NULL CHECK (length(evidence_hash) = 64),
  PRIMARY KEY (tenant_id, audit_event_id),
  FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
);

CREATE TABLE IF NOT EXISTS outbox_event (
  entry_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  event_id text NOT NULL CHECK (btrim(event_id) <> ''),
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  aggregate_type text NOT NULL CHECK (btrim(aggregate_type) <> ''),
  aggregate_id text NOT NULL CHECK (btrim(aggregate_id) <> ''),
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 1),
  envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'published', 'dead', 'skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL,
  appended_at timestamptz NOT NULL,
  leased_by text,
  lease_expires_at timestamptz,
  last_error text,
  published_at timestamptz,
  resolution jsonb,
  UNIQUE (tenant_id, event_id),
  FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
);

CREATE INDEX IF NOT EXISTS outbox_event_dispatch_idx
  ON outbox_event (status, next_attempt_at, tenant_id, aggregate_type, aggregate_id, aggregate_version);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenant', 'tenant_identity_provider', 'tenant_role', 'tenant_role_assignment',
    'approval_policy', 'audit_event', 'outbox_event'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO sintius_app USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      table_name
    );
  END LOOP;
END
$$;

REVOKE ALL ON tenant, tenant_identity_provider, tenant_role, tenant_role_assignment, approval_policy, audit_event, outbox_event FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON tenant, tenant_identity_provider, tenant_role, tenant_role_assignment, approval_policy TO sintius_app;
GRANT INSERT ON audit_event, outbox_event TO sintius_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sintius_app;

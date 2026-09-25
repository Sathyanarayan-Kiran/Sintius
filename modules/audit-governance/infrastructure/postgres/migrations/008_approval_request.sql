-- Maker-checker evidence (Audit & Governance). A request's identity, target and policy snapshot are
-- written once; later changes may only settle a PENDING request by appending decisions, one version
-- at a time. The application role cannot delete, cannot rewrite the target, and the trigger below
-- enforces the append-only, pending-only rules even for statements that pass the column grants.

CREATE TABLE IF NOT EXISTS approval_request (
  tenant_id text NOT NULL,
  approval_id text NOT NULL CHECK (btrim(approval_id) <> ''),
  action_type text NOT NULL CHECK (btrim(action_type) <> ''),
  target_type text NOT NULL CHECK (btrim(target_type) <> ''),
  target_id text NOT NULL CHECK (btrim(target_id) <> ''),
  target_version bigint NOT NULL CHECK (target_version >= 1),
  maker_id text NOT NULL CHECK (btrim(maker_id) <> ''),
  required_approvals integer NOT NULL CHECK (required_approvals >= 1),
  separation_of_duties boolean NOT NULL,
  approver_requirements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(approver_requirements) = 'array'),
  status text NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(decisions) = 'array'),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  PRIMARY KEY (tenant_id, approval_id),
  FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
);

CREATE INDEX IF NOT EXISTS approval_request_pending_expiry_idx
  ON approval_request (tenant_id, expires_at) WHERE status = 'PENDING';

CREATE OR REPLACE FUNCTION approval_request_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'approval request % is already settled', OLD.approval_id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.row_version <> OLD.row_version + 1 THEN
    RAISE EXCEPTION 'approval request versions advance by exactly one' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(NEW.decisions) < jsonb_array_length(OLD.decisions)
     OR (SELECT coalesce(jsonb_agg(item.value ORDER BY item.position), '[]'::jsonb)
           FROM jsonb_array_elements(NEW.decisions) WITH ORDINALITY AS item(value, position)
          WHERE item.position <= jsonb_array_length(OLD.decisions)) <> OLD.decisions THEN
    RAISE EXCEPTION 'approval decisions are append-only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS approval_request_append_only ON approval_request;
CREATE TRIGGER approval_request_append_only
  BEFORE UPDATE ON approval_request
  FOR EACH ROW EXECUTE FUNCTION approval_request_append_only();

ALTER TABLE approval_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_request FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON approval_request;
CREATE POLICY tenant_isolation ON approval_request
  FOR ALL TO sintius_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

REVOKE ALL ON approval_request FROM PUBLIC;
GRANT SELECT, INSERT ON approval_request TO sintius_app;
GRANT UPDATE (status, decisions, row_version) ON approval_request TO sintius_app;

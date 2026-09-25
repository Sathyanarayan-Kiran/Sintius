-- Role-scoped permission limits (D9). A limit narrows one role's own grant, for example a Billing
-- Administrator who may refund only up to a threshold, without affecting another role (such as
-- the Finance Controller) that holds the same permission unlimited. Each entry is
-- {"permission", "attribute", "operator", "value"}; the evaluator fails closed on anything else.

ALTER TABLE tenant_role
  ADD COLUMN IF NOT EXISTS permission_limits jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(permission_limits) = 'array');

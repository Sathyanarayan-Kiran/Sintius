-- Decision D4: an approval policy lists which permissions approvers must hold and how many
-- distinct approvals each needs, as [{"permission": "...", "count": n}]. Empty means any holder of
-- approval:request:decide counts toward required_approvals.

ALTER TABLE approval_policy
  ADD COLUMN IF NOT EXISTS approver_requirements jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(approver_requirements) = 'array');

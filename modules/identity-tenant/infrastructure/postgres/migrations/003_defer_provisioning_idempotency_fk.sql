-- Provisioning claims idempotency before inserting the tenant in the same transaction. Defer the
-- referential check until commit so a failed provisioning attempt still rolls both records back.

ALTER TABLE idempotency_record
  DROP CONSTRAINT idempotency_record_tenant_id_fkey;

ALTER TABLE idempotency_record
  ADD CONSTRAINT idempotency_record_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
  DEFERRABLE INITIALLY DEFERRED;

-- The audit trail is append-only. Any UPDATE or DELETE is rejected, whoever issues it.
-- A database superuser can still bypass this (e.g. by disabling triggers); the hash chain
-- exists so that such tampering is detected by "Verify chain".
CREATE OR REPLACE FUNCTION audit_record_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditRecord is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_record_no_update
  BEFORE UPDATE OR DELETE ON "AuditRecord"
  FOR EACH ROW EXECUTE FUNCTION audit_record_append_only();

-- Rule versions are immutable too.
CREATE OR REPLACE FUNCTION rule_version_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'RuleVersion is immutable: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rule_version_no_update
  BEFORE UPDATE OR DELETE ON "RuleVersion"
  FOR EACH ROW EXECUTE FUNCTION rule_version_immutable();

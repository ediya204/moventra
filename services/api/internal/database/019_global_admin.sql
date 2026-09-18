-- Global application administration. No customer, scoped grant or balance is changed.
CREATE TABLE global_admins (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 granted_at timestamptz NOT NULL DEFAULT now(),
 evidence_ref text NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 300)
);
CREATE TABLE global_admin_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL CHECK(action IN ('grant','revoke')),
 evidence_ref text NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 300),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER global_admin_audit_immutable BEFORE UPDATE OR DELETE ON global_admin_audit
 FOR EACH ROW EXECUTE FUNCTION manual_funds_immutable();
CREATE VIEW active_global_admins AS
 SELECT g.user_id FROM global_admins g JOIN users u ON u.id=g.user_id
 WHERE u.role='admin' AND u.status='active'
 AND NOT EXISTS(SELECT 1 FROM customers c WHERE c.personal_owner_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id);
CREATE FUNCTION is_global_admin(actor uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM active_global_admins WHERE user_id=actor)
$$;
CREATE VIEW effective_staff_grants AS
 SELECT user_id,customer_id,permission FROM staff_grants
 UNION SELECT a.user_id,c.id,p.permission FROM active_global_admins a CROSS JOIN customers c
 CROSS JOIN (VALUES('accounts:read'),('transactions:read'),('onboarding:review')) p(permission);
CREATE VIEW effective_channel_read_grants AS
 SELECT connection_id,user_id FROM channel_read_grants
 UNION SELECT c.id,a.user_id FROM active_global_admins a CROSS JOIN channel_connections c;
CREATE VIEW effective_ledger_read_grants AS
 SELECT customer_id,user_id FROM ledger_read_grants
 UNION SELECT c.id,a.user_id FROM active_global_admins a CROSS JOIN customers c;
CREATE VIEW effective_manual_funds_grants AS
 SELECT user_id,scope,permission FROM manual_funds_grants
 UNION SELECT a.user_id,'*',p.permission FROM active_global_admins a
 CROSS JOIN (VALUES('read'),('create'),('review'),('execute')) p(permission);
CREATE VIEW effective_issuing_grants AS
 SELECT user_id,scope_id,permission FROM issuing_grants
 UNION SELECT a.user_id,'catalog',p.permission FROM active_global_admins a
 CROSS JOIN (VALUES('catalog:read'),('catalog:write'),('pricing:write')) p(permission)
 UNION SELECT a.user_id,c.id::text,p.permission FROM active_global_admins a CROSS JOIN customers c
 CROSS JOIN (VALUES('customer:read'),('customer:write'),('funding:submit'),('funding:review'),('recovery:write')) p(permission);
-- A runtime namespace parameter preserves namespace separation without assuming it
-- already has a wallet, settings row or scoped grant.
CREATE FUNCTION effective_crypto_grants(ns text)
 RETURNS TABLE(namespace text,customer_id uuid,user_id uuid,permission text) LANGUAGE sql STABLE AS $$
 SELECT namespace,customer_id,user_id,permission FROM crypto_grants WHERE namespace=ns
 UNION SELECT ns,c.id,a.user_id,p.permission FROM active_global_admins a CROSS JOIN customers c
 CROSS JOIN (VALUES('read'),('review'),('configure'),('recover')) p(permission)
 WHERE c.kind='personal'
$$;
CREATE VIEW effective_crypto_connection_grants AS
 SELECT namespace,connection_id,user_id,permission FROM crypto_connection_grants
 UNION SELECT s.namespace,s.connection_id,a.user_id,p.permission
 FROM crypto_sync s CROSS JOIN active_global_admins a CROSS JOIN (VALUES('read'),('sync')) p(permission);

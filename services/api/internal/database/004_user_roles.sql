-- Explicit application roles; resource grants remain data scopes.
-- Mixed legacy identities need explicit review, never silent reassignment.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM users u WHERE EXISTS
        (SELECT 1 FROM staff_grants g WHERE g.user_id=u.id)
        AND (EXISTS (SELECT 1 FROM customers c WHERE c.personal_owner_id=u.id)
          OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id))) THEN
        RAISE EXCEPTION 'mixed customer/operator identities require review before role migration';
    END IF;
END $$;
ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'customer'
    CHECK (role IN ('customer', 'admin'));
-- Preserve existing operators without opening new customer/resource scopes.
UPDATE users SET role='admin' WHERE EXISTS
    (SELECT 1 FROM staff_grants g WHERE g.user_id=users.id);

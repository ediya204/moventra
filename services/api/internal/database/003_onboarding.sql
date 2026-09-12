-- Local implementation; run only through an explicitly authorized migration.
ALTER TABLE staff_grants DROP CONSTRAINT staff_grants_permission_check;
ALTER TABLE staff_grants ADD CONSTRAINT staff_grants_permission_check CHECK (permission IN ('accounts:read','transactions:read','onboarding:review'));
ALTER TABLE customers ADD COLUMN onboarding_revision bigint NOT NULL DEFAULT 0;
CREATE TABLE onboarding_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 customer_id uuid NOT NULL REFERENCES customers(id),
 actor_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL,
 reason text NOT NULL,
 revision bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(customer_id,revision)
);

-- Registration-directory access is distinct from customer business access.
-- No identity, customer, role or resource grant is changed by this migration.
CREATE TABLE user_directory_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id uuid NOT NULL REFERENCES users(id),
    action text NOT NULL CHECK (action IN ('users:list', 'users:email-search')),
    result_count integer NOT NULL CHECK (result_count BETWEEN 0 AND 50),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_directory_audit_actor_time ON user_directory_audit(actor_id, created_at);

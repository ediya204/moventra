-- Explicit migration only. No grants, balances or provider settings are seeded.
CREATE TABLE manual_funds_grants (
 user_id uuid NOT NULL REFERENCES users(id), scope text NOT NULL,
 permission text NOT NULL CHECK(permission IN ('read','create','review','execute')),
 PRIMARY KEY(user_id,scope,permission),
 CHECK(scope='*' OR scope ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
CREATE TABLE manual_funds_orders (
 id uuid PRIMARY KEY, namespace text NOT NULL, customer_id uuid NOT NULL REFERENCES customers(id),
 actor_id uuid NOT NULL REFERENCES users(id), reviewer_id uuid REFERENCES users(id),
 direction text NOT NULL CHECK(direction IN ('credit','debit')),
 source text NOT NULL CHECK(source IN ('platform_advance','offline_receipt','advance_recovery','offline_payout','reversal')),
 currency text NOT NULL CHECK(currency='USD'), amount_minor numeric(38,0) NOT NULL CHECK(amount_minor>0),
 note text NOT NULL CHECK(length(note) BETWEEN 1 AND 500), evidence_ref text NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 180),
 original_id uuid REFERENCES manual_funds_orders(id),
 state text NOT NULL CHECK(state IN ('pending_review','reserving','processing','awaiting_payment','releasing','completed','rejected','cancelled','failed')),
 resolution text NOT NULL DEFAULT '', error text NOT NULL DEFAULT '',
 revision bigint NOT NULL DEFAULT 1, wallet_before_minor numeric(38,0),wallet_after_minor numeric(38,0),
 payment_evidence text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(namespace,evidence_ref),
 CHECK((source IN ('platform_advance','offline_receipt') AND direction='credit' AND original_id IS NULL) OR (source='advance_recovery' AND direction='debit' AND original_id IS NOT NULL) OR (source='offline_payout' AND direction='debit' AND original_id IS NULL) OR (source='reversal' AND original_id IS NOT NULL))
);
CREATE INDEX manual_orders_recent ON manual_funds_orders(namespace,customer_id,created_at DESC,id);
CREATE INDEX manual_orders_work ON manual_funds_orders(namespace,updated_at,id) WHERE state IN ('reserving','processing','releasing');
CREATE UNIQUE INDEX manual_one_reversal ON manual_funds_orders(namespace,original_id) WHERE source='reversal' AND state NOT IN ('failed','rejected','cancelled');
CREATE TABLE manual_funds_commands (
 namespace text NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),request_id uuid NOT NULL,
 request_hash text NOT NULL,order_id uuid NOT NULL REFERENCES manual_funds_orders(id),
 PRIMARY KEY(namespace,actor_id,request_id)
);
CREATE TABLE manual_funds_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, namespace text NOT NULL,customer_id uuid REFERENCES customers(id),
 order_id uuid REFERENCES manual_funds_orders(id),actor_id uuid REFERENCES users(id),
 action text NOT NULL,data jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION manual_funds_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'manual funds audit is append-only'; END $$;
CREATE TRIGGER manual_funds_audit_immutable BEFORE UPDATE OR DELETE ON manual_funds_audit FOR EACH ROW EXECUTE FUNCTION manual_funds_immutable();

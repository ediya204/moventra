-- Internal commercial configuration and durable issuance, isolated from shadow.
CREATE FUNCTION issuing_immutable_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'issuing evidence is append-only'; END $$;
CREATE TABLE issuing_grants (
 user_id uuid NOT NULL REFERENCES users(id), scope_id text NOT NULL,
 permission text NOT NULL CHECK(permission IN ('catalog:read','catalog:write','pricing:write','customer:read','customer:write','funding:submit','funding:review','recovery:write')),
 PRIMARY KEY(user_id,scope_id,permission)
);
CREATE TABLE issuing_suppliers (
 id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 adapter text NOT NULL CHECK(adapter IN ('manual','slash')), status text NOT NULL CHECK(status IN ('active','paused','archived')),
 account_ref text NOT NULL DEFAULT '', entity_ref text NOT NULL DEFAULT '', revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE issuing_products (
 id uuid PRIMARY KEY, supplier_id uuid NOT NULL REFERENCES issuing_suppliers(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120), bin text NOT NULL CHECK(bin ~ '^([0-9]{6}|[0-9]{8})$'),
 network text NOT NULL DEFAULT '' CHECK(network IN ('','visa','mastercard')), upstream_id text NOT NULL CHECK(length(upstream_id) BETWEEN 1 AND 180),
 status text NOT NULL CHECK(status IN ('draft','active','paused','archived')), description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 fee_minor numeric(20,0) CHECK(fee_minor>=0), minimum_minor numeric(20,0) CHECK(minimum_minor>0),
 CHECK(status IN ('draft','archived') OR (network<>'' AND fee_minor IS NOT NULL AND minimum_minor IS NOT NULL)),
 revision bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX issuing_products_list ON issuing_products(status,created_at,id);
CREATE TABLE issuing_groups (id uuid PRIMARY KEY,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),revision bigint NOT NULL DEFAULT 1);
CREATE TABLE issuing_customers (
 customer_id uuid PRIMARY KEY REFERENCES customers(id), group_id uuid REFERENCES issuing_groups(id),
 enabled boolean NOT NULL DEFAULT false, revision bigint NOT NULL DEFAULT 1
);
CREATE TABLE issuing_cardholders (
 customer_id uuid NOT NULL REFERENCES customers(id), supplier_id uuid NOT NULL REFERENCES issuing_suppliers(id),
 cardholder_ref text NOT NULL CHECK(length(cardholder_ref) BETWEEN 1 AND 180), evidence_ref text NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 300),
 PRIMARY KEY(customer_id,supplier_id), UNIQUE(supplier_id,cardholder_ref)
);
CREATE TABLE issuing_prices (
 product_id uuid NOT NULL REFERENCES issuing_products(id), scope_kind text NOT NULL CHECK(scope_kind IN ('customer','group')),
 scope_id uuid NOT NULL, fee_minor numeric(20,0) NOT NULL CHECK(fee_minor>=0), revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(product_id,scope_kind,scope_id)
);
CREATE TABLE issuing_quotes (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id), product_id uuid NOT NULL REFERENCES issuing_products(id),
 fingerprint text NOT NULL, snapshot jsonb NOT NULL, fee_minor numeric(20,0) NOT NULL, funding_minor numeric(20,0) NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(customer_id,id)
);
CREATE TABLE issuing_orders (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id), product_id uuid NOT NULL REFERENCES issuing_products(id),
 quote_id uuid NOT NULL UNIQUE, idempotency_key uuid NOT NULL, parent_id uuid REFERENCES issuing_orders(id),
 snapshot jsonb NOT NULL, fee_minor numeric(20,0) NOT NULL, funding_minor numeric(20,0) NOT NULL,
 state text NOT NULL CHECK(state IN ('queued','reserved','creating','provider_unknown','created','fee_charged','funded','enabling','active','releasing','failed','funding_failed','review_required')),
 external_card_id text NOT NULL DEFAULT '', last4 text NOT NULL DEFAULT '', error_code text NOT NULL DEFAULT '',
 supplier_id uuid NOT NULL REFERENCES issuing_suppliers(id), attempt_at timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(customer_id,id), UNIQUE(customer_id,idempotency_key), FOREIGN KEY(customer_id,quote_id) REFERENCES issuing_quotes(customer_id,id)
);
CREATE UNIQUE INDEX issuing_card_identity ON issuing_orders(supplier_id,external_card_id) WHERE external_card_id<>'' AND parent_id IS NULL;
CREATE INDEX issuing_orders_queue ON issuing_orders(next_attempt_at,created_at) WHERE state NOT IN ('active','failed','funding_failed','review_required');
CREATE TABLE issuing_deposits (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id), amount_minor numeric(20,0) NOT NULL CHECK(amount_minor>0),
 evidence_ref text NOT NULL UNIQUE CHECK(length(evidence_ref) BETWEEN 1 AND 300), submitted_by uuid NOT NULL REFERENCES users(id),
 reviewed_by uuid REFERENCES users(id), state text NOT NULL CHECK(state IN ('submitted','approved','rejected','applied')),
 revision bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(reviewed_by IS NULL OR reviewed_by<>submitted_by)
);
CREATE TABLE issuing_balances (
 customer_id uuid NOT NULL REFERENCES customers(id), account_key text NOT NULL, blnk_id text NOT NULL UNIQUE,
 PRIMARY KEY(customer_id,account_key)
);
CREATE TABLE issuing_journal (
 reference text PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id), transaction_id text NOT NULL UNIQUE,
 source_id text NOT NULL, destination_id text NOT NULL, amount_minor numeric(20,0) NOT NULL CHECK(amount_minor>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE issuing_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid REFERENCES users(id),
 customer_id uuid REFERENCES customers(id), resource_id text NOT NULL, action text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER issuing_journal_immutable BEFORE UPDATE OR DELETE ON issuing_journal FOR EACH ROW EXECUTE FUNCTION issuing_immutable_evidence();
CREATE TRIGGER issuing_audit_immutable BEFORE UPDATE OR DELETE ON issuing_audit FOR EACH ROW EXECUTE FUNCTION issuing_immutable_evidence();
-- Source receipts for newly issued cards only; immutable observations retain corrections.
CREATE TABLE issuing_source_observations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id uuid NOT NULL REFERENCES issuing_orders(id),
 source_id text NOT NULL, fingerprint text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id,source_id,fingerprint)
);
CREATE TABLE issuing_postings (
 order_id uuid NOT NULL REFERENCES issuing_orders(id), source_id text NOT NULL,
 amount_minor numeric(20,0) NOT NULL, detailed_status text NOT NULL,
 state text NOT NULL CHECK(state IN ('applied','review_required')), reason text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(order_id,source_id)
);
CREATE TABLE issuing_sync (
 order_id uuid PRIMARY KEY REFERENCES issuing_orders(id), cursor text NOT NULL DEFAULT '',
 state text NOT NULL DEFAULT 'pending', last_success_at timestamptz, last_cycle_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER issuing_observations_immutable BEFORE UPDATE OR DELETE ON issuing_source_observations FOR EACH ROW EXECUTE FUNCTION issuing_immutable_evidence();
CREATE TABLE issuing_supplier_blocks (
 supplier_id uuid PRIMARY KEY REFERENCES issuing_suppliers(id), reason text NOT NULL,
 blocked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE issuing_catalog_sources (
 supplier_id uuid NOT NULL REFERENCES issuing_suppliers(id), upstream_id text NOT NULL,
 prefix text NOT NULL, source_status text NOT NULL CHECK(source_status IN ('active','inactive')),
 product_id uuid NOT NULL REFERENCES issuing_products(id), observed_at timestamptz NOT NULL,
 evidence_ref text NOT NULL, PRIMARY KEY(supplier_id,upstream_id), UNIQUE(product_id)
);

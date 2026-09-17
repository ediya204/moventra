CREATE TABLE online_test_funds_review_grants (
 user_id uuid NOT NULL REFERENCES users(id), customer_id uuid NOT NULL REFERENCES customers(id),
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,customer_id)
);
CREATE TABLE online_test_funds_quotes (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id), actor_id uuid NOT NULL REFERENCES users(id),
 currency text NOT NULL CHECK(currency IN ('USD','USDT')), amount_minor bigint NOT NULL CHECK(amount_minor>0),
 fee_minor bigint NOT NULL CHECK(fee_minor>=0 AND fee_minor<amount_minor), receive_minor bigint NOT NULL CHECK(receive_minor>0),
 policy_version text NOT NULL CHECK(policy_version='test-v1'), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(customer_id,id)
);
CREATE TABLE online_test_funds_orders (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id), actor_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('deposit','exchange','withdraw')), currency text NOT NULL CHECK(currency IN ('USD','USDT')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0), fee_minor bigint NOT NULL CHECK(fee_minor>=0),
 receive_minor bigint NOT NULL CHECK(receive_minor>=0), quote_id uuid UNIQUE,
 recipient_label text NOT NULL DEFAULT '',
 status text NOT NULL CHECK(status IN ('pending','confirming','pending_review','processing','unknown','completed','cancelled','rejected','failed')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(customer_id,id), FOREIGN KEY(customer_id,quote_id) REFERENCES online_test_funds_quotes(customer_id,id),
 CHECK((kind='exchange' AND quote_id IS NOT NULL AND status='completed') OR (kind<>'exchange' AND quote_id IS NULL)),
 CHECK(kind<>'deposit' OR fee_minor=0)
);
CREATE INDEX online_test_funds_customer_time ON online_test_funds_orders(customer_id,created_at DESC,id);
CREATE TABLE online_test_funds_movements (
 customer_id uuid NOT NULL, order_id uuid NOT NULL, currency text NOT NULL CHECK(currency IN ('USD','USDT')),
 wallet_delta_minor bigint NOT NULL CHECK(wallet_delta_minor<>0), counter_delta_minor bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(order_id,currency),
 FOREIGN KEY(customer_id,order_id) REFERENCES online_test_funds_orders(customer_id,id),
 CHECK(wallet_delta_minor::numeric+counter_delta_minor::numeric=0)
);
CREATE TABLE online_test_funds_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, customer_id uuid NOT NULL, order_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL, status text NOT NULL, revision bigint NOT NULL,
 note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(order_id,revision),
 FOREIGN KEY(customer_id,order_id) REFERENCES online_test_funds_orders(customer_id,id)
);
CREATE TABLE online_test_funds_commands (
 customer_id uuid NOT NULL REFERENCES customers(id), actor_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL,
 request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(customer_id,actor_id,request_id)
);
CREATE TRIGGER online_test_funds_movements_immutable BEFORE UPDATE OR DELETE ON online_test_funds_movements FOR EACH ROW EXECUTE FUNCTION reject_online_test_wallet_mutation();
CREATE TRIGGER online_test_funds_events_immutable BEFORE UPDATE OR DELETE ON online_test_funds_events FOR EACH ROW EXECUTE FUNCTION reject_online_test_wallet_mutation();
CREATE TRIGGER online_test_funds_commands_immutable BEFORE UPDATE OR DELETE ON online_test_funds_commands FOR EACH ROW EXECUTE FUNCTION reject_online_test_wallet_mutation();
CREATE TRIGGER online_test_funds_quotes_immutable BEFORE UPDATE OR DELETE ON online_test_funds_quotes FOR EACH ROW EXECUTE FUNCTION reject_online_test_wallet_mutation();

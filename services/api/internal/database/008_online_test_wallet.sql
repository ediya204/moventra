-- Synthetic online testing credits only. Never read by a payment/ledger adapter.
CREATE TABLE online_test_wallet_grants (
 request_id uuid PRIMARY KEY,
 customer_id uuid NOT NULL REFERENCES customers(id),
 target_user_id uuid NOT NULL REFERENCES users(id),
 usd_minor bigint NOT NULL CHECK(usd_minor > 0),
 usdt_minor bigint NOT NULL CHECK(usdt_minor > 0),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 executed_by text NOT NULL CHECK(executed_by='trusted_cli_user_request'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX online_test_wallet_customer ON online_test_wallet_grants(customer_id,created_at DESC,request_id);
CREATE FUNCTION reject_online_test_wallet_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'test_wallet_grants_are_immutable'; END;
$$;
CREATE TRIGGER online_test_wallet_immutable BEFORE UPDATE OR DELETE ON online_test_wallet_grants
FOR EACH ROW EXECUTE FUNCTION reject_online_test_wallet_mutation();

-- Consent is immutable evidence, never inferred for historical orders.
CREATE TABLE issuing_consents (
 order_id uuid PRIMARY KEY REFERENCES issuing_orders(id),
 customer_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 request_hash text NOT NULL, terms_version text NOT NULL, terms_digest text NOT NULL,
 terms_text text NOT NULL, lawful_use boolean NOT NULL CHECK(lawful_use),
 accepted_terms boolean NOT NULL CHECK(accepted_terms), accepted_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(customer_id,order_id) REFERENCES issuing_orders(customer_id,id)
);
CREATE TRIGGER issuing_consents_immutable BEFORE UPDATE OR DELETE ON issuing_consents FOR EACH ROW EXECUTE FUNCTION issuing_immutable_evidence();
ALTER TABLE issuing_quotes ADD COLUMN terms_version text NOT NULL DEFAULT '';
ALTER TABLE issuing_orders ADD COLUMN retry_count integer NOT NULL DEFAULT 0;

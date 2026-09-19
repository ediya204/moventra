-- Customer-authored metadata, independent from imported channel facts.
CREATE TABLE customer_card_remarks (
 customer_id uuid NOT NULL REFERENCES customers(id),
 connection_id text NOT NULL REFERENCES channel_connections(id),
 external_card_id text NOT NULL,
 remark text NOT NULL CHECK(char_length(remark)<=200),
 revision integer NOT NULL CHECK(revision>0),
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(customer_id,connection_id,external_card_id)
);

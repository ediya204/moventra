-- Internal ownership only: never stored in the provider object or used as a payment authorization.
CREATE TABLE IF NOT EXISTS internal_card_owners (
 namespace TEXT NOT NULL, platform TEXT NOT NULL, connection_id TEXT NOT NULL, card_id TEXT NOT NULL,
 user_id TEXT NOT NULL, revision INTEGER NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(namespace,platform,connection_id,card_id),
 FOREIGN KEY(namespace,user_id) REFERENCES mg_users(namespace,id)
);
CREATE INDEX IF NOT EXISTS internal_card_owners_user ON internal_card_owners(namespace,user_id);

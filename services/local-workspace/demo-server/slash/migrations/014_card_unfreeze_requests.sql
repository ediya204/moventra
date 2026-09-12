-- Additive local workflow; preserves existing cards, money and ownership.
CREATE TABLE IF NOT EXISTS ca_unfreeze_requests(
 namespace TEXT NOT NULL, operation_id TEXT NOT NULL, card_id TEXT NOT NULL,
 owner_id TEXT NOT NULL, freeze_revision INTEGER NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(namespace,operation_id),
 FOREIGN KEY(namespace,operation_id) REFERENCES ca_operations(namespace,id),
 FOREIGN KEY(namespace,card_id) REFERENCES ca_cards(namespace,id));
CREATE INDEX IF NOT EXISTS ca_unfreeze_card ON ca_unfreeze_requests(namespace,card_id,freeze_revision);
CREATE TABLE IF NOT EXISTS ca_freeze_notes(
 namespace TEXT NOT NULL, operation_id TEXT NOT NULL, customer_reason TEXT NOT NULL, internal_note TEXT,
 PRIMARY KEY(namespace,operation_id), FOREIGN KEY(namespace,operation_id) REFERENCES ca_operations(namespace,id));

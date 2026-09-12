-- Internal Demo card-product catalog, not Slash source fields.
CREATE TABLE IF NOT EXISTS bin_products (
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,
 id TEXT NOT NULL,name TEXT NOT NULL,bin_prefix TEXT NOT NULL,network TEXT NOT NULL,
 currency TEXT NOT NULL,platform TEXT NOT NULL,upstream_product_id TEXT,
 status TEXT NOT NULL,max_cards INTEGER NOT NULL CHECK(max_cards BETWEEN 1 AND 1000),
 description TEXT NOT NULL,internal_note TEXT NOT NULL,revision INTEGER NOT NULL,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(namespace,id)
);
CREATE INDEX IF NOT EXISTS bin_products_status ON bin_products(namespace,status,bin_prefix);
CREATE TABLE IF NOT EXISTS bin_card_links (
 namespace TEXT NOT NULL,card_id TEXT NOT NULL,product_id TEXT NOT NULL,
 product_revision INTEGER NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(namespace,card_id),
 FOREIGN KEY(namespace,product_id) REFERENCES bin_products(namespace,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS bin_card_product ON bin_card_links(namespace,product_id);

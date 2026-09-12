-- Internal channel scope and manually imported catalog, not a live Slash connection.
CREATE TABLE IF NOT EXISTS card_channels (
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,
 id TEXT NOT NULL,name TEXT NOT NULL,provider TEXT NOT NULL,entity_ref TEXT NOT NULL,account_ref TEXT NOT NULL,
 status TEXT NOT NULL,notes TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(namespace,id),UNIQUE(namespace,provider,entity_ref,account_ref)
);
CREATE TABLE IF NOT EXISTS channel_products (
 namespace TEXT NOT NULL,channel_id TEXT NOT NULL,source_id TEXT NOT NULL,prefix TEXT NOT NULL,status TEXT NOT NULL,
 revision INTEGER NOT NULL,collected_at TEXT NOT NULL,
 PRIMARY KEY(namespace,channel_id,source_id),
 FOREIGN KEY(namespace,channel_id) REFERENCES card_channels(namespace,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS bin_channel_links (
 namespace TEXT NOT NULL,product_id TEXT NOT NULL,channel_id TEXT NOT NULL,
 PRIMARY KEY(namespace,product_id),
 FOREIGN KEY(namespace,product_id) REFERENCES bin_products(namespace,id) ON DELETE CASCADE,
 FOREIGN KEY(namespace,channel_id) REFERENCES card_channels(namespace,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS bin_channel_lookup ON bin_channel_links(namespace,channel_id);

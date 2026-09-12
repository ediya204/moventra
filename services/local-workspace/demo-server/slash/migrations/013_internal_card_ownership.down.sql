-- Export internal_card_owners before rollback if any assignments must be retained.
DROP TABLE IF EXISTS internal_card_owners;
DELETE FROM schema_migrations WHERE version=13;

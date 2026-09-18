package database

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Applies only the read model migration, never unrelated funds migrations.
func MigrateCardControls(ctx context.Context, db *pgxpool.Pool) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73019001)`); err != nil {
		return err
	}
	for version, sql := range map[int]string{2: channelProjection, 10: slashWebhook, 11: projectWallet, 17: cardStateSync} {
		var got string
		if err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, version).Scan(&got); err != nil {
			return err
		}
		if got != fmt.Sprintf("%x", sha256.Sum256([]byte(sql))) {
			return fmt.Errorf("migration_%d_conflict", version)
		}
	}
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(cardControls)))
	var got string
	err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=18`).Scan(&got)
	if err == nil {
		if got != hash {
			return fmt.Errorf("migration_18_conflict")
		}
		return tx.Commit(ctx)
	}
	if err != pgx.ErrNoRows {
		return err
	}
	if _, err = tx.Exec(ctx, cardControls); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES(18,$1)`, hash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

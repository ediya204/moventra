package database

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Applies only the read model migration, never unrelated funds migrations.
func MigrateCardMetrics(ctx context.Context, db *pgxpool.Pool) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73019001)`); err != nil {
		return err
	}
	for version, sql := range map[int]string{2: channelProjection, 10: slashWebhook, 11: projectWallet, 17: cardStateSync, 18: cardControls, 19: globalAdmin} {
		var got string
		if err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, version).Scan(&got); err != nil {
			return err
		}
		if got != fmt.Sprintf("%x", sha256.Sum256([]byte(sql))) {
			return fmt.Errorf("migration_%d_conflict", version)
		}
	}
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(cardMetrics)))
	var got string
	err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=20`).Scan(&got)
	if err == nil {
		if got != hash {
			return fmt.Errorf("migration_20_conflict")
		}
		return tx.Commit(ctx)
	}
	if err != pgx.ErrNoRows {
		return err
	}
	if _, err = tx.Exec(ctx, cardMetrics); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES(20,$1)`, hash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func CardMetricsReady(ctx context.Context, db *pgxpool.Pool) error {
	var hash string
	if err := db.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=20`).Scan(&hash); err != nil {
		return err
	}
	if hash != fmt.Sprintf("%x", sha256.Sum256([]byte(cardMetrics))) {
		return fmt.Errorf("migration_20_conflict")
	}
	return nil
}

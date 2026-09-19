package database

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ReadyManualFunds never applies migrations or grants financial permissions.
func ReadyManualFunds(ctx context.Context, db *pgxpool.Pool) error {
	for version, sql := range map[int]string{1: initial, 6: blnkShadow, 16: manualFunds, 19: globalAdmin} {
		var got string
		if err := db.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, version).Scan(&got); err != nil {
			return fmt.Errorf("manual_funds_migration_%d_unavailable", version)
		}
		if got != fmt.Sprintf("%x", sha256.Sum256([]byte(sql))) {
			return fmt.Errorf("manual_funds_migration_%d_conflict", version)
		}
	}
	return nil
}

// Applies only the manual funding schema migration, never unrelated funds migrations.
func MigrateManualFunds(ctx context.Context, db *pgxpool.Pool) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73019001)`); err != nil {
		return err
	}
	for version, sql := range map[int]string{1: initial, 6: blnkShadow} {
		var got string
		if err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, version).Scan(&got); err != nil {
			return err
		}
		if got != fmt.Sprintf("%x", sha256.Sum256([]byte(sql))) {
			return fmt.Errorf("migration_%d_conflict", version)
		}
	}
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(manualFunds)))
	var got string
	err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=16`).Scan(&got)
	if err == nil {
		if got != hash {
			return fmt.Errorf("migration_16_conflict")
		}
		return tx.Commit(ctx)
	}
	if err != pgx.ErrNoRows {
		return err
	}
	if _, err = tx.Exec(ctx, manualFunds); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES(16,$1)`, hash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

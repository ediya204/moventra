package database

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Applies only the customer remark migration, never unrelated funds migrations.
func MigrateCardRemarks(ctx context.Context, db *pgxpool.Pool) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73019001)`); err != nil {
		return err
	}
	for version, sql := range map[int]string{1: initial, 2: channelProjection, 7: customerCardSnapshots, 11: projectWallet} {
		var got string
		if err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, version).Scan(&got); err != nil {
			return err
		}
		if got != fmt.Sprintf("%x", sha256.Sum256([]byte(sql))) {
			return fmt.Errorf("migration_%d_conflict", version)
		}
	}
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(cardRemarks)))
	var got string
	err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=23`).Scan(&got)
	if err == nil {
		if got != hash {
			return fmt.Errorf("migration_23_conflict")
		}
		return tx.Commit(ctx)
	}
	if err != pgx.ErrNoRows {
		return err
	}
	if _, err = tx.Exec(ctx, cardRemarks); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES(23,$1)`, hash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func CardRemarksReady(ctx context.Context, db *pgxpool.Pool) error {
	var hash string
	if err := db.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=23`).Scan(&hash); err != nil {
		return err
	}
	if hash != fmt.Sprintf("%x", sha256.Sum256([]byte(cardRemarks))) {
		return fmt.Errorf("migration_23_conflict")
	}
	return nil
}

package database

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed 001_initial.sql
var initial string

// Migrate is explicit (never called automatically by the API process).
// One transaction and advisory lock make concurrent invocations safe.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73019001)`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	checksum := fmt.Sprintf("%x", sha256.Sum256([]byte(initial)))
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM schema_migrations WHERE version=1`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		var existing string
		if err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=1`).Scan(&existing); err != nil {
			return err
		}
		if existing != checksum {
			return fmt.Errorf("migration 1 checksum mismatch")
		}
	} else {
		if _, err = tx.Exec(ctx, initial); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES(1,$1)`, checksum); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

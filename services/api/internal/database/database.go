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

//go:embed 002_channel_projection.sql
var channelProjection string

//go:embed 003_onboarding.sql
var onboarding string

//go:embed 004_user_roles.sql
var userRoles string

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
	for index, migration := range []string{initial, channelProjection, onboarding, userRoles} {
		version := index + 1
		checksum := fmt.Sprintf("%x", sha256.Sum256([]byte(migration)))
		var count int
		if err = tx.QueryRow(ctx, `SELECT count(*) FROM schema_migrations WHERE version=$1`, version).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			var existing string
			if err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, version).Scan(&existing); err != nil {
				return err
			}
			if existing != checksum {
				return fmt.Errorf("migration checksum mismatch")
			}
		} else {
			if _, err = tx.Exec(ctx, migration); err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)`, version, checksum); err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}

package database

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MigrateSlashWebhook is explicit and additive. Existing history must match the
// release exactly; unlike the general migrator it cannot apply unrelated work.
func MigrateSlashWebhook(ctx context.Context, db *pgxpool.Pool) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73019001)`); err != nil {
		return err
	}
	for i, sql := range []string{initial, channelProjection, onboarding, userRoles, userDirectoryAudit, blnkShadow, customerCardSnapshots, onlineTestWallet, onlineTestFunds} {
		var got string
		if err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, i+1).Scan(&got); err != nil {
			// Shadow ledger is intentionally absent on the online read-only service.
			if i+1 == 6 && errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return fmt.Errorf("existing_migration_missing_%d", i+1)
		}
		if got != fmt.Sprintf("%x", sha256.Sum256([]byte(sql))) {
			return fmt.Errorf("existing_migration_mismatch_%d", i+1)
		}
	}
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(slashWebhook)))
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM schema_migrations WHERE version=10`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		var got string
		if err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=10`).Scan(&got); err != nil {
			return err
		}
		if got != hash {
			return fmt.Errorf("migration_10_conflict")
		}
		return tx.Commit(ctx)
	}
	if _, err = tx.Exec(ctx, slashWebhook); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES(10,$1)`, hash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

package database

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MigrateMessages installs only 021, after verifying every dependency.
func MigrateMessages(ctx context.Context, db *pgxpool.Pool) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SET LOCAL lock_timeout='5s'; SELECT pg_advisory_xact_lock(73019001)`); err != nil {
		return err
	}
	all := []string{initial, channelProjection, onboarding, userRoles, userDirectoryAudit, blnkShadow, customerCardSnapshots, onlineTestWallet, onlineTestFunds, slashWebhook, projectWallet, cardIssuing, cryptoFunds, issuingCheckout, fundsFlows, manualFunds, cardStateSync, cardControls, globalAdmin, cardMetrics}
	for i, sql := range all {
		var got string
		if err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, i+1).Scan(&got); err != nil {
			return fmt.Errorf("missing_dependency_%d", i+1)
		}
		if got != fmt.Sprintf("%x", sha256.Sum256([]byte(sql))) {
			return fmt.Errorf("migration_%d_conflict", i+1)
		}
	}
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(messagesSchema)))
	var got string
	err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=21`).Scan(&got)
	if err == nil {
		if got != hash {
			return errors.New("migration_21_conflict")
		}
		return tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if _, err = tx.Exec(ctx, messagesSchema); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES(21,$1)`, hash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

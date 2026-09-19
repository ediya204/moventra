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

//go:embed 005_user_directory_audit.sql
var userDirectoryAudit string

//go:embed 006_blnk_shadow.sql
var blnkShadow string

//go:embed 007_customer_card_snapshots.sql
var customerCardSnapshots string

//go:embed 010_slash_webhook.sql
var slashWebhook string

//go:embed 011_project_wallet.sql
var projectWallet string

//go:embed 012_card_issuing.sql
var cardIssuing string

//go:embed 013_crypto_funds.sql
var cryptoFunds string

//go:embed 014_issuing_checkout.sql
var issuingCheckout string

//go:embed 015_funds_flows.sql
var fundsFlows string

//go:embed 016_manual_funds.sql
var manualFunds string

//go:embed 017_card_state_sync.sql
var cardStateSync string

//go:embed 018_card_controls.sql
var cardControls string

//go:embed 019_global_admin.sql
var globalAdmin string

//go:embed 021_messages.sql
var messagesSchema string

//go:embed 022_issuing_unified.sql
var issuingUnified string

//go:embed 020_card_metrics.sql
var cardMetrics string

//go:embed 023_card_remarks.sql
var cardRemarks string

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
	for index, migration := range []string{initial, channelProjection, onboarding, userRoles, userDirectoryAudit, blnkShadow, customerCardSnapshots, onlineTestWallet, onlineTestFunds, slashWebhook, projectWallet, cardIssuing, cryptoFunds, issuingCheckout, fundsFlows, manualFunds, cardStateSync, cardControls, globalAdmin, cardMetrics, messagesSchema, issuingUnified, cardRemarks} {
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

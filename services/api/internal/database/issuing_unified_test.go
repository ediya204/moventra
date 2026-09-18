package database

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
	"testing"
)

func TestIssuingUnifiedMigration(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("isolated database required")
	}
	cfg, err := pgxpool.ParseConfig(raw)
	if err != nil || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("refusing non-test database")
	}
	ctx := context.Background()
	base, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	schema := "roles_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = base.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	defer base.Exec(ctx, `DROP SCHEMA `+schema+` CASCADE`)
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	for i, sql := range []string{initial, channelProjection, onboarding, userRoles, userDirectoryAudit, blnkShadow, customerCardSnapshots, onlineTestWallet, onlineTestFunds, slashWebhook, projectWallet, cardIssuing, cryptoFunds, issuingCheckout, fundsFlows, manualFunds, cardStateSync, cardControls, globalAdmin, cardMetrics} {
		if _, err = pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			if _, err = pool.Exec(ctx, `CREATE TABLE schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())`); err != nil {
				t.Fatal(err)
			}
		}
		if _, err = pool.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)`, i+1, fmt.Sprintf("%x", sha256.Sum256([]byte(sql)))); err != nil {
			t.Fatal(err)
		}
	}
	if err = ReadyIssuingUnified(ctx, pool); err == nil {
		t.Fatal("missing migration considered ready")
	}
	for i := 0; i < 2; i++ {
		if err = MigrateIssuingUnified(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
	if err = ReadyIssuingUnified(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM schema_migrations WHERE version=21`).Scan(&n); err != nil || n != 0 {
		t.Fatal("unrelated migration applied", err)
	}
	if _, err = pool.Exec(ctx, `UPDATE schema_migrations SET checksum='invalid' WHERE version=22`); err != nil {
		t.Fatal(err)
	}
	if err = MigrateIssuingUnified(ctx, pool); err == nil {
		t.Fatal("checksum mismatch accepted")
	}
}

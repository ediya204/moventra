package database

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"errors"
	"fmt"
	"moventra.local/api/internal/testfunds"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed 008_online_test_wallet.sql
var onlineTestWallet string

//go:embed 009_online_test_funds.sql
var onlineTestFunds string

// Explicit additive migration; does not activate or apply the shadow ledger.
func MigrateTestWallet(ctx context.Context, db *pgxpool.Pool) error {
	if err := Ready(ctx, db, false); err != nil {
		return err
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73019001)`); err != nil {
		return err
	}
	expected := fmt.Sprintf("%x", sha256.Sum256([]byte(onlineTestWallet)))
	var existing string
	err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=8`).Scan(&existing)
	if err == nil {
		if existing != expected {
			return errors.New("migration_checksum_mismatch")
		}
		return tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if _, err = tx.Exec(ctx, onlineTestWallet); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES(8,$1)`, expected); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type TestWalletGrant struct {
	RequestID string    `json:"requestId"`
	USDMinor  string    `json:"usdMinor"`
	USDTMinor string    `json:"usdtMinor"`
	Reason    string    `json:"reason"`
	CreatedAt time.Time `json:"createdAt"`
}
type TestWalletBalance struct {
	Currency    string `json:"currency"`
	AmountMinor string `json:"amountMinor"`
	Scale       int    `json:"scale"`
}
type TestWalletSnapshot struct {
	CustomerID         string              `json:"customerId"`
	Mode               string              `json:"mode"`
	Enabled            bool                `json:"enabled"`
	ExecutionEligible  bool                `json:"executionEligible"`
	WithdrawalEligible bool                `json:"withdrawalEligible"`
	Balances           []TestWalletBalance `json:"balances"`
	Grants             []TestWalletGrant   `json:"grants"`
	HasMore            bool                `json:"hasMore"`
}

func GrantTestWallet(ctx context.Context, db *pgxpool.Pool, uid string, in TestWalletGrant) (string, bool, error) {
	if _, err := uuid.Parse(in.RequestID); err != nil {
		return "", false, errors.New("invalid_request_id")
	}
	if len(strings.TrimSpace(in.Reason)) == 0 || len(in.Reason) > 500 {
		return "", false, errors.New("invalid_reason")
	}
	for _, s := range []string{in.USDMinor, in.USDTMinor} {
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil || n <= 0 || strconv.FormatInt(n, 10) != s {
			return "", false, errors.New("invalid_positive_minor_amount")
		}
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback(ctx)
	var user, customer string
	err = tx.QueryRow(ctx, `SELECT u.id::text,c.id::text FROM users u JOIN customers c ON c.personal_owner_id=u.id AND c.kind='personal' WHERE u.firebase_uid=$1 AND u.role='customer' AND u.status='active' FOR UPDATE OF u,c`, uid).Scan(&user, &customer)
	if err != nil {
		return "", false, errors.New("active_personal_customer_required")
	}
	result, err := tx.Exec(ctx, `INSERT INTO online_test_wallet_grants(request_id,customer_id,target_user_id,usd_minor,usdt_minor,reason,executed_by) VALUES($1,$2,$3,$4::bigint,$5::bigint,$6,'trusted_cli_user_request') ON CONFLICT(request_id) DO NOTHING`, in.RequestID, customer, user, in.USDMinor, in.USDTMinor, in.Reason)
	if err != nil {
		return "", false, err
	}
	var matches bool
	err = tx.QueryRow(ctx, `SELECT customer_id=$2 AND target_user_id=$3 AND usd_minor=$4::bigint AND usdt_minor=$5::bigint AND reason=$6 FROM online_test_wallet_grants WHERE request_id=$1`, in.RequestID, customer, user, in.USDMinor, in.USDTMinor, in.Reason).Scan(&matches)
	if err != nil {
		return "", false, err
	}
	if !matches {
		return "", false, errors.New("idempotency_conflict")
	}
	if err = tx.Commit(ctx); err != nil {
		return "", false, err
	}
	return customer, result.RowsAffected() == 1, nil
}

// A test wallet is the sum of its immutable synthetic grants, never of source transactions.
func ReadTestWallet(ctx context.Context, tx pgx.Tx, customer string) (TestWalletSnapshot, error) {
	out := TestWalletSnapshot{CustomerID: customer, Mode: "online_test", Balances: []TestWalletBalance{}, Grants: []TestWalletGrant{}}
	var count int
	var usd, usdt string
	err := tx.QueryRow(ctx, `SELECT count(*),COALESCE(sum(usd_minor),0)::text,COALESCE(sum(usdt_minor),0)::text FROM online_test_wallet_grants WHERE customer_id=$1`, customer).Scan(&count, &usd, &usdt)
	if err != nil {
		return out, err
	}
	out.Enabled = count > 0
	out.HasMore = count > 50
	if !out.Enabled {
		return out, nil
	}
	out.Balances = []TestWalletBalance{{"USD", usd, 2}, {"USDT", usdt, 6}}
	var hasFunds bool
	if err = tx.QueryRow(ctx, `SELECT to_regclass('online_test_funds_movements') IS NOT NULL`).Scan(&hasFunds); err != nil {
		return out, err
	}
	if hasFunds {
		bs, e := testfunds.Balances(ctx, tx, customer)
		if e != nil {
			return out, e
		}
		out.Balances = []TestWalletBalance{}
		for _, b := range bs {
			out.Balances = append(out.Balances, TestWalletBalance{b.Currency, b.Available, b.Scale})
		}
	}
	rows, err := tx.Query(ctx, `SELECT request_id::text,usd_minor::text,usdt_minor::text,reason,created_at FROM online_test_wallet_grants WHERE customer_id=$1 ORDER BY created_at DESC,request_id LIMIT 50`, customer)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var g TestWalletGrant
		if err = rows.Scan(&g.RequestID, &g.USDMinor, &g.USDTMinor, &g.Reason, &g.CreatedAt); err != nil {
			return out, err
		}
		out.Grants = append(out.Grants, g)
	}
	return out, rows.Err()
}

// MigrateTestFunds applies only 009 after validating the existing test-credit schema.
func MigrateTestFunds(ctx context.Context, db *pgxpool.Pool) error {
	if err := MigrateTestWallet(ctx, db); err != nil {
		return err
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73019001)`); err != nil {
		return err
	}
	checksum := fmt.Sprintf("%x", sha256.Sum256([]byte(onlineTestFunds)))
	var prior string
	err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=9`).Scan(&prior)
	if err == nil {
		if prior != checksum {
			return errors.New("migration_checksum_mismatch")
		}
		return tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if _, err = tx.Exec(ctx, onlineTestFunds); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES(9,$1)`, checksum); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

package main

import (
	"context"
	"encoding/json"
	"errors"
	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"os"
	"strings"
)

func testWalletCommand(ctx context.Context, db *pgxpool.Pool, auth *firebaseauth.Client, apply bool) error {
	email := strings.TrimSpace(os.Getenv("TEST_WALLET_EMAIL"))
	if email == "" {
		return errors.New("TEST_WALLET_EMAIL required")
	}
	identity, err := auth.GetUserByEmail(ctx, email)
	if err != nil || identity.Disabled || !identity.EmailVerified || !strings.EqualFold(identity.Email, email) {
		return errors.New("verified_enabled_email_required")
	}
	var customer string
	err = db.QueryRow(ctx, `SELECT c.id::text FROM users u JOIN customers c ON c.personal_owner_id=u.id AND c.kind='personal' WHERE u.firebase_uid=$1 AND u.role='customer' AND u.status='active'`, identity.UID).Scan(&customer)
	if err != nil {
		return errors.New("active_personal_customer_required")
	}
	added := false
	if apply {
		if os.Getenv("CONFIRM_ONLINE_TEST_ONLY") != "yes" {
			return errors.New("CONFIRM_ONLINE_TEST_ONLY=yes required")
		}
		customer, added, err = database.GrantTestWallet(ctx, db, identity.UID, database.TestWalletGrant{RequestID: os.Getenv("TEST_WALLET_REQUEST_ID"), USDMinor: os.Getenv("TEST_WALLET_USD_MINOR"), USDTMinor: os.Getenv("TEST_WALLET_USDT_MINOR"), Reason: os.Getenv("TEST_WALLET_REASON")})
		if err != nil {
			return err
		}
	}
	tx, err := db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	snapshot, err := database.ReadTestWallet(ctx, tx, customer)
	if err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"newGrant": added, "snapshot": snapshot})
}

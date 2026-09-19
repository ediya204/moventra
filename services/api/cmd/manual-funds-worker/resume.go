package main

import (
	"context"
	"encoding/json"
	"errors"
	firebase "firebase.google.com/go/v4"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"moventra.local/api/internal/cryptofunds"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/manualfunds"
	"os"
)

// Trusted operator CLI: one explicitly authorized existing USD credit only.
// It never creates a funding order or drains unrelated work.
func resume(ctx context.Context, db *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(ctx, 60*1e9)
	defer cancel()
	var in struct {
		CustomerID  string `json:"customerId"`
		OrderID     string `json:"orderId"`
		Amount      string `json:"amountMinor"`
		OperatorUID string `json:"operatorUid"`
		RequestID   string `json:"requestId"`
		Evidence    string `json:"evidence"`
	}
	d := json.NewDecoder(io.LimitReader(os.Stdin, 4096))
	d.DisallowUnknownFields()
	if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF || len(in.Evidence) < 10 {
		return errors.New("explicit_order_authorization_required")
	}
	for _, id := range []string{in.CustomerID, in.OrderID, in.RequestID} {
		if _, e := uuid.Parse(id); e != nil {
			return errors.New("invalid_id")
		}
	}
	if os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != "" || os.Getenv("FUNDS_PRODUCTION_MODE") != "enabled" || os.Getenv("MANUAL_FUNDS_REQUIRE_REVIEW") != "false" {
		return errors.New("production_no_review_required")
	}
	app, e := firebase.NewApp(ctx, &firebase.Config{ProjectID: os.Getenv("FIREBASE_PROJECT_ID")})
	if e != nil {
		return e
	}
	auth, e := app.Auth(ctx)
	if e != nil {
		return e
	}
	u, e := auth.GetUser(ctx, in.OperatorUID)
	if e != nil || u.Disabled || !u.EmailVerified || u.MultiFactor == nil || len(u.MultiFactor.EnrolledFactors) == 0 {
		return errors.New("verified_operator_mfa_enrollment_required")
	}
	var actor string
	if e = db.QueryRow(ctx, `SELECT id::text FROM users WHERE firebase_uid=$1 AND role='admin' AND status='active' AND is_global_admin(id)`, u.UID).Scan(&actor); e != nil {
		return errors.New("active_global_operator_required")
	}
	funding, e := cryptofunds.ProductionFromEnv(db)
	if e != nil {
		return e
	}
	if funding == nil {
		return errors.New("production_required")
	}
	if e = funding.CheckProduction(ctx); e != nil {
		return e
	}
	if e = database.ReadyManualFunds(ctx, db); e != nil {
		return e
	}
	svc := &manualfunds.Service{DB: db, Ledger: funding.Ledger}
	if !svc.Enabled() {
		return errors.New("manual_disabled")
	}
	tx, e := db.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if e = svc.Authorize(ctx, tx, actor, in.CustomerID, "read", true); e != nil {
		return e
	}
	if e = svc.Authorize(ctx, tx, actor, in.CustomerID, "execute", true); e != nil {
		return e
	}
	if e = svc.Lock(ctx, tx, in.CustomerID); e != nil {
		return e
	}
	o, e := svc.Get(ctx, tx, in.CustomerID, in.OrderID)
	if e != nil {
		return e
	}
	if o.Source != "platform_advance" || o.Direction != "credit" || o.Currency != "USD" || o.Amount != in.Amount {
		return errors.New("order_does_not_match_authorization")
	}
	switch o.State {
	case "pending_review":
		_, e = svc.Execute(ctx, tx, actor, in.CustomerID, o.ID, in.RequestID, manualfunds.Input{Action: "reconcile", Revision: o.Revision, Note: in.Evidence})
		if e != nil {
			return e
		}
	case "processing", "completed":
		var authorized bool
		if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM manual_funds_commands WHERE namespace=$1 AND actor_id=$2 AND request_id=$3 AND order_id=$4)`, svc.NS(), actor, in.RequestID, o.ID).Scan(&authorized); e != nil || !authorized {
			return errors.New("original_authorized_command_required")
		}
	default:
		return errors.New("order_state_changed")
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	if e = svc.Process(ctx, in.CustomerID, o.ID); e != nil {
		return e
	}
	tx, e = db.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	o, e = svc.Get(ctx, tx, in.CustomerID, o.ID)
	if e != nil {
		return e
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"orderId": o.ID, "state": o.State, "amountMinor": o.Amount, "currency": o.Currency, "walletBeforeMinor": o.Before, "walletAfterMinor": o.After})
}

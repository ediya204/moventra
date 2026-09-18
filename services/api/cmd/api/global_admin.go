package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"

	firebase "firebase.google.com/go/v4"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
)

func globalAdminCommand(ctx context.Context, db *pgxpool.Pool) error {
	mode := os.Args[1]
	if len(os.Args) < 3 || len(os.Args) > 4 {
		return errors.New("usage: api global-admin-plan|global-admin-grant|global-admin-revoke email [evidence]")
	}
	if os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != "" {
		return errors.New("emulator_not_allowed")
	}
	app, e := firebase.NewApp(ctx, &firebase.Config{ProjectID: os.Getenv("FIREBASE_PROJECT_ID")})
	if e != nil {
		return errors.New("firebase_unavailable")
	}
	auth, e := app.Auth(ctx)
	if e != nil {
		return errors.New("firebase_unavailable")
	}
	user, e := auth.GetUserByEmail(ctx, os.Args[2])
	if e != nil || !strings.EqualFold(user.Email, os.Args[2]) {
		return errors.New("firebase_identity_not_found")
	}
	factors := 0
	if user.MultiFactor != nil {
		factors = len(user.MultiFactor.EnrolledFactors)
	}
	if mode == "global-admin-grant" {
		if user.Disabled || !user.EmailVerified || factors == 0 {
			return errors.New("verified_enabled_mfa_identity_required")
		}
	}
	if mode != "global-admin-plan" {
		if len(os.Args) != 4 {
			return errors.New("evidence_required")
		}
		if e = database.SetGlobalAdmin(ctx, db, user.UID, os.Args[3], mode == "global-admin-grant"); e != nil {
			return e
		}
	}
	var role, state string
	var global bool
	if e = db.QueryRow(ctx, `SELECT role,status,is_global_admin(id) FROM users WHERE firebase_uid=$1`, user.UID).Scan(&role, &state, &global); e != nil {
		return errors.New("application_identity_unavailable")
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"email": user.Email, "role": role, "status": state, "globalAdmin": global, "emailVerified": user.EmailVerified, "firebaseDisabled": user.Disabled, "mfaFactors": factors})
}

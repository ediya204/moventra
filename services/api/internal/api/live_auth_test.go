package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	firebase "firebase.google.com/go/v4"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
)

// Opt-in only: real Firebase identities, but a fresh local test database.
// Tokens stay in a mode-0600 file outside the checkout, never in test output.
func TestLiveFirebaseAuthorization(t *testing.T) {
	path := os.Getenv("LIVE_AUTH_FIXTURES")
	if path == "" {
		t.Skip("opt-in real Firebase test")
	}
	cfg, err := pgxpool.ParseConfig(os.Getenv("TEST_DATABASE_URL"))
	if err != nil || cfg.ConnConfig.Host != "/tmp" || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("requires isolated local test database")
	}
	ctx := context.Background()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal("local database unavailable")
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, seed); err != nil {
		t.Fatal(err)
	}
	var fixtures map[string]struct {
		UID   string `json:"uid"`
		Token string `json:"token"`
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("fixture file unavailable")
	}
	if json.Unmarshal(raw, &fixtures) != nil {
		t.Fatal("invalid fixtures")
	}
	for _, name := range []string{"alice", "bob", "staff", "disabled"} {
		if fixtures[name].UID == "" {
			t.Fatal("missing fixture", name)
		}
		if _, err = pool.Exec(ctx, `UPDATE users SET firebase_uid=$1 WHERE firebase_uid=$2`, fixtures[name].UID, name); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,firebase_uid,display_name,role) VALUES('00000000-0000-0000-0000-000000000005',$1,'Single factor operator','admin')`, fixtures["staffNoMfa"].UID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO staff_grants(user_id,customer_id,permission) VALUES('00000000-0000-0000-0000-000000000005',$1,'accounts:read')`, business); err != nil {
		t.Fatal(err)
	}
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: os.Getenv("FIREBASE_PROJECT_ID")})
	if err != nil {
		t.Fatal("Firebase initialization failed")
	}
	client, err := app.Auth(ctx)
	if err != nil {
		t.Fatal("Firebase Auth initialization failed")
	}
	handler := (&Server{DB: pool, Verifier: FirebaseVerifier{Client: client}}).Handler()
	for _, tc := range []struct {
		name, key, path string
		status          int
	}{
		{"verified personal owner", "alice", "/client-api/v1/customers/" + personal + "/accounts", 200},
		{"verified business member", "alice", "/client-api/v1/customers/" + business + "/accounts", 200},
		{"cross customer denied", "alice", "/client-api/v1/customers/" + other + "/accounts", 404},
		{"operator without MFA denied", "staffNoMfa", "/admin-api/v1/customers/" + business + "/accounts", 403},
		{"real TOTP operator granted", "staff", "/admin-api/v1/customers/" + business + "/accounts", 200},
		{"operator wrong resource denied", "staff", "/admin-api/v1/customers/" + business + "/transactions", 404},
		{"operator wrong customer denied", "staff", "/admin-api/v1/customers/" + other + "/accounts", 404},
		{"operator has no implicit membership", "staff", "/client-api/v1/customers/" + business + "/accounts", 403},
		{"unverified email denied", "unverified", "/api/v1/me", 401},
		{"unprovisioned identity denied", "unprovisioned", "/api/v1/me", 403},
		{"disabled local user denied", "disabled", "/api/v1/me", 403},
		{"Firebase disabled identity denied", "cloudDisabled", "/api/v1/me", 401},
		{"revoked token denied", "revoked", "/api/v1/me", 401},
		{"tampered MFA claim denied", "tampered", "/admin-api/v1/customers/" + business + "/accounts", 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if fixtures[tc.key].Token == "" {
				t.Fatal("missing fixture")
			}
			r := httptest.NewRequest("GET", tc.path, nil)
			r.Header.Set("Authorization", "Bearer "+fixtures[tc.key].Token)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("expected %d, got %d (%s)", tc.status, w.Code, w.Body.String())
			}
		})
	}
	for _, key := range []string{"staffNoMfa", "staff"} {
		t.Run("scope discovery "+key, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/api/v1/me", nil)
			r.Header.Set("Authorization", "Bearer "+fixtures[key].Token)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			var payload struct {
				Data struct {
					RequiresMFA bool  `json:"requiresMfa"`
					MFAVerified bool  `json:"mfaVerified"`
					StaffScopes []any `json:"staffScopes"`
				}
			}
			if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &payload) != nil {
				t.Fatal("session failed")
			}
			if key == "staffNoMfa" && (!payload.Data.RequiresMFA || len(payload.Data.StaffScopes) != 0) {
				t.Fatal("MFA scope disclosure")
			}
			if key == "staff" && (!payload.Data.MFAVerified || len(payload.Data.StaffScopes) != 1) {
				t.Fatal("verified scope missing")
			}
		})
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action='accounts:read'`).Scan(&count); err != nil || count != 1 {
		t.Fatal("operator read audit missing")
	}
}

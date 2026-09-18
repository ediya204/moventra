package api

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/projection"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestCardSecretProviderScopeAndFailure(t *testing.T) {
	secret := strings.Repeat("7", 3)
	body := map[string]any{"id": "card", "accountId": "account", "virtualAccountId": "wallet", "cvv": secret, "pan": "must-never-return"}
	status := 200
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/card/card" || r.URL.Query().Get("include_cvv") != "true" || r.URL.Query().Get("include_pan") != "false" || r.Header.Get("X-API-Key") != "fixture" {
			t.Error("incorrect request")
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	}))
	defer server.Close()
	provider := slashCardSecrets{key: "fixture", base: server.URL, client: server.Client()}
	got, e := provider.Reveal(context.Background(), "card", "account", "wallet")
	if e != nil || got != secret {
		t.Fatal("valid synthetic reveal failed")
	}
	for _, field := range []string{"id", "accountId", "virtualAccountId", "cvv"} {
		saved := body[field]
		body[field] = "mismatch"
		got, e = provider.Reveal(context.Background(), "card", "account", "wallet")
		if e == nil || got != "" {
			t.Fatal("mismatch disclosed a value")
		}
		body[field] = saved
	}
	status = 403
	got, e = provider.Reveal(context.Background(), "card", "account", "wallet")
	if got != "" || e == nil || strings.Contains(e.Error(), secret) {
		t.Fatal("unsafe upstream failure")
	}
}

type secretFixture struct {
	calls int
	after func()
}

func (f *secretFixture) Reveal(context.Context, string, string, string) (string, error) {
	f.calls++
	if f.after != nil {
		f.after()
	}
	return strings.Repeat("8", 3), nil
}

type secretLogin struct{}

func (secretLogin) Verify(ctx context.Context, token string) (Identity, error) {
	v, e := (fakeVerifier{}).Verify(ctx, token)
	v.MFA = false
	return v, e
}
func TestCardSecretAuthorizationRateAndRevocation(t *testing.T) {
	for _, kind := range []string{"cvv", "details"} {
		t.Run(kind, func(t *testing.T) { testCardSecretAuthorization(t, kind) })
	}
}
func (f *secretFixture) RevealDetails(ctx context.Context, card, account, wallet string) (CardSecretDetails, error) {
	cvv, err := f.Reveal(ctx, card, account, wallet)
	return CardSecretDetails{PAN: strings.Repeat("4", 16), CVV: cvv, Name: "Synthetic card", ExpiryMonth: "09", ExpiryYear: "2030"}, err
}
func testCardSecretAuthorization(t *testing.T, kind string) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("isolated database required")
	}
	cfg, e := pgxpool.ParseConfig(raw)
	if e != nil || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("isolated database required")
	}
	ctx := context.Background()
	db, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = database.Migrate(ctx, db); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, seed); e != nil {
		t.Fatal(e)
	}
	defer db.Exec(ctx, `TRUNCATE channel_connections,users,slash_hook_connections CASCADE`)
	bundle := projection.Bundle{ConnectionID: "secret-source", AccountID: "account", Label: "Fixture", SourceAt: "2026-09-18T00:00:00Z", Records: []projection.Record{{Kind: "card", Data: map[string]any{"id": "card", "accountId": "account", "virtualAccountId": "wallet", "last4": "1234"}}}}
	rev, e := projection.Import(ctx, db, bundle, "staff")
	if e != nil {
		t.Fatal(e)
	}
	input := database.WalletAssignment{ConnectionID: bundle.ConnectionID, AccountID: "account", VirtualAccountID: "wallet", Label: "Fixture", Revision: rev, CardIDs: []string{"card"}, Reason: "fixture only", EvidenceRef: "synthetic"}
	plan, e := database.AssignProjectWalletCards(ctx, db, "staff", "alice", input, "", false)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = database.AssignProjectWalletCards(ctx, db, "staff", "alice", input, plan.SHA256, true); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, `INSERT INTO slash_hook_connections(id,account_ref,endpoint) VALUES('secret-hook','account','secret-endpoint');INSERT INTO card_sync_links(connection_id,hook_connection_id) VALUES('secret-source','secret-hook')`); e != nil {
		t.Fatal(e)
	}
	fixture := &secretFixture{}
	h := (&Server{DB: db, Verifier: secretLogin{}, CardSecrets: fixture}).Handler()
	path := "/client-api/v1/customers/" + personal + "/card-projections/secret-source/cards/card/" + kind + "/reveal"
	request := func(token, path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", path, strings.NewReader(`{"purpose":"cardholder-view"}`))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	for _, v := range []struct{ token, path string }{{"bob", path}, {"alice", strings.Replace(path, "secret-source", "unknown", 1)}, {"staff", path}, {"bad", path}} {
		w := request(v.token, v.path)
		if w.Code == 200 || fixture.calls != 0 {
			t.Fatal("unauthorized reveal")
		}
	}
	for i := 0; i < 3; i++ {
		requestPath := path
		if kind == "details" && i == 0 {
			requestPath = strings.Replace(path, "/details/", "/cvv/", 1)
		}
		w := request("alice", requestPath)
		if w.Code != 200 || w.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("reveal status %d", w.Code)
		}
		var data map[string]any
		if json.Unmarshal(w.Body.Bytes(), &data) != nil {
			t.Fatal("invalid reveal JSON")
		}
		if strings.Contains(requestPath, "/details/") {
			if data["pan"] != strings.Repeat("4", 16) || data["name"] != "Synthetic card" || data["expiryMonth"] != "09" {
				t.Fatal("missing ephemeral fields")
			}
		} else if _, exists := data["pan"]; exists {
			t.Fatal("legacy CVV endpoint exposed PAN")
		}
	}
	if w := request("alice", path); w.Code != 429 || fixture.calls != 3 {
		t.Fatalf("rate status %d", w.Code)
	}
	if _, e = db.Exec(ctx, `DELETE FROM channel_read_audit WHERE action LIKE 'card:cvv:request:%'`); e != nil {
		t.Fatal(e)
	}
	fixture.after = func() {
		_, e = db.Exec(ctx, `DELETE FROM project_wallet_cards WHERE connection_id='secret-source' AND external_card_id='card'`)
		if e != nil {
			t.Error(e)
		}
	}
	w := request("alice", path)
	if w.Code == 200 || strings.Contains(w.Body.String(), strings.Repeat("8", 3)) {
		t.Fatal("revoked ownership disclosed value")
	}
	var count int
	if e = db.QueryRow(ctx, `SELECT count(*) FROM channel_read_audit WHERE action LIKE 'card:cvv:success:%'`).Scan(&count); e != nil || count != 3 {
		t.Fatal("missing safe audit")
	}
}

func TestCardDetailsProvider(t *testing.T) {
	body := map[string]any{"id": "card", "accountId": "account", "virtualAccountId": "wallet", "pan": strings.Repeat("4", 16), "cvv": "789", "name": "Synthetic card", "expiryMonth": "09", "expiryYear": "2030"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("include_pan") != "true" || r.URL.Query().Get("include_cvv") != "true" {
			t.Error("explicit secret flags required")
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	defer server.Close()
	provider := slashCardSecrets{key: "fixture", base: server.URL, client: server.Client()}
	value, err := provider.RevealDetails(context.Background(), "card", "account", "wallet")
	if err != nil || value.PAN != body["pan"] || value.Name != body["name"] {
		t.Fatal("synthetic full details failed")
	}
	for _, field := range []string{"id", "accountId", "virtualAccountId", "pan", "cvv", "name", "expiryMonth", "expiryYear"} {
		saved := body[field]
		body[field] = ""
		value, err = provider.RevealDetails(context.Background(), "card", "account", "wallet")
		if err == nil || value.PAN != "" || value.CVV != "" {
			t.Fatal("invalid details disclosed a value")
		}
		body[field] = saved
	}
}

package api

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/blnk"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/ledger"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
)

func TestLedgerAuthorizationAuditAndUnavailable(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("requires isolated TEST_DATABASE_URL")
	}
	cfg, e := pgxpool.ParseConfig(raw)
	if e != nil || ledger.CheckLocalDatabase(cfg) != nil {
		t.Fatal("unsafe database")
	}
	ctx := context.Background()
	base, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer base.Close()
	schema := "ledger_api_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = base.Exec(ctx, `CREATE SCHEMA `+schema); e != nil {
		t.Fatal(e)
	}
	defer base.Exec(ctx, `DROP SCHEMA `+schema+` CASCADE`)
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	cfg.MaxConns = 1
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
	var unavailable atomic.Bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if unavailable.Load() {
			w.WriteHeader(500)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"balance_id": "bln_test", "ledger_id": "general_ledger_id", "currency": "USD", "balance": 12345, "inflight_debit_balance": 0})
	}))
	defer upstream.Close()
	c, _ := blnk.New(upstream.URL, "synthetic-key")
	s, _ := ledger.New(db, c, "shadow_api_test", "general_ledger_id")
	_, e = db.Exec(ctx, `INSERT INTO ledger_accounts(id,namespace,customer_id,account_key,kind,currency,scale,blnk_balance_id) VALUES($1,'shadow_api_test',$2,'wallet','wallet','USD',2,'bln_test')`, uuid.NewString(), personal)
	if e != nil {
		t.Fatal(e)
	}
	srv := &Server{DB: db, Verifier: fakeVerifier{}, Ledger: s}
	handler := srv.Handler()
	request := func(surface, customer, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/"+surface+"-api/v1/customers/"+customer+"/ledger", nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, tc := range []struct {
		surface, customer, token string
		code                     int
	}{{"client", personal, "", 401}, {"client", personal, "alice", 200}, {"client", personal, "bob", 404}, {"client", business, "alice", 404}, {"client", personal, "disabled", 403}, {"admin", personal, "alice", 403}, {"admin", personal, "staff-no-mfa", 403}, {"admin", business, "staff", 404}} {
		w := request(tc.surface, tc.customer, tc.token)
		if w.Code != tc.code {
			t.Fatal(tc, w.Code, w.Body)
		}
	}
	if _, e = db.Exec(ctx, `INSERT INTO ledger_read_grants(user_id,customer_id) SELECT id,$1 FROM users WHERE firebase_uid='staff'`, personal); e != nil {
		t.Fatal(e)
	}
	w := request("admin", personal, "staff")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"mode":"shadow"`) || !strings.Contains(w.Body.String(), `"postedMinor":"12345"`) || strings.Contains(w.Body.String(), "bln_test") {
		t.Fatal(w.Code, w.Body)
	}
	unavailable.Store(true)
	w = request("client", personal, "alice")
	if w.Code != 503 || strings.Contains(w.Body.String(), "totalsMinor") {
		t.Fatal("failure returned zero funds", w.Code, w.Body)
	}
	unavailable.Store(false)
	if _, e = db.Exec(ctx, `CREATE FUNCTION reject_ledger_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_ledger_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_ledger_audit()`); e != nil {
		t.Fatal(e)
	}
	w = request("client", personal, "alice")
	if w.Code != 503 || strings.Contains(w.Body.String(), "postedMinor") {
		t.Fatal("returned data without audit", w.Code, w.Body)
	}
	srv.Ledger = nil
	handler = srv.Handler()
	if w = request("client", personal, "alice"); w.Code != 503 || !strings.Contains(w.Body.String(), "ledger_disabled") {
		t.Fatal(w.Code, w.Body)
	}
}

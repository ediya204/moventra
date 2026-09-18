package slashhook

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
)

func sign(t *testing.T, k *rsa.PrivateKey, b string) string {
	t.Helper()
	h := sha256.Sum256([]byte(b))
	v, e := rsa.SignPKCS1v15(rand.Reader, k, crypto.SHA256, h[:])
	if e != nil {
		t.Fatal(e)
	}
	return base64.StdEncoding.EncodeToString(v)
}
func TestVerifyAndRedaction(t *testing.T) {
	k, _ := rsa.GenerateKey(rand.Reader, 2048)
	b := `{"event":"card.update","eventId":"evt1","entityId":"card1","eventTimestamp":"2026-09-18T12:00:00Z","pan":"DO_NOT_KEEP"}`
	sig := sign(t, k, b)
	if _, e := verify(&k.PublicKey, sig, []byte(b)); e != nil {
		t.Fatal(e)
	}
	for _, body := range []string{b + " ", strings.Repeat("x", 65537)} {
		if _, e := verify(&k.PublicKey, sig, []byte(body)); e == nil {
			t.Fatal("tamper accepted")
		}
	}
	var m map[string]json.RawMessage
	json.Unmarshal([]byte(`{"id":"tx1","amountCents":9007199254740993123,"pan":"secret","merchantData":{"cvv":"secret"},"status":"posted"}`), &m)
	safe, e := safePayload(m, "tx1")
	if e != nil || strings.Contains(string(safe), "secret") || !strings.Contains(string(safe), "9007199254740993123") {
		t.Fatalf("redaction/precision failure %v", e)
	}
	s := New(nil, "")
	s.Key = &k.PublicKey
	h := s.Handler(http.NotFoundHandler())
	r := httptest.NewRequest("POST", "/webhooks/slash", strings.NewReader(b))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
	r = httptest.NewRequest("GET", "/webhooks/slash", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 405 {
		t.Fatal(w.Code)
	}
}
func TestInboxIntegration(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("local TEST_DATABASE_URL required")
	}
	cfg, e := pgxpool.ParseConfig(raw)
	if e != nil {
		t.Fatal(e)
	}
	if cfg.ConnConfig.Host != "/tmp" && cfg.ConnConfig.Host != "localhost" && cfg.ConnConfig.Host != "127.0.0.1" {
		t.Fatal("local tests only")
	}
	ctx := context.Background()
	admin, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Close()
	schema := "hook_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = admin.Exec(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = database.Migrate(ctx, db); e != nil {
		t.Fatal(e)
	}
	// Match production: optional shadow ledger migration is not activated.
	if _, e = db.Exec(ctx, `DELETE FROM schema_migrations WHERE version=6`); e != nil {
		t.Fatal(e)
	}
	if e = database.MigrateSlashWebhook(ctx, db); e != nil {
		t.Fatal(e)
	}
	// Targeted migrator must preserve prior checksums and reject drift.
	var checksum string
	if e = db.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=9`).Scan(&checksum); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, `UPDATE schema_migrations SET checksum='drift' WHERE version=9`); e != nil {
		t.Fatal(e)
	}
	if e = database.MigrateSlashWebhook(ctx, db); e == nil {
		t.Fatal("migration drift accepted")
	}
	if _, e = db.Exec(ctx, `UPDATE schema_migrations SET checksum=$1 WHERE version=9`, checksum); e != nil {
		t.Fatal(e)
	}
	if e = database.MigrateSlashWebhook(ctx, db); e != nil {
		t.Fatal(e)
	}
	_, e = db.Exec(ctx, `INSERT INTO slash_hook_connections(id,account_ref,endpoint) VALUES('trial','acct1','/webhooks/slash')`)
	if e != nil {
		t.Fatal(e)
	}
	k, _ := rsa.GenerateKey(rand.Reader, 2048)
	s := New(db, "testkey")
	s.Key = &k.PublicKey
	h := s.Handler(http.NotFoundHandler())
	b := `{"event":"aggregated_transaction.update","eventId":"evt1","entityId":"tx1","eventTimestamp":"2026-09-18T12:00:00Z","pan":"SECRET"}`
	post := func(body string) int {
		r := httptest.NewRequest("POST", "/webhooks/slash", strings.NewReader(body))
		r.Header.Set("slash-webhook-signature", sign(t, k, body))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if got := post(b); got != 204 {
				t.Errorf("status %d", got)
			}
		}()
	}
	wg.Wait()
	count := func(table string) int {
		var n int
		if e := db.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	if count("slash_hook_events") != 1 || count("slash_hook_deliveries") != 10 {
		t.Fatal("duplicate events")
	}
	failing := true
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.Header.Get("X-API-Key") != "testkey" {
			t.Error("unexpected request")
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/account" {
			fmt.Fprint(w, `{"items":[{"id":"acct1"}]}`)
			return
		}
		if failing {
			w.WriteHeader(429)
			return
		}
		fmt.Fprint(w, `{"id":"tx1","accountId":"acct1","amountCents":-123,"status":"posted","pan":"SECRET"}`)
	}))
	defer ts.Close()
	s.base = ts.URL
	if e = s.Step(ctx); e != nil {
		t.Fatal(e)
	}
	var state string
	db.QueryRow(ctx, `SELECT state FROM slash_hook_events WHERE event_id='evt1'`).Scan(&state)
	if state != "queued" {
		t.Fatal(state)
	}
	if count("slash_hook_observations") != 0 {
		t.Fatal("failed fetch persisted")
	}
	failing = false
	db.Exec(ctx, `UPDATE slash_hook_events SET next_attempt=now()`)
	// Recreate service simulates process restart; persisted queued task resumes.
	s2 := New(db, "testkey")
	s2.base = ts.URL
	if e = s2.Step(ctx); e != nil {
		t.Fatal(e)
	}
	if e = s2.Step(ctx); e != nil {
		t.Fatal(e)
	}
	if count("slash_hook_observations") != 1 {
		t.Fatal("recovery failed")
	}
	var payload string
	db.QueryRow(ctx, `SELECT payload::text FROM slash_hook_observations`).Scan(&payload)
	if strings.Contains(payload, "SECRET") {
		t.Fatal("leak")
	}
	// Unsupported legitimate notifications are recorded without poison retries.
	if post(strings.ReplaceAll(strings.ReplaceAll(b, "evt1", "evt2"), "aggregated_transaction.update", "expense_report.update")) != 204 {
		t.Fatal("unknown event")
	}
	db.QueryRow(ctx, `SELECT state FROM slash_hook_events WHERE event_id='evt2'`).Scan(&state)
	if state != "ignored" {
		t.Fatal(state)
	}
	// Same event identity with different content is audited, never reprocessed.
	if post(strings.ReplaceAll(b, "tx1", "tx2")) != 204 {
		t.Fatal("conflict ack")
	}
	db.QueryRow(ctx, `SELECT state FROM slash_hook_events WHERE event_id='evt1'`).Scan(&state)
	if state != "review" {
		t.Fatal(state)
	}
	// Retired connection cannot accept queued redelivery as a new connection.
	db.Exec(ctx, `UPDATE slash_hook_connections SET enabled=false`)
	if post(b) != 503 {
		t.Fatal("retired connection accepted")
	}
	db.Exec(ctx, `UPDATE slash_hook_connections SET enabled=true`)
	testCardSync(t, ctx, db, s2)
	// A database failure never acknowledges a signed event.
	closed, _ := pgxpool.NewWithConfig(ctx, cfg)
	closed.Close()
	s.DB = closed
	if post(b) != 503 {
		t.Fatal("db failure acknowledged")
	}
}

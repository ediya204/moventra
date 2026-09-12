package api

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/projection"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestChannelBoundary(t *testing.T) {
	u := os.Getenv("TEST_DATABASE_URL")
	if u == "" {
		t.Skip("isolated database required")
	}
	cfg, e := pgxpool.ParseConfig(u)
	if e != nil || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("test database required")
	}
	db, e := pgxpool.NewWithConfig(context.Background(), cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	ctx := context.Background()
	if e = database.Migrate(ctx, db); e != nil {
		t.Fatal(e)
	}
	// Test package already uses unique fixtures per test via cleanup.
	if _, e = db.Exec(ctx, seed); e != nil {
		t.Fatal(e)
	}
	defer db.Exec(ctx, `TRUNCATE channel_read_audit,channel_records,channel_read_grants,channel_imports,channel_connections,users CASCADE`)
	b := projection.Bundle{ConnectionID: "synthetic", AccountID: "synthetic-account", Label: "Synthetic", SourceAt: "2026-09-07T00:00:00Z", Records: []projection.Record{{Kind: "transaction", Data: map[string]any{"id": "test-tx", "accountId": "synthetic-account", "cardId": "test-card", "amountCents": "-9007199254740993", "status": "posted", "detailedStatus": "settled", "date": "2026-09-07T00:00:00Z"}}}}
	rev, e := projection.Import(ctx, db, b, "staff")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = projection.Import(ctx, db, b, "staff"); e != nil {
		t.Fatal(e)
	}
	var count int
	db.QueryRow(ctx, `SELECT count(*) FROM channel_records`).Scan(&count)
	if count != 1 {
		t.Fatal("duplicate import")
	}
	h := (&Server{DB: db, Verifier: fakeVerifier{}}).Handler()
	request := func(path, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	for _, tc := range []struct {
		token string
		code  int
	}{{"", 401}, {"alice", 403}, {"staff-no-mfa", 403}, {"disabled", 403}, {"staff", 200}} {
		w := request("/admin-api/v1/channel-projections", tc.token)
		if w.Code != tc.code {
			t.Fatal(tc, w.Code, w.Body.String())
		}
	}
	path := "/admin-api/v1/channel-projections/synthetic/transactions"
	for suffix, code := range map[string]int{"": 200, "?page=1": 200, "?page=-1": 400, "?page=0&page=1": 400, "?customerId=x": 400, "?revision=old": 409, "?from=bad": 400, "?from=2026-09-07T00:00:00Z&to=2026-09-08T00:00:00Z": 200} {
		w := request(path+suffix, "staff")
		if w.Code != code {
			t.Fatal(suffix, w.Code, w.Body.String())
		}
	}
	if w := request(path, "alice"); w.Code != 403 {
		t.Fatal("cross scope", w.Code)
	}
	var out struct {
		Data struct {
			Rows     []map[string]any
			Revision string
			Complete bool
		}
	}
	w := request(path, "staff")
	json.Unmarshal(w.Body.Bytes(), &out)
	if out.Data.Revision != rev || out.Data.Complete || out.Data.Rows[0]["amountCents"] != "-9007199254740993" {
		t.Fatal("precision or coverage")
	}
	if w = request(path+"/missing", "staff"); w.Code != 404 {
		t.Fatal("missing")
	}
	b.SourceAt = "2026-09-06T00:00:00Z"
	if _, e = projection.Import(ctx, db, b, "staff"); e == nil {
		t.Fatal("stale import")
	}
	if _, e = db.Exec(ctx, `ALTER TABLE channel_read_audit RENAME TO audit_unavailable`); e != nil {
		t.Fatal(e)
	}
	if w = request(path, "staff"); w.Code != 503 {
		t.Fatal("audit failure must fail closed")
	}
	db.Exec(ctx, `ALTER TABLE audit_unavailable RENAME TO channel_read_audit`)
}

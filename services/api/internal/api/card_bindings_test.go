package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/projection"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestCustomerCardSnapshot(t *testing.T) {
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
	defer db.Exec(ctx, `TRUNCATE channel_connections,users CASCADE`)
	b := projection.Bundle{ConnectionID: "binding-test", AccountID: "account-test", Label: "Synthetic binding", SourceAt: "2026-09-07T00:00:00Z"}
	for i := 0; i < 25; i++ {
		b.Records = append(b.Records, projection.Record{Kind: "card", Data: map[string]any{"id": fmt.Sprintf("card-%02d", i), "accountId": b.AccountID, "cardName": "Test card", "cardStatus": "active"}})
	}
	b.Records = append(b.Records, projection.Record{Kind: "transaction", Data: map[string]any{"id": "tx-one", "accountId": b.AccountID, "cardId": "card-00", "amountCents": "-9007199254740993", "status": "posted", "detailedStatus": "settled", "date": b.SourceAt}}, projection.Record{Kind: "transaction", Data: map[string]any{"id": "tx-unbound", "accountId": b.AccountID, "cardId": "missing-card", "amountCents": "100", "status": "posted", "detailedStatus": "refund", "date": b.SourceAt}})
	rev, e := projection.Import(ctx, db, b, "staff")
	if e != nil {
		t.Fatal(e)
	}
	bind := func(uid, version string, count int) (int, error) {
		return database.BindCardSnapshot(ctx, db, uid, b.ConnectionID, version, "Synthetic explicit user request", count)
	}
	for _, uid := range []string{"disabled", "staff", "absent"} {
		if _, e = bind(uid, rev, 25); e == nil {
			t.Fatal("invalid identity accepted", uid)
		}
	}
	if _, e = bind("alice", rev, 24); e == nil {
		t.Fatal("wrong count accepted")
	}
	if _, e = bind("alice", "wrong", 25); e == nil {
		t.Fatal("wrong revision accepted")
	}
	if count, e := bind("alice", rev, 25); e != nil || count != 25 {
		t.Fatal(count, e)
	}
	if count, e := bind("alice", rev, 25); e != nil || count != 0 {
		t.Fatal("non-idempotent", count, e)
	}
	if _, e = bind("bob", rev, 25); e == nil {
		t.Fatal("rebind allowed")
	}
	var n int
	db.QueryRow(ctx, `SELECT count(*) FROM customer_card_snapshots WHERE customer_id=$1`, other).Scan(&n)
	if n != 0 {
		t.Fatal("partial assignment")
	}
	db.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action LIKE 'card-snapshot:bind:%'`).Scan(&n)
	if n != 1 {
		t.Fatal("bind audit", n)
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
	base := "/client-api/v1/customers/" + personal + "/card-projections"
	for _, tc := range []struct {
		path, token string
		code        int
	}{{base, "", 401}, {base, "disabled", 403}, {base, "staff", 403}, {base, "bob", 404}, {strings.Replace(base, personal, other, 1), "alice", 404}, {base, "alice", 200}, {base + "/binding-test/cards?page=1", "alice", 200}, {base + "/binding-test/transactions/tx-unbound", "alice", 404}, {base + "/binding-test/transactions?cardId=missing-card", "alice", 404}, {base + "/unbound/cards/card-00", "alice", 404}, {base + "/binding-test/cards?customerId=x", "alice", 400}, {base + "/binding-test/cards?page=0&page=1", "alice", 400}, {base + "/binding-test/cards?revision=wrong", "alice", 409}, {base + "/binding-test/cards/card-00?cardId=x", "alice", 400}} {
		w := request(tc.path, tc.token)
		if w.Code != tc.code {
			t.Fatal(tc, w.Code, w.Body.String())
		}
	}
	decode := func(path string) map[string]any {
		t.Helper()
		w := request(path, "alice")
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		var result map[string]any
		if e = json.Unmarshal(w.Body.Bytes(), &result); e != nil {
			t.Fatal(e)
		}
		return result["data"].(map[string]any)
	}
	page := decode(base + "/binding-test/cards?page=1")
	if page["total"] != float64(25) || len(page["rows"].([]any)) != 5 {
		t.Fatal(page)
	}
	data := decode(base + "/binding-test/transactions")
	rows := data["rows"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["amountCents"] != "-9007199254740993" || rows[0].(map[string]any)["accountId"] != nil || data["syncMode"] != "test_snapshot" {
		t.Fatal(data)
	}
	// Same resource IDs in another connection must not grant access.
	b.ConnectionID = "other-connection"
	if _, e = projection.Import(ctx, db, b, "staff"); e != nil {
		t.Fatal(e)
	}
	if w := request(base+"/other-connection/cards/card-00", "alice"); w.Code != 404 {
		t.Fatal("cross connection", w.Code)
	}
	// Source updates must not silently broaden the frozen test snapshot.
	b.ConnectionID = "binding-test"
	b.SourceAt = "2026-09-08T00:00:00Z"
	b.Records = append(b.Records, projection.Record{Kind: "card", Data: map[string]any{"id": "new-card", "accountId": b.AccountID}})
	newRev, e := projection.Import(ctx, db, b, "staff")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = bind("alice", newRev, 26); e == nil {
		t.Fatal("snapshot replacement allowed")
	}
	if decode(base + "/binding-test/cards")["total"] != float64(25) {
		t.Fatal("snapshot expanded")
	}
	// Read audit failure must prevent returning records.
	if _, e = db.Exec(ctx, `ALTER TABLE channel_read_audit ADD CONSTRAINT reject_customer_audit CHECK(actor_id<>'00000000-0000-0000-0000-000000000001') NOT VALID`); e != nil {
		t.Fatal(e)
	}
	defer db.Exec(ctx, `ALTER TABLE channel_read_audit DROP CONSTRAINT reject_customer_audit`)
	if w := request(base+"/binding-test/cards", "alice"); w.Code != 503 || strings.Contains(w.Body.String(), "Test card") {
		t.Fatal("audit fail-open", w.Code, w.Body.String())
	}
}

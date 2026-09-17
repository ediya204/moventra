package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
)

func TestOnlineTestWallet(t *testing.T) {
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
	basePool := db
	if _, e = basePool.Exec(ctx, `CREATE SCHEMA online_test_wallet_fixture`); e != nil {
		t.Fatal(e)
	}
	defer basePool.Exec(ctx, `DROP SCHEMA online_test_wallet_fixture CASCADE`)
	cfg.ConnConfig.RuntimeParams["search_path"] = "online_test_wallet_fixture"
	db, e = pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = database.Migrate(ctx, db); e != nil {
		t.Fatal(e)
	}
	if e = database.MigrateTestWallet(ctx, db); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, seed); e != nil {
		t.Fatal(e)
	}
	defer db.Exec(ctx, `TRUNCATE users CASCADE`)
	in := database.TestWalletGrant{RequestID: "65000000-0000-0000-0000-000000000001", USDMinor: "10000000", USDTMinor: "20009000000", Reason: "Synthetic online test credit"}
	for _, uid := range []string{"staff", "disabled", "missing"} {
		if _, _, e = database.GrantTestWallet(ctx, db, uid, in); e == nil {
			t.Fatal("invalid identity allowed", uid)
		}
	}
	for _, v := range []string{"0", "-1", "1.1", "+1", "001", "9223372036854775808"} {
		bad := in
		bad.USDMinor = v
		if _, _, e = database.GrantTestWallet(ctx, db, "alice", bad); e == nil {
			t.Fatal("invalid amount accepted", v)
		}
	}
	var wg sync.WaitGroup
	errs := make(chan error, 6)
	created := make(chan bool, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, added, err := database.GrantTestWallet(ctx, db, "alice", in)
			errs <- err
			created <- added
		}()
	}
	wg.Wait()
	close(errs)
	close(created)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	n := 0
	for added := range created {
		if added {
			n++
		}
	}
	if n != 1 {
		t.Fatal("duplicate grant", n)
	}
	bad := in
	bad.USDTMinor = "1"
	if _, _, e = database.GrantTestWallet(ctx, db, "alice", bad); e == nil {
		t.Fatal("idempotency mismatch allowed")
	}
	if _, _, e = database.GrantTestWallet(ctx, db, "bob", in); e == nil {
		t.Fatal("cross-customer request reuse allowed")
	}
	if _, e = db.Exec(ctx, `UPDATE online_test_wallet_grants SET usd_minor=1`); e == nil {
		t.Fatal("mutable grant")
	}
	if _, e = db.Exec(ctx, `DELETE FROM online_test_wallet_grants`); e == nil {
		t.Fatal("deleted grant")
	}
	h := (&Server{DB: db, Verifier: fakeVerifier{}}).Handler()
	req := func(method, path, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	base := "/client-api/v1/customers/" + personal + "/test-wallet"
	for _, tc := range []struct {
		path, token string
		code        int
	}{{base, "", 401}, {base, "disabled", 403}, {base, "staff", 403}, {base, "bob", 404}, {base + "?mode=live", "alice", 400}, {strings.Replace(base, personal, business, 1), "alice", 404}, {base, "alice", 200}} {
		w := req("GET", tc.path, tc.token)
		if w.Code != tc.code {
			t.Fatal(tc, w.Code, w.Body.String())
		}
	}
	if w := req("POST", base, "alice"); w.Code != 405 {
		t.Fatal("public mutation allowed", w.Code)
	}
	decode := func(path, token string) database.TestWalletSnapshot {
		t.Helper()
		w := req("GET", path, token)
		var payload struct {
			Data database.TestWalletSnapshot `json:"data"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &payload) != nil {
			t.Fatal(w.Code, w.Body.String())
		}
		return payload.Data
	}
	out := decode(base, "alice")
	if out.Mode != "online_test" || out.ExecutionEligible || out.WithdrawalEligible || !out.Enabled || len(out.Balances) != 2 || len(out.Grants) != 1 || out.Balances[0].AmountMinor != "10000000" || out.Balances[1].AmountMinor != "20009000000" {
		t.Fatal(out)
	}
	empty := decode(strings.Replace(base, personal, other, 1), "bob")
	if empty.Enabled || len(empty.Balances) != 0 || len(empty.Grants) != 0 {
		t.Fatal("unfunded account given fake balance", empty)
	}
	// Credits do not change real accounts, projections, customer activation or ledger state.
	for query, want := range map[string]int{`SELECT count(*) FROM accounts`: 3, `SELECT count(*) FROM transactions`: 2, `SELECT count(*) FROM customers WHERE service_status<>'inactive'`: 0, `SELECT count(*) FROM online_test_wallet_grants`: 1} {
		var got int
		if e = db.QueryRow(ctx, query).Scan(&got); e != nil || got != want {
			t.Fatal(query, got, e)
		}
	}
	// An arbitrary-size aggregate remains a decimal string, even beyond JS safe integers.
	large := in
	large.RequestID = "65000000-0000-0000-0000-000000000002"
	large.USDMinor = "9007199254740993"
	if _, _, e = database.GrantTestWallet(ctx, db, "alice", large); e != nil {
		t.Fatal(e)
	}
	if got := decode(base, "alice").Balances[0].AmountMinor; got != "9007199264740993" {
		t.Fatal(got)
	}
	if _, e = db.Exec(ctx, `ALTER TABLE audit_events ADD CONSTRAINT reject_test_wallet_reads CHECK(action<>'test-wallet:read') NOT VALID`); e != nil {
		t.Fatal(e)
	}
	defer db.Exec(ctx, `ALTER TABLE audit_events DROP CONSTRAINT reject_test_wallet_reads`)
	if w := req("GET", base, "alice"); w.Code != 503 || strings.Contains(w.Body.String(), "online_test") {
		t.Fatal("audit fail open", w.Code, w.Body.String())
	}
}

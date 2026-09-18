package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/ledger"
	"moventra.local/api/internal/manualfunds"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestManualFundsLifecycle(t *testing.T)            { testManualFundsLifecycle(t, false) }
func TestGlobalAdminManualFundsLifecycle(t *testing.T) { testManualFundsLifecycle(t, true) }
func testManualFundsLifecycle(t *testing.T, global bool) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	cfg, e := pgxpool.ParseConfig(raw)
	if e != nil || ledger.CheckLocalDatabase(cfg) != nil {
		t.Fatal("unsafe database")
	}
	base, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer base.Close()
	schema := "manual_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = base.Exec(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer base.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = database.Migrate(ctx, db); e != nil {
		t.Fatal(e)
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := db.Exec(ctx, q, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec(seed)
	exec(`UPDATE customers SET onboarding_status='approved',service_status='active'`)
	exec(`INSERT INTO users(id,firebase_uid,display_name,role) VALUES('00000000-0000-0000-0000-000000000005','new-user','Reviewer','admin'),('00000000-0000-0000-0000-000000000006','unopened','Unopened','customer')`)
	staff := "00000000-0000-0000-0000-000000000003"
	reviewer := "00000000-0000-0000-0000-000000000005"
	exec(`INSERT INTO manual_funds_grants SELECT u,'*',p FROM unnest(ARRAY[$1::uuid,$2::uuid]) u CROSS JOIN unnest(ARRAY['read','create','review','execute']) p`, staff, reviewer)
	if global {
		exec(`DELETE FROM manual_funds_grants WHERE user_id=$1`, staff)
		if err := database.SetGlobalAdmin(ctx, db, "staff", "isolated-self-review-regression", true); err != nil {
			t.Fatal(err)
		}
	}
	l, e := ledger.New(db, cryptoBlnk(t), "shadow_"+schema, "general_ledger_id")
	if e != nil {
		t.Fatal(e)
	}
	svc := &manualfunds.Service{DB: db, Ledger: l}
	handler := (&Server{DB: db, Ledger: l, Verifier: fakeVerifier{}, Directory: &fakeDirectory{}}).Handler()
	req := func(token, method, path string, body any, key string) *httptest.ResponseRecorder {
		b, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, strings.NewReader(string(b)))
		r.Header.Set("Authorization", "Bearer "+token)
		if method == "POST" {
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Idempotency-Key", key)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	root := "/admin-api/v1/customers/" + personal + "/manual-funds"
	decode := func(w *httptest.ResponseRecorder) manualfunds.Order {
		t.Helper()
		if w.Code != 200 {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
		var v struct {
			Data manualfunds.Order `json:"data"`
		}
		if e := json.Unmarshal(w.Body.Bytes(), &v); e != nil {
			t.Fatal(e)
		}
		return v.Data
	}
	get := func(id string) manualfunds.Order {
		tx, e := db.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(ctx)
		o, e := svc.Get(ctx, tx, personal, id)
		if e != nil {
			t.Fatal(e)
		}
		return o
	}
	action := func(token string, o manualfunds.Order, a string) manualfunds.Order {
		return decode(req(token, "POST", root+"/orders/"+o.ID+"/"+a, map[string]any{"revision": o.Revision, "note": "synthetic review"}, uuid.NewString()))
	}
	process := func(o manualfunds.Order) manualfunds.Order {
		t.Helper()
		if e := svc.Process(ctx, personal, o.ID); e != nil {
			t.Fatal(e)
		}
		return get(o.ID)
	}
	create := func(source, amount, original string) manualfunds.Order {
		t.Helper()
		return decode(req("staff", "POST", root+"/orders", map[string]any{"customerId": personal, "source": source, "currency": "USD", "amountMinor": amount, "evidenceRef": "synthetic-" + uuid.NewString(), "note": "synthetic funding", "originalId": original}, uuid.NewString()))
	}
	t.Run("boundaries and full user directory", func(t *testing.T) {
		for _, tc := range []struct {
			token, path string
			code        int
		}{{"alice", "/admin-api/v1/balances", 403}, {"staff-no-mfa", "/admin-api/v1/balances", 403}, {"staff", "/admin-api/v1/balances?page=-1", 400}, {"staff", "/admin-api/v1/balances?page=0&page=1", 400}} {
			w := req(tc.token, "GET", tc.path, nil, "")
			if w.Code != tc.code {
				t.Fatal(w.Code, w.Body)
			}
		}
		w := req("staff", "GET", "/admin-api/v1/balances", nil, "")
		if w.Code != 200 || !strings.Contains(w.Body.String(), "Unopened") || !strings.Contains(w.Body.String(), `"walletMinor":null`) {
			t.Fatal(w.Code, w.Body)
		}
	})
	var credit manualfunds.Order
	t.Run("same request concurrently creates one immutable economic order", func(t *testing.T) {
		key := uuid.NewString()
		body := map[string]any{"customerId": personal, "source": "platform_advance", "currency": "USD", "amountMinor": "1000000", "note": "synthetic advance", "evidenceRef": "synthetic-advance"}
		var wg sync.WaitGroup
		results := make(chan *httptest.ResponseRecorder, 4)
		for i := 0; i < 4; i++ {
			wg.Add(1)
			go func() { defer wg.Done(); results <- req("staff", "POST", root+"/orders", body, key) }()
		}
		wg.Wait()
		close(results)
		for w := range results {
			o := decode(w)
			if credit.ID != "" && credit.ID != o.ID {
				t.Fatal("duplicated")
			}
			credit = o
		}
		body["amountMinor"] = "1"
		if w := req("staff", "POST", root+"/orders", body, key); w.Code != 409 {
			t.Fatal(w.Code, w.Body)
		}
		if w := req("staff", "POST", root+"/orders", body, uuid.NewString()); w.Code != 409 {
			t.Fatal(w.Code, w.Body)
		}
	})
	t.Run("independent approval and ledger application", func(t *testing.T) {
		w := req("staff", "POST", root+"/orders/"+credit.ID+"/approve", map[string]any{"revision": credit.Revision, "note": "self"}, uuid.NewString())
		if w.Code != 403 {
			t.Fatal(w.Code, w.Body)
		}
		credit = action("new-user", credit, "approve")
		credit = process(credit)
		if credit.State != "completed" || credit.Before == nil || *credit.Before != "0" || *credit.After != "1000000" {
			t.Fatalf("%+v", credit)
		}
		if e := svc.Process(ctx, personal, credit.ID); e != nil {
			t.Fatal(e)
		}
		w = req("alice", "GET", "/client-api/v1/customers/"+personal+"/manual-funds/orders/"+credit.ID, nil, "")
		if w.Code != 200 || strings.Contains(w.Body.String(), "synthetic advance") || strings.Contains(w.Body.String(), "evidenceRef") {
			t.Fatal(w.Code, w.Body)
		}
		w = req("bob", "GET", "/client-api/v1/customers/"+personal+"/manual-funds/orders/"+credit.ID, nil, "")
		if w.Code != 404 {
			t.Fatal(w.Code, w.Body)
		}
	})
	t.Run("reserve, reject and release; recovering original cannot exceed it", func(t *testing.T) {
		o := create("advance_recovery", "30000", credit.ID)
		o = process(o)
		if o.State != "pending_review" {
			t.Fatal(o)
		}
		o = action("new-user", o, "reject")
		o = process(o)
		if o.State != "rejected" {
			t.Fatal(o)
		}
		o = create("advance_recovery", "50000", credit.ID)
		o = process(o)
		o = action("new-user", o, "approve")
		o = process(o)
		if o.State != "completed" {
			t.Fatal(o)
		}
		w := req("staff", "POST", root+"/orders", map[string]any{"customerId": personal, "source": "advance_recovery", "currency": "USD", "amountMinor": "1000000", "note": "too much", "evidenceRef": "synthetic-too-much", "originalId": credit.ID}, uuid.NewString())
		if w.Code != 409 {
			t.Fatal(w.Code, w.Body)
		}
	})
	t.Run("concurrent debits cannot overspend; journal totals include held money once", func(t *testing.T) {
		a := create("offline_payout", "600000", "")
		b := create("offline_payout", "600000", "")
		var wg sync.WaitGroup
		errs := make(chan error, 2)
		for _, o := range []manualfunds.Order{a, b} {
			wg.Add(1)
			go func(o manualfunds.Order) { defer wg.Done(); errs <- svc.Process(ctx, personal, o.ID) }(o)
		}
		wg.Wait()
		close(errs)
		for e := range errs {
			if e != nil {
				t.Fatal(e)
			}
		}
		a, b = get(a.ID), get(b.ID)
		if a.State == "failed" {
			a, b = b, a
		}
		if a.State != "pending_review" || b.State != "failed" {
			t.Fatal(a.State, b.State)
		}
		w := req("staff", "GET", "/admin-api/v1/balances/"+personal+"?currency=USD&page=1", nil, "")
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"walletMinor":"350000"`) || !strings.Contains(w.Body.String(), `"heldMinor":"600000"`) || !strings.Contains(w.Body.String(), `"totalMinor":"950000"`) {
			t.Fatal(w.Code, w.Body)
		}
		a = action("new-user", a, "approve")
		if a.State != "awaiting_payment" {
			t.Fatal(a.State)
		}
		a = process(a)
		if a.State != "awaiting_payment" {
			t.Fatal("approval acted as payout")
		}
		a = decode(req("new-user", "POST", root+"/orders/"+a.ID+"/payment_failed", map[string]any{"revision": a.Revision, "note": "verified failure", "evidenceRef": "synthetic-failed"}, uuid.NewString()))
		a = process(a)
		if a.State != "failed" {
			t.Fatal(a.State)
		}
	})
	t.Run("permissions and audit failure roll back new orders", func(t *testing.T) {
		exec(`DELETE FROM manual_funds_grants WHERE user_id=$1 AND permission='create'`, reviewer)
		o := create("platform_advance", "1", "")
		w := req("new-user", "POST", root+"/orders", map[string]any{}, uuid.NewString())
		if w.Code != 404 {
			t.Fatal(w.Code, w.Body)
		}
		exec(`CREATE FUNCTION reject_manual_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic'; END $$; CREATE TRIGGER reject_manual BEFORE INSERT ON manual_funds_audit FOR EACH ROW EXECUTE FUNCTION reject_manual_audit()`)
		w = req("staff", "POST", root+"/orders", map[string]any{"customerId": personal, "source": "platform_advance", "currency": "USD", "amountMinor": "1", "note": "audit fail", "evidenceRef": "audit-must-rollback"}, uuid.NewString())
		if w.Code != 503 {
			t.Fatal(w.Code, w.Body)
		}
		var count int
		db.QueryRow(ctx, `SELECT count(*) FROM manual_funds_orders WHERE evidence_ref='audit-must-rollback'`).Scan(&count)
		if count != 0 {
			t.Fatal("audit rollback failed")
		}
		exec(`DROP TRIGGER reject_manual ON manual_funds_audit`)
		_ = o
	})

	t.Run("worker restart after remote success and local audit failure never duplicates credit", func(t *testing.T) {
		o := create("platform_advance", "12345", "")
		o = action("new-user", o, "approve")
		exec(`CREATE FUNCTION reject_manual_worker() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='worker' THEN RAISE EXCEPTION 'synthetic worker failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_manual_worker BEFORE INSERT ON manual_funds_audit FOR EACH ROW EXECUTE FUNCTION reject_manual_worker()`)
		if err := svc.Process(ctx, personal, o.ID); err == nil {
			t.Fatal("expected local audit failure")
		}
		if get(o.ID).State != "processing" {
			t.Fatal("uncommitted state escaped")
		}
		exec(`DROP TRIGGER reject_manual_worker ON manual_funds_audit`)
		o = process(o)
		if o.State != "completed" {
			t.Fatal(o.State)
		}
		var count int
		var amount string
		if err := db.QueryRow(ctx, `SELECT count(*),COALESCE(sum(j.amount_minor),0)::text FROM ledger_journal j JOIN ledger_operations op ON op.id=j.operation_id WHERE op.effect_key=$1`, "manual:"+o.ID+":credit").Scan(&count, &amount); err != nil {
			t.Fatal(err)
		}
		if count != 1 || amount != "12345" {
			t.Fatal(count, amount)
		}
	})
	t.Run("scoped reader cannot access all customers or leak through direct detail", func(t *testing.T) {
		exec(`UPDATE manual_funds_grants SET scope=$1 WHERE user_id=$2`, personal, reviewer)
		w := req("new-user", "GET", "/admin-api/v1/balances", nil, "")
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"total":1`) {
			t.Fatal(w.Code, w.Body)
		}
		w = req("new-user", "GET", "/admin-api/v1/balances/"+other, nil, "")
		if w.Code != 404 {
			t.Fatal(w.Code, w.Body)
		}
	})
	t.Run("pagination and exact email query", func(t *testing.T) {
		for i := 0; i < 23; i++ {
			exec(`INSERT INTO users(id,firebase_uid,display_name,role) VALUES($1,$2,$3,'customer')`, uuid.NewString(), fmt.Sprintf("page-%d", i), fmt.Sprintf("Page %d", i))
		}
		w := req("staff", "GET", "/admin-api/v1/balances?q=alice%40example.com", nil, "")
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"total":1`) {
			t.Fatal(w.Code, w.Body)
		}
		w = req("staff", "GET", "/admin-api/v1/balances?page=1", nil, "")
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
	})
	// Explicit local browser harness. No test authentication is compiled into API.
	if os.Getenv("MANUAL_FUNDS_BROWSER") == "true" {
		browser := httptest.NewServer(handler)
		defer browser.Close()
		path := "/tmp/moventra-manual-browser-api"
		if err := os.WriteFile(path, []byte(browser.URL), 0600); err != nil {
			t.Fatal(err)
		}
		defer os.Remove(path)
		t.Log("synthetic browser API ready")
		until := time.After(8 * time.Minute)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-until:
				return
			case <-ticker.C:
				if _, err := os.Stat(path); os.IsNotExist(err) {
					return
				}
				svc.Drain(ctx)
			}
		}
	}

}

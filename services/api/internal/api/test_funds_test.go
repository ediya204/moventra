package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/testfunds"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestOnlineFundsLifecycle(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated database required")
	}
	ctx := context.Background()
	cfg, e := pgxpool.ParseConfig(url)
	if e != nil {
		t.Fatal(e)
	}
	if !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("refusing non-test DB")
	}
	base, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer base.Close()
	if _, e = base.Exec(ctx, `CREATE SCHEMA funds_flow`); e != nil {
		t.Fatal(e)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = "funds_flow"
	db, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = database.Migrate(ctx, db); e != nil {
		t.Fatal(e)
	}
	if e = database.MigrateTestFunds(ctx, db); e != nil {
		t.Fatal(e)
	}
	if e = database.MigrateTestFunds(ctx, db); e != nil {
		t.Fatal(e)
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, e := db.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec(seed)
	exec(`UPDATE customers SET onboarding_status='approved',service_status='active' WHERE id=$1`, personal)
	exec(`INSERT INTO online_test_wallet_grants(request_id,customer_id,target_user_id,usd_minor,usdt_minor,reason,executed_by) VALUES($1,$2,'00000000-0000-0000-0000-000000000001',10000000,20009000000,'fixture','trusted_cli_user_request')`, uuid.NewString(), personal)
	h := (&Server{DB: db, Verifier: fakeVerifier{}}).Handler()
	request := func(surface, token, method, suffix, body, key string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/"+surface+"-api/v1/customers/"+personal+"/test-funds"+suffix, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	cmd := func(admin bool, in testfunds.Input, key string, code int) testfunds.Result {
		t.Helper()
		surface, token := "client", "alice"
		if admin {
			surface, token = "admin", "staff"
		}
		raw, _ := json.Marshal(in)
		w := request(surface, token, "POST", "/commands", string(raw), key)
		if w.Code != code {
			t.Fatalf("%s: got %d want %d: %s", in.Action, w.Code, code, w.Body)
		}
		var out struct{ Data testfunds.Result }
		if code == 200 {
			if e := json.Unmarshal(w.Body.Bytes(), &out); e != nil {
				t.Fatal(e)
			}
		}
		return out.Data
	}
	apply := func(admin bool, in testfunds.Input) testfunds.Result {
		t.Helper()
		return cmd(admin, in, uuid.NewString(), 200)
	}
	snapshot := func() testfunds.Snapshot {
		t.Helper()
		w := request("client", "alice", "GET", "", "", "")
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		var out struct{ Data testfunds.Snapshot }
		if e := json.Unmarshal(w.Body.Bytes(), &out); e != nil {
			t.Fatal(e)
		}
		return out.Data
	}
	balance := func(c, available, held string) {
		t.Helper()
		for _, b := range snapshot().Balances {
			if b.Currency == c && (b.Available != available || b.Held != held) {
				t.Fatalf("%+v want available %s held %s", b, available, held)
			}
		}
	}
	for _, tc := range []struct {
		s, t string
		code int
	}{{"client", "bob", 404}, {"admin", "staff", 404}, {"admin", "staff-no-mfa", 403}, {"client", "disabled", 403}, {"client", "staff", 403}, {"admin", "alice", 403}} {
		w := request(tc.s, tc.t, "GET", "", "", "")
		if w.Code != tc.code {
			t.Fatal(tc, w.Code, w.Body)
		}
	}
	exec(`INSERT INTO online_test_funds_review_grants(user_id,customer_id,reason) VALUES('00000000-0000-0000-0000-000000000003',$1,'fixture')`, personal)
	if w := request("client", "alice", "GET", "?status=pending%7Cconfirming", "", ""); w.Code != 400 {
		t.Fatal(w.Code)
	}
	cmd(false, testfunds.Input{Action: "deposit|quote", Currency: "USD", AmountMinor: "100"}, uuid.NewString(), 403)
	cmd(false, testfunds.Input{Action: "deposit", Currency: "USD", AmountMinor: "100"}, "", 400)
	cmd(false, testfunds.Input{Action: "deposit", Currency: "USD", AmountMinor: "1.5"}, uuid.NewString(), 400)
	cmd(false, testfunds.Input{Action: "complete", OrderID: uuid.NewString()}, uuid.NewString(), 403)
	balance("USD", "10000000", "0")
	// Deposit is not spendable until a separate operator confirms it.
	in := testfunds.Input{Action: "deposit", Currency: "USD", AmountMinor: "10000"}
	key := uuid.NewString()
	deposit := cmd(false, in, key, 200).Order
	if replay := cmd(false, in, key, 200).Order; replay.ID != deposit.ID {
		t.Fatal("duplicate order")
	}
	in.AmountMinor = "10001"
	cmd(false, in, key, 409)
	balance("USD", "10000000", "0")
	cmd(true, testfunds.Input{Action: "complete", OrderID: deposit.ID, Revision: 1, Note: "skip detection"}, uuid.NewString(), 409)
	d := apply(true, testfunds.Input{Action: "detect", OrderID: deposit.ID, Revision: 1, Note: "test detected"}).Order
	apply(true, testfunds.Input{Action: "complete", OrderID: d.ID, Revision: d.Revision, Note: "test credited"})
	balance("USD", "10010000", "0")
	// Quote integer policy, scoped single consumption and atomic two-currency posting.
	q := apply(false, testfunds.Input{Action: "quote", Currency: "USDT", AmountMinor: "100000000"}).Quote
	if q.Fee != "500000" || q.Receive != "9850" {
		t.Fatalf("quote %+v", q)
	}
	ex := testfunds.Input{Action: "exchange", QuoteID: q.ID}
	key = uuid.NewString()
	order := cmd(false, ex, key, 200).Order
	cmd(false, ex, key, 200)
	cmd(false, ex, uuid.NewString(), 409)
	if order.Status != "completed" {
		t.Fatal(order)
	}
	balance("USD", "10019850", "0")
	balance("USDT", "19909000000", "0")
	// Expired quotes and quotes belonging to another customer cannot be consumed.
	expired := uuid.NewString()
	exec(`INSERT INTO online_test_funds_quotes(id,customer_id,actor_id,currency,amount_minor,fee_minor,receive_minor,policy_version,expires_at) VALUES($1,$2,'00000000-0000-0000-0000-000000000001','USD',10000,50,100505050,'test-v1',now()-interval '1 minute')`, expired, personal)
	cmd(false, testfunds.Input{Action: "exchange", QuoteID: expired}, uuid.NewString(), 409)
	foreign := uuid.NewString()
	exec(`INSERT INTO online_test_funds_quotes(id,customer_id,actor_id,currency,amount_minor,fee_minor,receive_minor,policy_version,expires_at) VALUES($1,$2,'00000000-0000-0000-0000-000000000002','USD',10000,50,100505050,'test-v1',now()+interval '1 minute')`, foreign, other)
	cmd(false, testfunds.Input{Action: "exchange", QuoteID: foreign}, uuid.NewString(), 404)
	// Withdrawal approval is not settlement. Unknown must keep the complete hold.
	w := apply(false, testfunds.Input{Action: "withdraw", Currency: "USDT", AmountMinor: "10000000", RecipientLabel: "synthetic recipient"}).Order
	balance("USDT", "19897000000", "12000000")
	w = apply(true, testfunds.Input{Action: "approve", OrderID: w.ID, Revision: w.Revision, Note: "approved"}).Order
	balance("USDT", "19897000000", "12000000")
	cmd(false, testfunds.Input{Action: "cancel", OrderID: w.ID, Revision: w.Revision}, uuid.NewString(), 409)
	w = apply(true, testfunds.Input{Action: "unknown", OrderID: w.ID, Revision: w.Revision, Note: "unknown"}).Order
	balance("USDT", "19897000000", "12000000")
	apply(true, testfunds.Input{Action: "fail", OrderID: w.ID, Revision: w.Revision, Note: "confirmed test failure"})
	balance("USDT", "19909000000", "0")
	w = apply(false, testfunds.Input{Action: "withdraw", Currency: "USD", AmountMinor: "100", RecipientLabel: "fixture"}).Order
	w = apply(true, testfunds.Input{Action: "approve", OrderID: w.ID, Revision: w.Revision, Note: "review"}).Order
	settle := testfunds.Input{Action: "complete", OrderID: w.ID, Revision: w.Revision, Note: "simulation complete"}
	key = uuid.NewString()
	cmd(true, settle, key, 200)
	cmd(true, settle, key, 200)
	cmd(true, settle, uuid.NewString(), 409)
	balance("USD", "10019750", "0")
	// Concurrent different requests cannot overspend the same available balance.
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes <- request("client", "alice", "POST", "/commands", `{"action":"withdraw","currency":"USDT","amountMinor":"15000000000","recipientLabel":"race"}`, uuid.NewString()).Code
		}()
	}
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for c := range codes {
		counts[c]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatal(counts)
	}
	// Cancellation remains available after service suspension; new operations do not.
	exec(`UPDATE customers SET service_status='suspended' WHERE id=$1`, personal)
	cmd(false, testfunds.Input{Action: "deposit", Currency: "USD", AmountMinor: "100"}, uuid.NewString(), 403)
	for _, o := range snapshot().Orders {
		if o.Status == "pending_review" {
			apply(false, testfunds.Input{Action: "cancel", OrderID: o.ID, Revision: o.Revision})
		}
	}
	balance("USDT", "19909000000", "0")
	exec(`UPDATE customers SET service_status='active' WHERE id=$1`, personal)
	// Concurrent retries create exactly one order and command.
	key = uuid.NewString()
	codes = make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes <- request("client", "alice", "POST", "/commands", `{"action":"deposit","currency":"USDT","amountMinor":"1000"}`, key).Code
		}()
	}
	wg.Wait()
	close(codes)
	for c := range codes {
		if c != 200 {
			t.Fatal(c)
		}
	}
	var n int
	if e := db.QueryRow(ctx, `SELECT count(*) FROM online_test_funds_commands WHERE request_id=$1`, key).Scan(&n); e != nil || n != 1 {
		t.Fatal(e, n)
	}
	// Audit failure rolls back the order and idempotency result in the same transaction.
	exec(`CREATE FUNCTION reject_funds_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'test-funds:deposit:%' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_funds_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_funds_audit()`)
	before := snapshot().Total
	cmd(false, testfunds.Input{Action: "deposit", Currency: "USD", AmountMinor: "9876"}, uuid.NewString(), 503)
	if snapshot().Total != before {
		t.Fatal("failed audit left order")
	}
	// Stable detail, events, legacy wallet consistency and original tables untouched.
	detail := request("client", "alice", "GET", "/orders/"+deposit.ID, "", "")
	if detail.Code != 200 || !strings.Contains(detail.Body.String(), "test credited") {
		t.Fatal(detail.Code, detail.Body)
	}
	var real string
	if e := db.QueryRow(ctx, `SELECT count(*)::text||':'||(SELECT count(*) FROM transactions)::text FROM accounts`).Scan(&real); e != nil || real != "3:2" {
		t.Fatal(real, e)
	}
	for _, table := range []string{"online_test_funds_movements", "online_test_funds_events", "online_test_funds_commands"} {
		if _, e := db.Exec(ctx, fmt.Sprintf("DELETE FROM %s", table)); e == nil {
			t.Fatal("immutable", table)
		}
	}
}

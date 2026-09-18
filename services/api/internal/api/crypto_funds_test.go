package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"math/big"
	"moventra.local/api/internal/blnk"
	"moventra.local/api/internal/cregis"
	"moventra.local/api/internal/cryptofunds"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/ledger"
	"moventra.local/api/internal/tron"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func cryptoBlnk(t *testing.T) *blnk.Client {
	t.Helper()
	if raw := os.Getenv("BLNK_TEST_URL"); raw != "" {
		if !strings.HasPrefix(raw, "http://127.0.0.1:") {
			t.Fatal("local Blnk only")
		}
		c, e := blnk.New(raw, os.Getenv("BLNK_TEST_KEY"))
		if e != nil {
			t.Fatal(e)
		}
		return c
	}
	var mu sync.Mutex
	balances := map[string]*big.Int{}
	currencies := map[string]string{}
	indicators := map[string]string{}
	transfers := map[string]map[string]any{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		reply := func(v any) { w.Header().Set("Content-Type", "application/json"); json.NewEncoder(w).Encode(v) }
		balance := func(id, indicator string) {
			reply(map[string]any{"balance_id": id, "ledger_id": "general_ledger_id", "indicator": indicator, "currency": currencies[id], "balance": balances[id], "inflight_debit_balance": 0})
		}
		switch {
		case r.Method == "POST" && r.URL.Path == "/balances":
			var v map[string]any
			json.NewDecoder(r.Body).Decode(&v)
			indicator := v["indicator"].(string)
			id := "bln_" + strings.TrimPrefix(indicator, "@")
			balances[id] = big.NewInt(0)
			currencies[id] = v["currency"].(string)
			indicators[indicator] = id
			balance(id, indicator)
		case strings.HasPrefix(r.URL.Path, "/balances/indicator/"):
			indicator := strings.Split(strings.TrimPrefix(r.URL.Path, "/balances/indicator/"), "/")[0]
			id := indicators[indicator]
			if id == "" {
				w.WriteHeader(404)
				return
			}
			balance(id, indicator)
		case strings.HasPrefix(r.URL.Path, "/balances/"):
			id := strings.TrimPrefix(r.URL.Path, "/balances/")
			if balances[id] == nil {
				w.WriteHeader(404)
				return
			}
			balance(id, "")
		case strings.HasPrefix(r.URL.Path, "/transactions/reference/"):
			ref := strings.TrimPrefix(r.URL.Path, "/transactions/reference/")
			if transfers[ref] == nil {
				w.WriteHeader(404)
				return
			}
			reply(transfers[ref])
		case r.Method == "POST" && r.URL.Path == "/transactions":
			var v struct {
				Reference   string   `json:"reference"`
				Source      string   `json:"source"`
				Destination string   `json:"destination"`
				Amount      *big.Int `json:"precise_amount"`
				Precision   int      `json:"precision"`
				Currency    string   `json:"currency"`
				Overdraft   bool     `json:"allow_overdraft"`
			}
			json.NewDecoder(r.Body).Decode(&v)
			if transfers[v.Reference] != nil {
				reply(transfers[v.Reference])
				return
			}
			if !v.Overdraft && balances[v.Source].Cmp(v.Amount) < 0 {
				w.WriteHeader(400)
				reply(map[string]any{"error_detail": map[string]string{"code": "TXN_INSUFFICIENT_FUNDS"}})
				return
			}
			balances[v.Source].Sub(balances[v.Source], v.Amount)
			balances[v.Destination].Add(balances[v.Destination], v.Amount)
			tr := map[string]any{"transaction_id": "txn_" + v.Reference, "reference": v.Reference, "source": v.Source, "destination": v.Destination, "currency": v.Currency, "precision": v.Precision, "precise_amount": v.Amount, "status": "APPLIED"}
			transfers[v.Reference] = tr
			reply(tr)
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(srv.Close)
	c, e := blnk.New(srv.URL, "synthetic")
	if e != nil {
		t.Fatal(e)
	}
	return c
}
func TestCryptoFundsLifecycle(t *testing.T) {
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
	schema := "crypto_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(seed)
	exec(`UPDATE customers SET onboarding_status='approved',service_status='active' WHERE id=$1`, personal)
	l, e := ledger.New(db, cryptoBlnk(t), "shadow_"+schema, "general_ledger_id")
	if e != nil {
		t.Fatal(e)
	}
	svc, e := cryptofunds.New(l)
	if e != nil {
		t.Fatal(e)
	}
	srv := (&Server{DB: db, Verifier: fakeVerifier{}, Ledger: l}).Handler()
	req := func(surface, token, method, suffix string, body any, key string) *httptest.ResponseRecorder {
		b, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/"+surface+"-api/v1/customers/"+personal+"/crypto"+suffix, strings.NewReader(string(b)))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		srv.ServeHTTP(w, r)
		return w
	}
	call := func(admin bool, suffix string, in any, key string, want int) json.RawMessage {
		t.Helper()
		surface, token := "client", "alice"
		if admin {
			surface, token = "admin", "staff"
		}
		w := req(surface, token, "POST", suffix, in, key)
		if w.Code != want {
			t.Fatalf("%s got %d want %d: %s", suffix, w.Code, want, w.Body)
		}
		var out struct{ Data json.RawMessage }
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return out.Data
	}
	fresh := func(admin bool, suffix string, in any) json.RawMessage {
		return call(admin, suffix, in, uuid.NewString(), 200)
	}
	get := func(id string) cryptofunds.Order {
		t.Helper()
		w := req("client", "alice", "GET", "/orders/"+id, nil, "")
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		var out struct {
			Data struct{ Order cryptofunds.Order }
		}
		if e = json.Unmarshal(w.Body.Bytes(), &out); e != nil {
			t.Fatal(e)
		}
		return out.Data.Order
	}
	process := func(o cryptofunds.Order, want string) {
		t.Helper()
		if e = svc.Process(ctx, personal, o.ID); e != nil {
			t.Fatal("process", o.ID, e)
		}
		if got := get(o.ID); got.State != want {
			t.Fatalf("state %s want %s (%+v)", got.State, want, got)
		}
	}
	wallet := func(c, want string) {
		t.Helper()
		snapshot, e := l.Snapshot(ctx, personal)
		if e != nil {
			t.Fatal(e)
		}
		got := "0"
		for _, a := range snapshot.Accounts {
			if a.Currency == c && a.Kind == "wallet" {
				got = a.AvailableMinor
			}
		}
		if got != want {
			t.Fatalf("wallet %s=%s want %s", c, got, want)
		}
	}
	if w := req("client", "bob", "GET", "", nil, ""); w.Code != 404 {
		t.Fatal("cross customer", w.Code)
	}
	if w := req("admin", "staff-no-mfa", "GET", "", nil, ""); w.Code != 403 {
		t.Fatal("mfa", w.Code)
	}
	call(true, "/settings", cryptofunds.Input{Note: "fixture", Settings: &cryptofunds.Settings{}}, uuid.NewString(), 404)
	exec(`INSERT INTO crypto_grants(namespace,customer_id,user_id,permission) SELECT $1,$2,id,p FROM users CROSS JOIN unnest(ARRAY['read','review','configure','recover']) p WHERE firebase_uid='staff'`, svc.NS(), personal)
	fee := "500000"
	settings := cryptofunds.Settings{USDTToUSD: "0.987", USDToUSDT: "1.02", OTCEnabled: true, WithdrawEnabled: true, WithdrawalFee: &fee}
	_ = json.Unmarshal(fresh(true, "/settings", cryptofunds.Input{Note: "fixture", Settings: &settings}), &settings)
	fresh(false, "/addresses", cryptofunds.Input{})
	contract := "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV"
	recipient := tron.FixtureAddress(svc.NS() + ":" + personal)
	ch, _ := tron.AddressHex(contract)
	to, _ := tron.AddressHex(recipient)
	receipt := tron.Receipt{ID: strings.Repeat("a", 64), BlockNumber: json.Number("100"), Logs: []tron.Log{{Address: ch, Topics: []string{"ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", strings.Repeat("0", 64), strings.Repeat("0", 24) + to}, Data: fmt.Sprintf("%064x", 100000000)}}}
	receipt.Receipt.Result = "SUCCESS"
	fields := map[string]any{"pid": json.Number("1"), "cid": json.Number("9007199254740993"), "chain_id": "195", "token_id": contract, "currency": "USDT", "address": recipient, "amount": "100", "status": "1", "txid": receipt.ID, "nonce": "abcdef", "timestamp": json.Number("1000000000000")}
	signature, _ := cregis.WaaSSignature("moventra-synthetic-cregis", fields)
	fields["sign"] = signature
	callback, _ := json.Marshal(fields)
	deposit, e := svc.ReceiveFixture(ctx, callback, receipt)
	if e != nil {
		t.Fatal(e)
	}
	process(deposit, "completed")
	again, e := svc.ReceiveFixture(ctx, callback, receipt)
	if e != nil || again.ID != deposit.ID {
		t.Fatal("deposit replay", e)
	}
	process(again, "completed")
	wallet("USDT", "100000000")
	quote := func(kind, c, amount string) cryptofunds.Quote {
		t.Helper()
		var q cryptofunds.Quote
		_ = json.Unmarshal(fresh(false, "/"+kind+"/quotes", cryptofunds.Input{Currency: c, Amount: amount}), &q)
		return q
	}
	order := func(kind string, q cryptofunds.Quote, key string) cryptofunds.Order {
		t.Helper()
		var o cryptofunds.Order
		_ = json.Unmarshal(call(false, "/"+kind+"/orders", cryptofunds.Input{QuoteID: q.ID, Address: recipient}, key, 200), &o)
		return o
	}
	q := quote("otc", "USDT", "10000000")
	key := uuid.NewString()
	o := order("otc", q, key)
	o2 := order("otc", q, key)
	if o.ID != o2.ID {
		t.Fatal("duplicate order")
	}
	call(false, "/otc/orders", cryptofunds.Input{QuoteID: q.ID}, uuid.NewString(), 409)
	process(o, "completed")
	wallet("USDT", "90000000")
	wallet("USD", "987")
	q = quote("otc", "USD", "100")
	o = order("otc", q, uuid.NewString())
	process(o, "completed")
	wallet("USDT", "91020000")
	wallet("USD", "887")
	q = quote("otc", "USDT", "1000000")
	settings.USDTToUSD = "0.98"
	_ = json.Unmarshal(fresh(true, "/settings", cryptofunds.Input{Note: "reprice", Settings: &settings}), &settings)
	call(false, "/otc/orders", cryptofunds.Input{QuoteID: q.ID}, uuid.NewString(), 409)
	q = quote("otc", "USDT", "1000000")
	exec(`UPDATE crypto_quotes SET data=jsonb_set(data,'{expiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1`, q.ID)
	call(false, "/otc/orders", cryptofunds.Input{QuoteID: q.ID}, uuid.NewString(), 409)
	q = quote("withdrawals", "USDT", "2000000")
	o = order("withdrawals", q, uuid.NewString())
	process(o, "pending_review")
	o = get(o.ID)
	fresh(true, "/approve", cryptofunds.Input{OrderID: o.ID, Revision: o.Revision, Note: "approve"})
	process(o, "completed")
	wallet("USDT", "88520000")
	// Concurrent reservations cannot overdraw, even though there is no inventory gate.
	q1 := quote("otc", "USDT", "60000000")
	q2 := quote("otc", "USDT", "60000000")
	a := order("otc", q1, uuid.NewString())
	b := order("otc", q2, uuid.NewString())
	var wg sync.WaitGroup
	for _, id := range []string{a.ID, b.ID} {
		wg.Add(1)
		go func(id string) { defer wg.Done(); _ = svc.Process(ctx, personal, id) }(id)
	}
	wg.Wait()
	states := map[string]int{get(a.ID).State: 1}
	states[get(b.ID).State]++
	if states["completed"] != 1 || states["rejected"] != 1 {
		t.Fatal(states)
	}
	wallet("USDT", "28520000")
	// Unknown payout keeps its hold. Confirmed failure releases once.
	q = quote("withdrawals", "USDT", "3000000")
	o = order("withdrawals", q, uuid.NewString())
	process(o, "pending_review")
	o = get(o.ID)
	fresh(true, "/approve", cryptofunds.Input{OrderID: o.ID, Revision: o.Revision, Note: "approve"})
	if e = svc.ResolveSimulation(ctx, personal, o.ID, "unknown"); e != nil {
		t.Fatal(e)
	}
	process(o, "unknown")
	wallet("USDT", "25020000")
	if e = svc.ResolveSimulation(ctx, personal, o.ID, "failed"); e != nil {
		t.Fatal(e)
	}
	process(o, "releasing")
	process(o, "failed")
	wallet("USDT", "28520000")
	// Audit failure after a remote step: replay must not double reserve/credit.
	q = quote("otc", "USDT", "1000000")
	o = order("otc", q, uuid.NewString())
	exec(`CREATE FUNCTION fail_crypto_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER fail_crypto_audit BEFORE INSERT ON crypto_audit FOR EACH ROW EXECUTE FUNCTION fail_crypto_audit()`)
	if e = svc.Process(ctx, personal, o.ID); e == nil {
		t.Fatal("audit failure accepted")
	}
	exec(`DROP TRIGGER fail_crypto_audit ON crypto_audit`)
	process(o, "completed")
	wallet("USDT", "27520000")
	// Partial quote/order writes cannot survive a failed audit.
	exec(`CREATE TRIGGER fail_crypto_audit BEFORE INSERT ON crypto_audit FOR EACH ROW EXECUTE FUNCTION fail_crypto_audit()`)
	call(false, "/otc/quotes", cryptofunds.Input{Currency: "USDT", Amount: "1000000"}, uuid.NewString(), 503)
	exec(`DROP TRIGGER fail_crypto_audit ON crypto_audit`)
	// Real-source webhook persistence remains observation-only, even for a known fixture address.
	source := &cryptofunds.Source{Service: svc, Connection: "observed", Project: "1", Key: "moventra-synthetic-cregis"}
	hook := source.Handler(http.NotFoundHandler())
	for i := 0; i < 10; i++ {
		r := httptest.NewRequest("POST", "/webhooks/cregis/deposit", strings.NewReader(string(callback)))
		w := httptest.NewRecorder()
		hook.ServeHTTP(w, r)
		if w.Code != 200 || w.Body.String() != "success" {
			t.Fatal(w.Code, w.Body)
		}
	}
	var events, deliveries int
	e = db.QueryRow(ctx, `SELECT count(*),sum(deliveries) FROM crypto_events WHERE connection_id='observed'`).Scan(&events, &deliveries)
	if e != nil || events != 1 || deliveries != 10 {
		t.Fatal(events, deliveries, e)
	}
	badCallback := strings.Replace(string(callback), `"amount":"100"`, `"amount":"101"`, 1)
	r := httptest.NewRequest("POST", "/webhooks/cregis/deposit", strings.NewReader(badCallback))
	w := httptest.NewRecorder()
	hook.ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatal("tampered callback", w.Code)
	}
	wallet("USDT", "27520000")
	snapshot, e := l.Snapshot(ctx, personal)
	if e != nil || snapshot.Reconciliation != "matched" {
		t.Fatal("reconciliation", snapshot.Reconciliation, e)
	}

	// Stop after the buy escrow credit but before source settlement. Bought funds
	// must remain unavailable and replay must reuse every original reference.
	q = quote("otc", "USDT", "1000000")
	o = order("otc", q, uuid.NewString())
	exec("CREATE FUNCTION fail_crypto_settle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.effect_key LIKE '%:sell-settle' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_crypto_settle BEFORE INSERT ON ledger_operations FOR EACH ROW EXECUTE FUNCTION fail_crypto_settle()")
	if err := svc.Process(ctx, personal, o.ID); err == nil {
		t.Fatal("partial settlement did not fail")
	}
	if got := get(o.ID); got.State != "processing" || got.Posting == "posted" {
		t.Fatal("premature success", got)
	}
	wallet("USDT", "26520000")
	wallet("USD", "6865")
	partial, err := l.Snapshot(ctx, personal)
	if err != nil {
		t.Fatal(err)
	}
	heldBuy := false
	for _, a := range partial.Accounts {
		if a.Currency == "USD" && a.Kind == "escrow" && a.HeldMinor == "98" {
			heldBuy = true
			if a.AvailableMinor != "0" {
				t.Fatal("buy escrow spendable")
			}
		}
	}
	if !heldBuy {
		t.Fatal("missing held buy credit")
	}
	exec("DROP TRIGGER fail_crypto_settle ON ledger_operations")
	process(o, "completed")
	process(o, "completed")
	wallet("USDT", "26520000")
	wallet("USD", "6963")
	for _, action := range []string{"cancel", "reject"} {
		q = quote("withdrawals", "USDT", "1000000")
		o = order("withdrawals", q, uuid.NewString())
		process(o, "pending_review")
		o = get(o.ID)
		fresh(action == "reject", "/"+action, cryptofunds.Input{OrderID: o.ID, Revision: o.Revision, Note: "fixture release"})
		want := "cancelled"
		if action == "reject" {
			want = "rejected"
		}
		process(o, want)
		wallet("USDT", "26520000")
	}
	// A durable callback failure must never return success.
	exec("CREATE TRIGGER fail_crypto_event BEFORE INSERT ON crypto_events FOR EACH ROW EXECUTE FUNCTION fail_crypto_audit()")
	r = httptest.NewRequest("POST", "/webhooks/cregis/deposit", strings.NewReader(string(callback)))
	w = httptest.NewRecorder()
	hook.ServeHTTP(w, r)
	if w.Code != 503 {
		t.Fatal("callback acknowledged before persistence", w.Code)
	}
	exec("DROP TRIGGER fail_crypto_event ON crypto_events")

	var eventID string
	if err := db.QueryRow(ctx, "SELECT id::text FROM crypto_events WHERE namespace=$1 AND connection_id='observed' LIMIT 1", svc.NS()).Scan(&eventID); err != nil {
		t.Fatal(err)
	}
	sourceGet := func(connection, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/admin-api/v1/crypto-sources/"+connection+"/events/"+eventID, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		srv.ServeHTTP(w, r)
		return w
	}
	if got := sourceGet("observed", "staff"); got.Code != 404 {
		t.Fatal("ungranted source", got.Code)
	}
	exec("INSERT INTO crypto_connection_grants(namespace,connection_id,user_id,permission) SELECT $1,'observed',id,'read' FROM users WHERE firebase_uid='staff'", svc.NS())
	if got := sourceGet("observed", "staff"); got.Code != 200 || !strings.Contains(got.Body.String(), "9007199254740993") {
		t.Fatal("source deep link", got.Code, got.Body)
	}
	if got := sourceGet("observed", "staff-no-mfa"); got.Code != 403 {
		t.Fatal("source MFA", got.Code)
	}
	if got := sourceGet("another", "staff"); got.Code != 404 {
		t.Fatal("source connection boundary", got.Code)
	}
	// Persisted page cursor survives client replacement and source failures.
	var requests int
	provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if requests == 2 {
			w.WriteHeader(503)
			return
		}
		page := 1
		if requests > 2 {
			page = 2
		}
		json.NewEncoder(w).Encode(map[string]any{"code": "00000", "data": map[string]any{"total": 101, "pageNum": page, "pageSize": 100, "rows": []any{map[string]any{"cid": 999, "pid": 1, "status": 1, "amount": "1", "currency": "USDT", "chain_id": "195", "token_id": contract}}}})
	}))
	defer provider.Close()
	originalTransport := http.DefaultTransport
	http.DefaultTransport = provider.Client().Transport
	defer func() { http.DefaultTransport = originalTransport }()
	newSource := func() *cryptofunds.Source {
		client, err := cregis.NewClient(provider.URL, "1", "fixture")
		if err != nil {
			t.Fatal(err)
		}
		return &cryptofunds.Source{Service: svc, Connection: "scan", Project: "1", Key: "fixture", Client: client}
	}
	scanner := newSource()
	if err := scanner.SyncPage(ctx); err != nil {
		t.Fatal(err)
	}
	if err := newSource().SyncPage(ctx); err != nil || requests != 1 {
		t.Fatal("persistent rate limit", requests, err)
	}
	exec("UPDATE crypto_sync SET next_attempt=now() WHERE connection_id='scan'")
	if err := newSource().SyncPage(ctx); err == nil {
		t.Fatal("upstream error ignored")
	}
	var cursor int
	var syncState string
	if err := db.QueryRow(ctx, "SELECT page,state FROM crypto_sync WHERE connection_id='scan'").Scan(&cursor, &syncState); err != nil || cursor != 2 || syncState != "error" {
		t.Fatal(cursor, syncState, err)
	}
	exec("UPDATE crypto_sync SET next_attempt=now() WHERE connection_id='scan'")
	if err := newSource().SyncPage(ctx); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, "SELECT page,state FROM crypto_sync WHERE connection_id='scan'").Scan(&cursor, &syncState); err != nil || cursor != 1 || syncState != "partial" {
		t.Fatal(cursor, syncState, err)
	}
	wallet("USDT", "26520000")
	t.Run("card wallet flows", func(t *testing.T) { testCardFunding(t, db, cryptoBlnk(t), personal) })
	t.Run("certified live adapter with isolated providers", func(t *testing.T) { testLiveFunding(t, db, cryptoBlnk(t), personal) })
	if os.Getenv("CRYPTO_BROWSER_PREVIEW") == "1" {
		preview := httptest.NewServer(srv)
		defer preview.Close()
		if err := os.WriteFile("/tmp/moventra-crypto-browser-api", []byte(preview.URL), 0600); err != nil {
			t.Fatal(err)
		}
		t.Log("isolated browser API ready")
		deadline := time.Now().Add(15 * time.Minute)
		for time.Now().Before(deadline) {
			if _, err := os.Stat("/tmp/moventra-crypto-browser-done"); err == nil {
				break
			}
			_, _ = svc.Drain(ctx)
			time.Sleep(250 * time.Millisecond)
		}
	}

}

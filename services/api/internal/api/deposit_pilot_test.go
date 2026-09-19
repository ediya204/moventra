package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/cryptofunds"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/depositaddress"
	"moventra.local/api/internal/ledger"
	"moventra.local/api/internal/manualfunds"
	"moventra.local/api/internal/tron"
)

type pilotVerifier struct{}

func (pilotVerifier) Verify(_ context.Context, hash, contract, address, amount string) (tron.Proof, error) {
	if hash == strings.Repeat("f", 64) {
		return tron.Proof{}, errors.New("not_final")
	}
	return tron.Proof{TransactionHash: hash, TransferIndex: "0", BlockNumber: "999", AmountMinor: amount, EvidenceRef: "fixture:solidified:" + hash}, nil
}
func TestDepositPilotCapDedupAndRecovery(t *testing.T) {
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
	schema := "pilot_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	exec(`UPDATE customers SET onboarding_status='approved',service_status='active' WHERE id=$1`, personal)
	ns := "live_" + schema
	address := tron.FixtureAddress("pilot")
	project := "fixture"
	token := depositaddress.Token
	l, e := ledger.NewLive(db, cryptoBlnk(t, true), ns, "general_ledger_id")
	if e != nil {
		t.Fatal(e)
	}
	s := &cryptofunds.Service{Ledger: l, Pilot: &cryptofunds.DepositPilot{Customer: personal, Address: address, Cap: "1000000", Evidence: "synthetic:test-authorization"}, Live: &cryptofunds.LiveRuntime{Connection: "cregis-waas", Project: project, Networks: map[string]cryptofunds.NetworkConfig{"TRC20": {Network: "TRC20", ChainID: "195", TokenID: token, Contract: token, Deposit: true, Verifier: pilotVerifier{}}}}}
	exec(`INSERT INTO crypto_addresses(namespace,connection_id,project_id,network,customer_id,address,mode) VALUES($1,'cregis-waas',$2,'TRC20',$3,$4,'live')`, ns, project, personal, address)
	exec(`INSERT INTO funds_address_jobs(namespace,customer_id,network,id,state,address) VALUES($1,$2,'TRC20',$3,'completed',$4)`, ns, personal, uuid.NewString(), address)
	if e = s.RunDepositPilotOnce(ctx); e == nil {
		t.Fatal("unprepared pilot enabled")
	}
	if e = s.PrepareDepositPilot(ctx); e != nil {
		t.Fatal(e)
	}
	add := func(hash, amount, addr, chain, asset, status string) {
		t.Helper()
		id := uuid.NewString()
		b, _ := json.Marshal(map[string]string{"txid": hash, "amount": amount, "address": addr, "chain_id": chain, "token_id": asset, "status": status})
		exec(`INSERT INTO crypto_events(id,namespace,connection_id,project_id,kind,external_id,digest,payload) VALUES($1::uuid,$2,'cregis-waas',$3,'deposit',$1::text,$1::text,$4)`, id, ns, project, b)
	}
	// Same economic transfer, different channel ids and concurrent workers.
	for i := 0; i < 8; i++ {
		add(strings.Repeat("a", 64), "0.6", address, "195", token, "1")
	}
	add(strings.Repeat("b", 64), "0.6", address, "195", token, "1")
	add(strings.Repeat("f", 64), "0.1", address, "195", token, "1")
	add(strings.Repeat("c", 64), "0.1", address, "1", token, "1")
	add(strings.Repeat("d", 64), "0.1", address, "195", "wrong-token", "1")
	add(strings.Repeat("e", 64), "0.1", tron.FixtureAddress("other"), "195", token, "1")
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if e := s.RunDepositPilotOnce(ctx); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	var count int
	if e = db.QueryRow(ctx, `SELECT count(*) FROM crypto_orders`).Scan(&count); e != nil || count != 1 {
		t.Fatalf("orders=%d err=%v", count, e)
	}
	status, e := s.DepositPilotStatus(ctx, personal)
	if e != nil || status.Wallet != "600000" || status.Remaining != "400000" || !status.Enabled {
		t.Fatal(status, e)
	}
	add(strings.Repeat("9", 64), "0.4", address, "195", token, "1")
	if e = s.RunDepositPilotOnce(ctx); e != nil {
		t.Fatal(e)
	}
	if e = s.RunDepositPilotOnce(ctx); e != nil {
		t.Fatal(e)
	}
	status, e = s.DepositPilotStatus(ctx, personal)
	if e != nil || status.Wallet != "1000000" || status.Remaining != "0" || status.Enabled {
		t.Fatal(status, e)
	}
	if e = db.QueryRow(ctx, `SELECT count(*) FROM ledger_journal`).Scan(&count); e != nil || count != 2 {
		t.Fatalf("journal=%d err=%v", count, e)
	}
	other, e := s.DepositPilotStatus(ctx, uuid.NewString())
	if e != nil || other.Cap != "" || other.Wallet != "" {
		t.Fatal("cross customer status", other, e)
	}
	// Production reads use the same formal ledger without granting execution.
	t.Setenv("FUNDS_DISPLAY_MODE", "production")
	handler := (&Server{DB: db, Verifier: fakeVerifier{}, DepositPilot: s}).Handler()
	check := func(method, path, token string, want int) string {
		t.Helper()
		r := httptest.NewRequest(method, path, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body)
		}
		return w.Body.String()
	}
	body := check("GET", "/client-api/v1/customers/"+personal+"/crypto", "alice", 200)
	var view struct {
		Data struct {
			Mode              string
			ExecutionEligible bool
			CanOperate        bool
			Ledger            ledger.Snapshot
		}
	}
	if json.Unmarshal([]byte(body), &view) != nil || view.Data.Mode != "live" || view.Data.ExecutionEligible || view.Data.CanOperate || view.Data.Ledger.Totals["USDT"] != "1000000" {
		t.Fatal("incorrect production view", body)
	}
	check("GET", "/client-api/v1/customers/"+personal+"/crypto", "bob", 404)
	check("POST", "/client-api/v1/customers/"+personal+"/crypto/withdrawals/orders", "alice", 503)
	check("GET", "/client-api/v1/customers/"+personal+"/test-wallet", "alice", 404)
	check("GET", "/client-api/v1/customers/"+personal+"/test-funds", "alice", 404)
	// A status replay after settlement must not reset/reseed the opening.
	if e = s.PrepareDepositPilot(ctx); e != nil {
		t.Fatal(e)
	}
	// A late preliminary callback must not hide an already posted order.
	var cid string
	if e = db.QueryRow(ctx, `SELECT external_id FROM crypto_events WHERE payload->>'txid'=$1 LIMIT 1`, strings.Repeat("9", 64)).Scan(&cid); e != nil {
		t.Fatal(e)
	}
	late := uuid.NewString()
	exec(`INSERT INTO crypto_events(id,namespace,connection_id,project_id,kind,external_id,digest,payload) SELECT $1::uuid,namespace,connection_id,project_id,kind,external_id,$1::text,jsonb_set(payload,'{status}','"0"') FROM crypto_events WHERE external_id=$2 LIMIT 1`, late, cid)
	ds := &depositaddress.Service{DB: db, Namespace: ns, Project: project}
	events, e := ds.Events(ctx, personal, 0, "")
	if e != nil {
		t.Fatal(e)
	}
	found := false
	for _, v := range events {
		if v.TxHash == strings.Repeat("9", 64) {
			found = v.Posting == "posted"
		}
	}
	if !found {
		t.Fatal("posted deposit not visible", events)
	}
	detail, e := ds.Events(ctx, personal, 0, late)
	if e != nil || len(detail) != 1 || detail[0].Posting != "posted" {
		t.Fatal("late event detail regressed", detail, e)
	}
	// Switch the verified live ledger to production without resetting its balance.
	s.Pilot = nil
	s.Production = &cryptofunds.ProductionRuntime{}
	var anchor string
	if e = db.QueryRow(ctx, `SELECT id::text FROM crypto_orders WHERE state='completed' LIMIT 1`).Scan(&anchor); e != nil {
		t.Fatal(e)
	}
	t.Setenv("FUNDS_PRODUCTION_EVIDENCE", anchor)
	if e = s.ConfigureProduction(ctx); e != nil {
		t.Fatal(e)
	}
	if e = s.RunProductionOnce(ctx); e != nil {
		t.Fatal(e)
	}
	// The previously capped 0.6 event now settles; a 2 USDT transfer is accepted.
	add(strings.Repeat("7", 64), "2", address, "195", token, "1")
	if e = s.RunProductionOnce(ctx); e != nil {
		t.Fatal(e)
	}
	snap, e := l.Snapshot(ctx, personal)
	if e != nil || snap.Totals["USDT"] != "3600000" {
		t.Fatal(snap, e)
	}
	if e = s.RunProductionOnce(ctx); e != nil {
		t.Fatal(e)
	}
	snap, e = l.Snapshot(ctx, personal)
	if e != nil || snap.Totals["USDT"] != "3600000" {
		t.Fatal("replayed production deposit", snap, e)
	}
	handler = (&Server{DB: db, Verifier: fakeVerifier{}, Directory: &fakeDirectory{}, ProductionFunds: s}).Handler()
	check("GET", "/client-api/v1/customers/"+personal+"/ledger", "alice", 200)
	check("GET", "/client-api/v1/customers/"+personal+"/ledger", "bob", 404)
	check("GET", "/admin-api/v1/crypto-sources", "staff", 200)
	check("GET", "/admin-api/v1/crypto-sources", "staff-no-mfa", 403)
	check("GET", "/admin-api/v1/balances?currency=USDT", "staff", 403)
	exec(`INSERT INTO manual_funds_grants(user_id,scope,permission) VALUES('00000000-0000-0000-0000-000000000003',$1,'read')`, personal)
	body = check("GET", "/admin-api/v1/balances/"+personal+"?currency=USDT", "staff", 200)
	if !strings.Contains(body, `"walletMinor":"3600000"`) || !strings.Contains(body, `"enabled":false`) || !strings.Contains(body, `"mode":"live"`) {
		t.Fatal(body)
	}
	check("GET", "/admin-api/v1/balances?currency=USDT", "staff-no-mfa", 403)
	check("GET", "/client-api/v1/customers/"+personal+"/crypto", "bob", 404)
	request := func(path string, in any, key string, want int) json.RawMessage {
		t.Helper()
		b, _ := json.Marshal(in)
		r := httptest.NewRequest("POST", "/client-api/v1/customers/"+personal+"/crypto/"+path, strings.NewReader(string(b)))
		r.Header.Set("Authorization", "Bearer alice")
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %d %s", path, w.Code, w.Body)
		}
		var out struct{ Data json.RawMessage }
		json.Unmarshal(w.Body.Bytes(), &out)
		return out.Data
	}
	for _, leg := range []struct{ currency, amount, receive string }{{"USDT", "1000000", "99"}, {"USD", "99", "980100"}} {
		raw := request("otc/quotes", map[string]string{"currency": leg.currency, "amountMinor": leg.amount}, uuid.NewString(), 200)
		var q cryptofunds.Quote
		if json.Unmarshal(raw, &q) != nil || q.Receive != leg.receive || q.Rate != "0.99" {
			t.Fatal(string(raw))
		}
		key := uuid.NewString()
		raw = request("otc/orders", map[string]string{"quoteId": q.ID}, key, 200)
		again := request("otc/orders", map[string]string{"quoteId": q.ID}, key, 200)
		var firstOrder, secondOrder cryptofunds.Order
		json.Unmarshal(raw, &firstOrder)
		json.Unmarshal(again, &secondOrder)
		if firstOrder.ID == "" || firstOrder.ID != secondOrder.ID {
			t.Fatal("duplicate OTC order")
		}
		if e = s.RunProductionOnce(ctx); e != nil {
			t.Fatal(e)
		}
	}
	snap, e = l.Snapshot(ctx, personal)
	if e != nil || snap.Totals["USDT"] != "3580100" || snap.Totals["USD"] != "0" {
		t.Fatal("production OTC legs", snap, e)
	}
	request("withdrawals/quotes", map[string]string{"currency": "USDT", "amountMinor": "1"}, uuid.NewString(), 409)
	request("cards/quotes", map[string]string{"currency": "USD", "amountMinor": "1"}, uuid.NewString(), 409)
	// Re-running activation must preserve subsequent admin terms and all balances.
	exec(`UPDATE crypto_settings SET data=jsonb_set(data,'{usdtToUsd}','"0.98"') WHERE namespace=$1`, ns)
	if e = s.ConfigureProduction(ctx); e != nil {
		t.Fatal(e)
	}
	var price string
	if e = db.QueryRow(ctx, `SELECT data->>'usdtToUsd' FROM crypto_settings WHERE namespace=$1`, ns).Scan(&price); e != nil || price != "0.98" {
		t.Fatal(price, e)
	}

	t.Run("manual funding production activation", func(t *testing.T) {
		app := &Server{DB: db, Verifier: fakeVerifier{}, ProductionFunds: s}
		handler = app.Handler()
		root := "/admin-api/v1/customers/" + personal + "/manual-funds"
		post := func(token, path string, body any, key string, want int) manualfunds.Order {
			t.Helper()
			raw, _ := json.Marshal(body)
			r := httptest.NewRequest("POST", root+path, strings.NewReader(string(raw)))
			r.Header.Set("Authorization", "Bearer "+token)
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Idempotency-Key", key)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != want {
				t.Fatalf("manual %s: %d %s", path, w.Code, w.Body)
			}
			var result struct{ Data manualfunds.Order }
			json.Unmarshal(w.Body.Bytes(), &result)
			return result.Data
		}
		exec(`INSERT INTO users(id,firebase_uid,display_name,role) VALUES('00000000-0000-0000-0000-000000000005','new-user','Reviewer','admin')`)
		exec(`INSERT INTO manual_funds_grants SELECT u,$1,p FROM unnest(ARRAY['00000000-0000-0000-0000-000000000003'::uuid,'00000000-0000-0000-0000-000000000005'::uuid]) u CROSS JOIN unnest(ARRAY['read','create','review','execute']) p ON CONFLICT DO NOTHING`, personal)
		input := map[string]any{"customerId": personal, "source": "platform_advance", "currency": "USD", "amountMinor": "10001", "note": "synthetic activation", "evidenceRef": "synthetic-production-manual"}
		key := uuid.NewString()
		t.Setenv("MANUAL_FUNDS_ENABLED", "true")
		t.Setenv("FUNDS_PRODUCTION_MODE", "prepare")
		post("staff", "/orders", input, key, 503)
		if app.CheckManualFunds(ctx) == nil {
			t.Fatal("prepare activated manual funding")
		}
		t.Setenv("FUNDS_PRODUCTION_MODE", "enabled")
		if err := app.CheckManualFunds(ctx); err != nil {
			t.Fatal(err)
		}
		var checksum string
		if err := db.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=16`).Scan(&checksum); err != nil {
			t.Fatal(err)
		}
		exec(`UPDATE schema_migrations SET checksum='invalid' WHERE version=16`)
		if app.CheckManualFunds(ctx) == nil {
			t.Fatal("invalid schema accepted")
		}
		exec(`UPDATE schema_migrations SET checksum=$1 WHERE version=16`, checksum)
		post("staff-no-mfa", "/orders", input, key, 403)
		order := post("staff", "/orders", input, key, 200)
		if again := post("staff", "/orders", input, key, 200); again.ID != order.ID {
			t.Fatal("duplicate order")
		}
		review := map[string]any{"revision": order.Revision, "note": "synthetic independent review"}
		post("staff", "/orders/"+order.ID+"/approve", review, uuid.NewString(), 403)
		post("new-user", "/orders/"+order.ID+"/approve", review, uuid.NewString(), 200)
		t.Setenv("MANUAL_FUNDS_ENABLED", "false")
		if app.drainManualFunds(ctx) == nil {
			t.Fatal("disabled worker ran")
		}
		t.Setenv("MANUAL_FUNDS_ENABLED", "true")
		if err := app.drainManualFunds(ctx); err != nil {
			t.Fatal(err)
		}
		if err := app.drainManualFunds(ctx); err != nil {
			t.Fatal(err)
		}
		tx, err := db.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		saved, err := app.manualService().Get(ctx, tx, personal, order.ID)
		tx.Rollback(ctx)
		if err != nil || saved.State != "completed" {
			t.Fatal(saved, err)
		}
		var legs int
		if err = db.QueryRow(ctx, `SELECT count(*) FROM ledger_journal j JOIN ledger_operations o ON o.id=j.operation_id WHERE o.namespace=$1 AND o.effect_key=$2`, ns, "manual:"+order.ID+":credit").Scan(&legs); err != nil || legs != 1 {
			t.Fatal("duplicate posting", legs, err)
		}
		s.Production = &cryptofunds.ProductionRuntime{}
		if app.manualService().Enabled() || app.drainManualFunds(ctx) == nil {
			t.Fatal("unhealthy production activated")
		}
		app.ProductionFunds = nil
		app.DepositPilot = s
		if app.manualService().Enabled() {
			t.Fatal("pilot activated manual funding")
		}
	})

}

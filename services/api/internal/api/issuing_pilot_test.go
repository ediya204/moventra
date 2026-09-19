package api

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/issuing"
	"moventra.local/api/internal/ledger"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestIssuingPilot(t *testing.T) {
	for _, scenario := range []string{"success", "unknown", "funding_failure", "creation_failure"} {
		t.Run(scenario, func(t *testing.T) { testIssuingPilot(t, scenario) })
	}
}
func testIssuingPilot(t *testing.T, scenario string) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("requires isolated PostgreSQL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	cfg, err := pgxpool.ParseConfig(raw)
	if err != nil || cfg.ConnConfig.Host != "/tmp" || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("unsafe test database")
	}
	base, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	schema := "issuing_funds_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = base.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer base.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	cfg.MaxConns = 2 // Production worker's configured pool size.
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(database.Migrate(ctx, db))
	_, err = db.Exec(ctx, seed)
	must(err)
	_, err = db.Exec(ctx, `UPDATE customers SET onboarding_status='approved',service_status='active' WHERE id=$1`, personal)
	must(err)
	_, err = db.Exec(ctx, `INSERT INTO issuing_customers(customer_id,enabled) VALUES($1,true)`, personal)
	must(err)
	_, err = db.Exec(ctx, `INSERT INTO channel_connections(id,account_ref,label) VALUES('issuing-test','acct','Fixture')`)
	must(err)
	_, err = db.Exec(ctx, `INSERT INTO project_wallets(project_key,connection_id,account_ref,virtual_account_ref,label,evidence_ref,actor_id) VALUES('moventra','issuing-test','acct','va','Fixture','synthetic','00000000-0000-0000-0000-000000000003')`)
	must(err)
	sid, pid := uuid.NewString(), uuid.NewString()
	_, err = db.Exec(ctx, `INSERT INTO issuing_suppliers(id,name,adapter,status,account_ref,entity_ref) VALUES($1,'Fixture','slash','active','acct','entity')`, sid)
	must(err)
	_, err = db.Exec(ctx, `INSERT INTO issuing_products(id,supplier_id,name,bin,network,upstream_id,status,fee_minor,minimum_minor) VALUES($1,$2,'Fixture','990001','visa','product','active',1000,2000)`, pid, sid)
	must(err)
	client := issuingBlnk(t)
	funds, err := ledger.New(db, client, "shadow_issuing_funds", "general_ledger_id")
	must(err)
	provider := &testIssuer{}
	svc := &issuing.Service{DB: db, Blnk: client, Funds: funds, Providers: map[string]issuing.Provider{sid: provider}, Enabled: true, Mode: "isolated"}
	wallet, err := funds.Provision(ctx, ledger.AccountSpec{CustomerID: personal, Key: "wallet-USD", Kind: "wallet", Currency: "USD"})
	must(err)
	clearing, err := funds.Provision(ctx, ledger.AccountSpec{CustomerID: personal, Key: "clearing-USD", Kind: "clearing", Currency: "USD"})
	must(err)
	op, err := funds.Submit(ctx, ledger.Command{CustomerID: personal, EffectKey: "synthetic-opening", Kind: "wallet_credit", SourceID: clearing.ID, DestinationID: wallet.ID, AmountMinor: "10000", EvidenceRef: "isolated-only"})
	must(err)
	_, err = funds.Process(ctx, personal, op.ID)
	must(err)
	transaction := func(fn func(pgx.Tx) error) {
		t.Helper()
		tx, e := db.Begin(ctx)
		must(e)
		defer tx.Rollback(ctx)
		must(fn(tx))
		must(tx.Commit(ctx))
	}

	p := &issuing.PilotAuthorization{CustomerID: personal, ProductID: pid, SupplierID: sid, OrderID: uuid.NewString(), BIN: "990001", FundsNamespace: funds.Namespace, FeeCapMinor: "1000", FundingMinor: "2000", TotalCapMinor: "3000", ExpiresAt: time.Now().Add(time.Hour), EvidenceRef: "synthetic-pilot-authorization", KeyEnv: "ISSUING_SLASH_KEY_TEST", Entity: "entity", Account: "acct"}
	if scenario == "unknown" {
		p.ExpiresAt = time.Now().Add(3 * time.Second)
	}
	svc.Pilot, svc.Mode = p, "pilot"
	const actor = "00000000-0000-0000-0000-000000000003"
	const owner = "00000000-0000-0000-0000-000000000001"
	expectBlocked := func(fn func(pgx.Tx) error) {
		t.Helper()
		tx, e := db.Begin(ctx)
		must(e)
		defer tx.Rollback(ctx)
		if e = fn(tx); e == nil {
			t.Fatal("unsafe pilot action accepted")
		}
	}
	expectBlocked(func(tx pgx.Tx) error { _, e := svc.Quote(ctx, tx, personal, pid, "2000"); return e })
	expectBlocked(func(tx pgx.Tx) error { return svc.ConfigurePilot(ctx, tx, owner) })
	_, err = db.Exec(ctx, `UPDATE issuing_suppliers SET status='paused',entity_ref='another_entity'; UPDATE issuing_customers SET enabled=false`)
	must(err)
	expectBlocked(func(tx pgx.Tx) error { return svc.ConfigurePilot(ctx, tx, actor) })
	_, err = db.Exec(ctx, `UPDATE issuing_suppliers SET entity_ref=''`)
	must(err)
	// Failed immutable audit must roll back eligibility and supplier activation.
	_, err = db.Exec(ctx, `CREATE FUNCTION reject_pilot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='pilot.authorize' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_pilot BEFORE INSERT ON issuing_audit FOR EACH ROW EXECUTE FUNCTION reject_pilot()`)
	must(err)
	expectBlocked(func(tx pgx.Tx) error { return svc.ConfigurePilot(ctx, tx, actor) })
	var enabled bool
	var supplierStatus string
	must(db.QueryRow(ctx, `SELECT enabled FROM issuing_customers WHERE customer_id=$1`, personal).Scan(&enabled))
	if enabled {
		t.Fatal("audit failed open")
	}
	must(db.QueryRow(ctx, `SELECT status FROM issuing_suppliers WHERE id=$1`, sid).Scan(&supplierStatus))
	if supplierStatus != "paused" {
		t.Fatal("supplier escaped rollback")
	}
	var entity string
	must(db.QueryRow(ctx, `SELECT entity_ref FROM issuing_suppliers WHERE id=$1`, sid).Scan(&entity))
	if entity != "" {
		t.Fatal("entity binding escaped rollback")
	}
	_, err = db.Exec(ctx, `DROP TRIGGER reject_pilot ON issuing_audit`)
	must(err)
	transaction(func(tx pgx.Tx) error { return svc.ConfigurePilot(ctx, tx, actor) })
	transaction(func(tx pgx.Tx) error { return svc.ConfigurePilot(ctx, tx, actor) })
	must(db.QueryRow(ctx, `SELECT entity_ref FROM issuing_suppliers WHERE id=$1`, sid).Scan(&entity))
	if entity != p.Entity {
		t.Fatal("reviewed entity not bound")
	}
	var auditCount int
	must(db.QueryRow(ctx, `SELECT count(*) FROM issuing_audit WHERE action='pilot.authorize'`).Scan(&auditCount))
	if auditCount != 1 {
		t.Fatal("authorization duplicated")
	}
	for _, funding := range []string{"1999", "2001", "3000", "999999999999999999"} {
		expectBlocked(func(tx pgx.Tx) error { _, e := svc.Quote(ctx, tx, personal, pid, funding); return e })
	}
	expectBlocked(func(tx pgx.Tx) error { _, e := svc.Quote(ctx, tx, other, pid, "2000"); return e })
	oldBin := p.BIN
	p.BIN = "990002"
	expectBlocked(func(tx pgx.Tx) error { _, e := svc.Quote(ctx, tx, personal, pid, "2000"); return e })
	p.BIN = oldBin
	oldID := p.OrderID
	p.OrderID = uuid.NewString()
	expectBlocked(func(tx pgx.Tx) error { return svc.ConfigurePilot(ctx, tx, actor) })
	p.OrderID = oldID
	expires := p.ExpiresAt
	p.ExpiresAt = time.Now().Add(-time.Hour)
	expectBlocked(func(tx pgx.Tx) error { _, e := svc.Quote(ctx, tx, personal, pid, "2000"); return e })
	p.ExpiresAt = expires
	_, err = db.Exec(ctx, `UPDATE issuing_products SET fee_minor=1001 WHERE id=$1`, pid)
	must(err)
	expectBlocked(func(tx pgx.Tx) error { _, e := svc.Quote(ctx, tx, personal, pid, "2000"); return e })
	_, err = db.Exec(ctx, `UPDATE issuing_products SET fee_minor=1000 WHERE id=$1`, pid)
	must(err)
	var q issuing.Quote
	transaction(func(tx pgx.Tx) error { var e error; q, e = svc.Quote(ctx, tx, personal, pid, "2000"); return e })
	if q.TotalMinor != "3000" || !strings.Contains(svc.Terms().Text, "不开放补充首充") {
		t.Fatal("pilot quote/terms incorrect")
	}
	request := issuing.Checkout{QuoteID: q.ID, TermsVersion: q.TermsVersion, LawfulUse: true, AcceptedTerms: true}
	// Distinct idempotency keys racing the same quote can consume only one slot.
	var wg sync.WaitGroup
	var mu sync.Mutex
	accepted := 0
	key := ""
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			tx, e := db.Begin(ctx)
			if e != nil {
				t.Error(e)
				return
			}
			defer tx.Rollback(ctx)
			k := uuid.NewString()
			_, e = svc.Checkout(ctx, tx, personal, owner, k, request)
			if e == nil {
				e = tx.Commit(ctx)
				if e != nil {
					t.Error(e)
					return
				}
				mu.Lock()
				accepted++
				key = k
				mu.Unlock()
			} else if !errors.Is(e, issuing.ErrBlocked) && !errors.Is(e, issuing.ErrConflict) {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	if accepted != 1 {
		t.Fatalf("accepted %d orders", accepted)
	}
	transaction(func(tx pgx.Tx) error { _, e := svc.Checkout(ctx, tx, personal, owner, key, request); return e })
	expectBlocked(func(tx pgx.Tx) error { _, e := svc.Quote(ctx, tx, personal, pid, "2000"); return e })
	// A different worker config or tampered order cannot reach either writer.
	oldCap := p.TotalCapMinor
	p.TotalCapMinor = "3001"
	if svc.Process(ctx, p.OrderID) != issuing.ErrBlocked {
		t.Fatal("worker accepted mismatched authorization")
	}
	p.TotalCapMinor = oldCap
	_, err = db.Exec(ctx, `UPDATE issuing_orders SET funding_minor=2001 WHERE id=$1`, p.OrderID)
	must(err)
	if svc.Process(ctx, p.OrderID) != issuing.ErrBlocked {
		t.Fatal("worker accepted excess funding")
	}
	_, err = db.Exec(ctx, `UPDATE issuing_orders SET funding_minor=2000 WHERE id=$1`, p.OrderID)
	must(err)
	// Expiry closes new requests but does not abandon accepted work.
	if scenario == "unknown" {
		time.Sleep(time.Until(p.ExpiresAt) + 20*time.Millisecond)
	}
	// Remote reserve committed before local audit rollback recovers exactly once.
	_, err = db.Exec(ctx, `CREATE FUNCTION reject_reserved_pilot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='order.reserved' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_reserved_pilot BEFORE INSERT ON issuing_audit FOR EACH ROW EXECUTE FUNCTION reject_reserved_pilot()`)
	must(err)
	if svc.Process(ctx, p.OrderID) == nil {
		t.Fatal("rollback not simulated")
	}
	_, err = db.Exec(ctx, `DROP TRIGGER reject_reserved_pilot ON issuing_audit`)
	must(err)
	restarted := *svc
	svc = &restarted
	if scenario == "unknown" {
		provider.unknown = true
	}
	if scenario == "funding_failure" {
		provider.rejectFunding = true
	}
	if scenario == "creation_failure" {
		_, err = db.Exec(ctx, `UPDATE issuing_suppliers SET status='paused' WHERE id=$1`, sid)
		must(err)
	}
	for i := 0; i < 12; i++ {
		must(svc.Process(ctx, p.OrderID))
	}
	wantState, wantBalance := "active", "7000"
	if scenario == "funding_failure" {
		wantState, wantBalance = "funding_failed", "9000"
	}
	if scenario == "creation_failure" {
		wantState, wantBalance = "failed", "10000"
	}
	var state string
	must(db.QueryRow(ctx, `SELECT state FROM issuing_orders WHERE id=$1`, p.OrderID).Scan(&state))
	if state != wantState {
		t.Fatalf("%s want %s", state, wantState)
	}
	transaction(func(tx pgx.Tx) error {
		balance, e := svc.Wallet(ctx, tx, personal)
		if e == nil && balance != wantBalance {
			t.Fatalf("balance %s want %s", balance, wantBalance)
		}
		return e
	})
	if scenario != "creation_failure" && provider.creates != 1 {
		t.Fatal("duplicate channel issuance", provider.creates)
	}
	expectBlocked(func(tx pgx.Tx) error {
		_, e := svc.Topup(ctx, tx, personal, p.OrderID, uuid.NewString(), "2000")
		return e
	})
	expectBlocked(func(tx pgx.Tx) error { _, e := svc.Quote(ctx, tx, personal, pid, "2000"); return e })
	if svc.SyncCard(ctx, p.OrderID) != issuing.ErrBlocked {
		t.Fatal("pilot expanded to settlement writer")
	}
	if scenario == "unknown" {
		expectBlocked(func(tx pgx.Tx) error { return svc.ConfigurePilot(ctx, tx, actor) })
	} else {
		transaction(func(tx pgx.Tx) error { return svc.ConfigurePilot(ctx, tx, actor) })
	}
	transaction(func(tx pgx.Tx) error { _, e := svc.Checkout(ctx, tx, personal, owner, key, request); return e })
	var count int
	must(db.QueryRow(ctx, `SELECT count(*) FROM issuing_orders`).Scan(&count))
	if count != 1 {
		t.Fatal("pilot reset")
	}
	_, err = db.Exec(ctx, `INSERT INTO issuing_grants(user_id,scope_id,permission) VALUES($1,$2,'customer:read')`, actor, personal)
	must(err)
	h := (&Server{DB: db, Verifier: issuingVerifier{}, Issuing: svc, Ledger: funds}).Handler()
	get := func(path, token string, want int) json.RawMessage {
		t.Helper()
		r := httptest.NewRequest(http.MethodGet, path, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("HTTP %d want %d: %s", w.Code, want, w.Body.String())
		}
		var data struct{ Data json.RawMessage }
		must(json.Unmarshal(w.Body.Bytes(), &data))
		return data.Data
	}
	path := "/v1/customers/" + personal + "/card-issuing/orders/" + p.OrderID
	if string(get("/client-api"+path, "alice", 200)) != string(get("/admin-api"+path, "staff", 200)) {
		t.Fatal("cross-surface mismatch")
	}
	get("/admin-api"+path, "staff-no-mfa", 403)
	get("/client-api/v1/customers/"+other+"/card-issuing/orders/"+p.OrderID, "alice", 404)
	view := get("/client-api/v1/customers/"+personal+"/card-issuing/wallet", "alice", 200)
	if !strings.Contains(string(view), `"mode":"pilot"`) || !strings.Contains(string(view), `"totalCapMinor":"3000"`) {
		t.Fatal("pilot mode not visible", string(view))
	}
}

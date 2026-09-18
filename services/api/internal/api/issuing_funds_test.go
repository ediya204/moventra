package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/issuing"
	"moventra.local/api/internal/ledger"
)

func TestIssuingUnifiedFunds(t *testing.T) {
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
	balance := func(want string) {
		t.Helper()
		transaction(func(tx pgx.Tx) error {
			got, e := svc.Wallet(ctx, tx, personal)
			if e == nil && got != want {
				t.Fatalf("wallet %s want %s", got, want)
			}
			return e
		})
	}
	orderID := func(v any) string {
		t.Helper()
		raw, e := json.Marshal(v)
		must(e)
		var o struct{ ID string }
		must(json.Unmarshal(raw, &o))
		return o.ID
	}
	create := func() string {
		t.Helper()
		var q issuing.Quote
		transaction(func(tx pgx.Tx) error { var e error; q, e = svc.Quote(ctx, tx, personal, pid, "2000"); return e })
		if q.TermsVersion != svc.Terms().Version || q.TermsVersion == issuing.CurrentTerms().Version {
			t.Fatal("wrong terms")
		}
		key := uuid.NewString()
		input := issuing.Checkout{QuoteID: q.ID, TermsVersion: q.TermsVersion, LawfulUse: true, AcceptedTerms: true}
		var id string
		for i := 0; i < 2; i++ {
			transaction(func(tx pgx.Tx) error {
				v, e := svc.Checkout(ctx, tx, personal, "00000000-0000-0000-0000-000000000001", key, input)
				if e != nil {
					return e
				}
				got := orderID(v)
				if id != "" && id != got {
					t.Fatal("duplicate order")
				}
				id = got
				return nil
			})
		}
		return id
	}
	state := func(id string) string {
		t.Helper()
		var v string
		must(db.QueryRow(ctx, `SELECT state FROM issuing_orders WHERE id=$1`, id).Scan(&v))
		return v
	}
	finish := func(id, want string) {
		t.Helper()
		for i := 0; i < 8 && state(id) != want; i++ {
			must(svc.Process(ctx, id))
		}
		if state(id) != want {
			t.Fatalf("state %s want %s", state(id), want)
		}
	}
	balance("10000")
	first := create()
	// Force issuing SQL rollback after the remote/shared ledger reservation commits.
	_, err = db.Exec(ctx, `CREATE FUNCTION reject_reserved() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='order.reserved' THEN RAISE EXCEPTION 'fixture rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_reserved BEFORE INSERT ON issuing_audit FOR EACH ROW EXECUTE FUNCTION reject_reserved()`)
	must(err)
	if svc.Process(ctx, first) == nil {
		t.Fatal("expected rollback")
	}
	if state(first) != "queued" {
		t.Fatal("state escaped rollback")
	}
	balance("7000")
	_, err = db.Exec(ctx, `DROP TRIGGER reject_reserved ON issuing_audit; UPDATE issuing_suppliers SET status='paused'`)
	must(err)
	must(svc.Process(ctx, first))
	if state(first) != "reserved" {
		t.Fatal("reservation not recovered")
	}
	finish(first, "failed")
	balance("10000")
	if provider.creates != 0 {
		t.Fatal("created while paused")
	}
	_, err = db.Exec(ctx, `UPDATE issuing_suppliers SET status='active'`)
	must(err)
	second := create()
	provider.unknown = true
	finish(second, "active")
	provider.unknown = false
	balance("7000")
	if provider.creates != 1 {
		t.Fatal("unknown result created duplicate")
	}
	transaction(func(tx pgx.Tx) error {
		v, e := svc.Cards(ctx, tx, personal, second, 0)
		if e != nil {
			return e
		}
		data := v.(map[string]any)
		if data["balanceMinor"] != "2000" {
			t.Fatal("card subaccount missing", data)
		}
		return nil
	})
	// An id owned by another customer cannot read card or balance details.
	transaction(func(tx pgx.Tx) error {
		_, e := svc.Cards(ctx, tx, other, second, 0)
		if !errors.Is(e, issuing.ErrNotFound) {
			t.Fatal("cross-customer card", e)
		}
		return nil
	})
	third := create()
	provider.rejectFunding = true
	finish(third, "funding_failed")
	provider.rejectFunding = false
	balance("6000")
	// Only first funding is retried on the original card; no second opening fee.
	var topup string
	transaction(func(tx pgx.Tx) error {
		v, e := svc.Topup(ctx, tx, personal, third, uuid.NewString(), "2000")
		if e == nil {
			topup = orderID(v)
		}
		return e
	})
	finish(topup, "active")
	balance("4000")
	if provider.creates != 2 {
		t.Fatal("topup created another card")
	}
	fourth := create()
	finish(fourth, "active")
	balance("1000")
	// No order can be submitted against insufficient shared funds.
	transaction(func(tx pgx.Tx) error {
		q, e := svc.Quote(ctx, tx, personal, pid, "2000")
		if e != nil {
			return e
		}
		_, e = svc.Checkout(ctx, tx, personal, "00000000-0000-0000-0000-000000000001", uuid.NewString(), issuing.Checkout{QuoteID: q.ID, TermsVersion: q.TermsVersion, LawfulUse: true, AcceptedTerms: true})
		if !errors.Is(e, issuing.ErrInsufficient) {
			t.Fatal("insufficient funds accepted", e)
		}
		return nil
	})
	if svc.ProcessDeposit(ctx, uuid.NewString()) != issuing.ErrBlocked {
		t.Fatal("legacy deposit allowed")
	}
	snap, err := funds.Snapshot(ctx, personal)
	must(err)
	if snap.Reconciliation != "matched" || snap.PendingOperations != 0 {
		t.Fatal("ledger mismatch", snap)
	}
	var count int
	must(db.QueryRow(ctx, `SELECT count(*) FROM issuing_balances`).Scan(&count))
	if count != 0 {
		t.Fatal("created second wallet")
	}

	// Both UIs read the same order; source card ownership enters the existing view.
	_, err = db.Exec(ctx, `INSERT INTO issuing_grants(user_id,scope_id,permission) VALUES('00000000-0000-0000-0000-000000000003',$1,'customer:read')`, personal)
	must(err)
	handler := (&Server{DB: db, Verifier: issuingVerifier{}, Issuing: svc, Ledger: funds}).Handler()
	get := func(path, token string, want int) json.RawMessage {
		t.Helper()
		r := httptest.NewRequest(http.MethodGet, path, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("GET %s %d: %s", path, w.Code, w.Body.String())
		}
		var v struct{ Data json.RawMessage }
		must(json.Unmarshal(w.Body.Bytes(), &v))
		return v.Data
	}
	customerBase := "/client-api/v1/customers/" + personal
	clientOrder := get(customerBase+"/card-issuing/orders/"+second, "alice", 200)
	adminOrder := get("/admin-api/v1/customers/"+personal+"/card-issuing/orders/"+second, "staff", 200)
	if string(clientOrder) != string(adminOrder) {
		t.Fatal("different order across surfaces")
	}
	get("/admin-api/v1/customers/"+personal+"/card-issuing/orders/"+second, "staff-no-mfa", 403)
	detail := get(customerBase+"/card-projections/issuing-test/cards/card_"+second, "alice", 200)
	if !strings.Contains(string(detail), `"issuingOrderId":"`+second+`"`) || !strings.Contains(string(detail), `"fundingCardId":"`) {
		t.Fatal("new card not linked to common detail", string(detail))
	}
	get("/client-api/v1/customers/"+other+"/card-projections/issuing-test/cards/card_"+second, "alice", 404)
	var links, accounts int
	must(db.QueryRow(ctx, `SELECT (SELECT count(*) FROM issuing_card_projections),(SELECT count(*) FROM ledger_accounts WHERE kind='card')`).Scan(&links, &accounts))
	if links != 3 || accounts != 3 {
		t.Fatal("duplicate card/subaccount", links, accounts)
	}
	// An import containing the same card replaces the overlay exactly once.
	_, err = db.Exec(ctx, `INSERT INTO channel_records(connection_id,revision,kind,external_id,data) SELECT connection_id,(SELECT revision FROM channel_connections WHERE id='issuing-test'),kind,external_id,data FROM channel_records WHERE external_id=$1 LIMIT 1 ON CONFLICT DO NOTHING`, "card_"+third)
	must(err)
	must(db.QueryRow(ctx, `SELECT count(*) FROM channel_current_records WHERE connection_id='issuing-test' AND revision=(SELECT revision FROM channel_connections WHERE id='issuing-test') AND external_id=$1`, "card_"+third).Scan(&count))
	if count != 1 {
		t.Fatal("duplicate after source import")
	}
	// Competing OTC-style wallet reservation and issuing cannot spend the same USD.
	credit, err := funds.Submit(ctx, ledger.Command{CustomerID: personal, EffectKey: "synthetic-more", Kind: "wallet_credit", SourceID: clearing.ID, DestinationID: wallet.ID, AmountMinor: "2000", EvidenceRef: "isolated-only"})
	must(err)
	_, err = funds.Process(ctx, personal, credit.ID)
	must(err)
	concurrent := create()
	escrow, err := funds.Provision(ctx, ledger.AccountSpec{CustomerID: personal, Key: "crypto-hold:competing", Kind: "escrow", Currency: "USD"})
	must(err)
	debit, err := funds.Submit(ctx, ledger.Command{CustomerID: personal, EffectKey: "crypto:competing:reserve", Kind: "crypto_move", SourceID: wallet.ID, DestinationID: escrow.ID, AmountMinor: "3000", EvidenceRef: "isolated-otc"})
	must(err)
	var wg sync.WaitGroup
	wg.Add(2)
	var issuingErr, errorOTC error
	var resultOTC ledger.Operation
	go func() { defer wg.Done(); issuingErr = svc.Process(ctx, concurrent) }()
	go func() { defer wg.Done(); resultOTC, errorOTC = funds.Process(ctx, personal, debit.ID) }()
	wg.Wait()
	must(issuingErr)
	if state(concurrent) == "reserved" {
		if resultOTC.State != "rejected" {
			t.Fatal("both reservations succeeded", errorOTC, resultOTC.State)
		}
	} else if state(concurrent) != "failed" || resultOTC.State != "applied" {
		t.Fatal("invalid concurrent outcome", state(concurrent), resultOTC.State, errorOTC)
	}
	balance("0")
	// Switching configuration cannot redirect persisted orders to a different ledger.
	otherFunds, err := ledger.New(db, client, "shadow_different", "general_ledger_id")
	must(err)
	svc.Funds = otherFunds
	if svc.Process(ctx, second) != issuing.ErrBlocked {
		t.Fatal("namespace switch accepted")
	}
}

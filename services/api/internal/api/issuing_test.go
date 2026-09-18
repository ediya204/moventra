package api

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"math/big"
	"moventra.local/api/internal/blnk"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/issuing"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

type issuingVerifier struct{}

func (issuingVerifier) Verify(ctx context.Context, t string) (Identity, error) {
	if t == "staff2" {
		return Identity{UID: t, MFA: true}, nil
	}
	return fakeVerifier{}.Verify(ctx, t)
}

type testIssuer struct {
	mu            sync.Mutex
	creates       int
	unknown       bool
	rejectFunding bool
	transactions  []issuing.SourceTransaction
}

func (p *testIssuer) Create(_ context.Context, id string, _ issuing.Snapshot) (issuing.Card, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.creates++
	if p.unknown {
		return issuing.Card{}, issuing.ErrUnknown
	}
	return issuing.Card{ID: "card_" + id, Last4: "1234", Restricted: true}, nil
}
func (p *testIssuer) Find(_ context.Context, id string, _ issuing.Snapshot) (issuing.Card, error) {
	return issuing.Card{ID: "card_" + id, Last4: "1234", Restricted: true}, nil
}
func (p *testIssuer) Enable(context.Context, issuing.Card, issuing.Snapshot, string) error {
	if p.rejectFunding {
		return issuing.ErrRejected
	}
	return nil
}

func (p *testIssuer) Transactions(context.Context, string, string) ([]issuing.SourceTransaction, string, error) {
	return p.transactions, "", nil
}

// Stateful HTTP Blnk fixture verifies exact balances/references through the real adapter.
func issuingBlnk(t *testing.T) *blnk.Client {
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
	indicators := map[string]string{}
	transfers := map[string]map[string]any{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		reply := func(v any) { w.Header().Set("Content-Type", "application/json"); json.NewEncoder(w).Encode(v) }
		balance := func(id, indicator string) {
			reply(map[string]any{"balance_id": id, "ledger_id": "general_ledger_id", "indicator": indicator, "currency": "USD", "balance": balances[id], "inflight_debit_balance": 0})
		}
		switch {
		case r.Method == "POST" && r.URL.Path == "/balances":
			var v map[string]any
			json.NewDecoder(r.Body).Decode(&v)
			indicator := v["indicator"].(string)
			id := "bln_" + strings.TrimPrefix(indicator, "@")
			balances[id] = big.NewInt(0)
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
func TestIssuingFullFlow(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("requires isolated PostgreSQL")
	}
	ctx := context.Background()
	cfg, e := pgxpool.ParseConfig(raw)
	if e != nil || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") || cfg.ConnConfig.Host != "/tmp" {
		t.Fatal("unsafe test database")
	}
	base, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer base.Close()
	schema := "issuing_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = base.Exec(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer base.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	cfg.MaxConns = 8
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
	_, e = db.Exec(ctx, `INSERT INTO users(id,firebase_uid,display_name,status,role) VALUES('00000000-0000-0000-0000-000000000005','staff2','Reviewer','active','admin')`)
	if e != nil {
		t.Fatal(e)
	}
	_, e = db.Exec(ctx, `UPDATE customers SET onboarding_status='approved',service_status='active' WHERE id=$1`, personal)
	if e != nil {
		t.Fatal(e)
	}
	_, e = db.Exec(ctx, `INSERT INTO issuing_grants(user_id,scope_id,permission) SELECT '00000000-0000-0000-0000-000000000003',scope,permission FROM (VALUES('catalog','catalog:read'),('catalog','catalog:write'),('catalog','pricing:write'),($1,'customer:read'),($1,'customer:write'),($1,'funding:submit'),($1,'funding:review'),($1,'recovery:write')) v(scope,permission);`, personal)
	if e != nil {
		t.Fatal(e)
	}
	_, e = db.Exec(ctx, `INSERT INTO issuing_grants VALUES('00000000-0000-0000-0000-000000000005',$1,'funding:review')`, personal)
	if e != nil {
		t.Fatal(e)
	}
	provider := &testIssuer{}
	svc := &issuing.Service{DB: db, Blnk: issuingBlnk(t), Enabled: true, Providers: map[string]issuing.Provider{}}
	handler := (&Server{DB: db, Verifier: issuingVerifier{}, Issuing: svc}).Handler()
	request := func(method, path, token string, body any, key string, want int) json.RawMessage {
		t.Helper()
		var input io.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			input = strings.NewReader(string(b))
		}
		r := httptest.NewRequest(method, path, input)
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		var p struct {
			Data json.RawMessage `json:"data"`
		}
		json.Unmarshal(w.Body.Bytes(), &p)
		return p.Data
	}
	getID := func(b json.RawMessage) string {
		var v struct {
			ID string `json:"id"`
		}
		if e := json.Unmarshal(b, &v); e != nil {
			t.Fatal(e)
		}
		return v.ID
	}
	a := "/admin-api/v1/card-issuing"
	c := "/client-api/v1/customers/" + personal + "/card-issuing"
	ac := "/admin-api/v1/customers/" + personal + "/card-issuing"
	request("GET", a+"/products", "alice", nil, "", 403)
	request("GET", a+"/products", "staff-no-mfa", nil, "", 403)
	request("GET", a+"/products", "staff2", nil, "", 404)
	request("GET", strings.Replace(c, personal, other, 1)+"/orders", "alice", nil, "", 404)
	supplier := issuing.Supplier{Name: "Slash test", Adapter: "slash", Status: "active", AccountRef: "acct", EntityRef: "entity"}
	sid := getID(request("POST", a+"/suppliers", "staff", supplier, "", 200))
	supplier.ID = sid
	supplier.Revision = 1
	svc.Providers[sid] = provider
	p := issuing.Product{SupplierID: sid, Name: "Test BIN", BIN: "990001", Network: "visa", UpstreamID: "product", Status: "active", FeeMinor: "500", MinimumMinor: "1000"}
	pid := getID(request("POST", a+"/products", "staff", p, "", 200))
	p.ID = pid
	p.Revision = 1
	second := supplier
	second.ID = ""
	second.Name = "Other supplier"
	second.Adapter = "manual"
	otherSupplier := getID(request("POST", a+"/suppliers", "staff", second, "", 200))
	p2 := p
	p2.ID = ""
	p2.SupplierID = otherSupplier
	request("POST", a+"/products", "staff", p2, "", 200)
	gid := getID(request("POST", a+"/groups", "staff", map[string]any{"id": "", "name": "Tier A", "revision": 0}, "", 200))
	request("POST", ac+"/enrollment", "staff", issuing.Enrollment{CustomerID: personal, GroupID: gid, Enabled: true}, "", 200)
	enrollment := request("GET", ac+"/enrollment", "staff", nil, "", 200)
	if strings.Contains(string(enrollment), "cardholder") {
		t.Fatal("holder exposed in enrollment")
	}
	price := "300"
	request("POST", a+"/prices", "staff", issuing.Price{ProductID: pid, ScopeKind: "group", ScopeID: gid, FeeMinor: &price, Revision: 1}, "", 200)
	quote := func(funding string, want int) json.RawMessage {
		return request("POST", c+"/quotes", "alice", map[string]string{"productId": pid, "fundingMinor": funding}, "", want)
	}
	quote("999", 400)
	qraw := quote("1000", 200)
	var q issuing.Quote
	json.Unmarshal(qraw, &q)
	if q.FeeMinor != "300" || q.PriceSource != "group" {
		t.Fatal(string(qraw))
	}
	free := "0"
	request("POST", a+"/prices", "staff", issuing.Price{ProductID: pid, ScopeKind: "customer", ScopeID: personal, FeeMinor: &free, Revision: 2}, "", 200)
	request("POST", c+"/orders", "alice", map[string]string{"quoteId": q.ID}, uuid.NewString(), 409)
	qraw = quote("1000", 200)
	json.Unmarshal(qraw, &q)
	if q.FeeMinor != "0" || q.PriceSource != "customer" {
		t.Fatal(string(qraw))
	}
	request("POST", a+"/prices", "staff", issuing.Price{ProductID: pid, ScopeKind: "customer", ScopeID: personal, FeeMinor: nil, Revision: 3}, "", 200)
	depositID := getID(request("POST", ac+"/deposits", "staff", map[string]string{"amountMinor": "10000", "evidenceRef": "synthetic-deposit-1"}, "", 200))
	request("POST", ac+"/deposit-reviews/"+depositID, "staff", map[string]any{"revision": 1, "approve": true}, "", 409)
	request("POST", ac+"/deposit-reviews/"+depositID, "staff2", map[string]any{"revision": 1, "approve": true}, "", 200)
	if e = svc.ProcessDeposit(ctx, depositID); e != nil {
		t.Fatal(e)
	}
	if e = svc.ProcessDeposit(ctx, depositID); e != nil {
		t.Fatal(e)
	}
	qraw = quote("1000", 200)
	json.Unmarshal(qraw, &q)
	key := uuid.NewString()
	oid := getID(request("POST", c+"/orders", "alice", map[string]string{"quoteId": q.ID}, key, 200))
	if getID(request("POST", c+"/orders", "alice", map[string]string{"quoteId": q.ID}, key, 200)) != oid {
		t.Fatal("idempotency")
	}
	request("POST", c+"/orders", "alice", map[string]string{"quoteId": q.ID}, uuid.NewString(), 409)
	var named, retryNamed issuing.Order
	json.Unmarshal(request("GET", c+"/orders/"+oid, "alice", nil, "", 200), &named)
	json.Unmarshal(request("POST", c+"/orders", "alice", map[string]string{"quoteId": q.ID}, key, 200), &retryNamed)
	if named.CardName == "" || named.CardName != retryNamed.CardName {
		t.Fatal("card name changed on retry")
	}
	var frozen issuing.Snapshot
	var frozenRaw []byte
	if e = db.QueryRow(ctx, `SELECT snapshot FROM issuing_orders WHERE id=$1`, oid).Scan(&frozenRaw); e != nil {
		t.Fatal(e)
	}
	json.Unmarshal(frozenRaw, &frozen)
	if frozen.CardName != named.CardName || frozen.CardholderRef != "" {
		t.Fatal("name/holder snapshot mismatch")
	}
	provider.unknown = true
	for i := 0; i < 7; i++ {
		if e = svc.Process(ctx, oid); e != nil {
			t.Fatalf("step %d: %v", i, e)
		}
	}
	if provider.creates != 1 {
		t.Fatal("duplicate issuance", provider.creates)
	}
	var o issuing.Order
	json.Unmarshal(request("GET", c+"/orders/"+oid, "alice", nil, "", 200), &o)
	if o.State != "active" {
		t.Fatal(o.State)
	}
	var wallet struct {
		Available string `json:"availableMinor"`
	}
	json.Unmarshal(request("GET", c+"/wallet", "alice", nil, "", 200), &wallet)
	if wallet.Available != "8700" {
		t.Fatal(wallet.Available)
	}
	// Funding rejection charges the fee once, then original-card topup charges zero fee.
	provider.unknown = false
	provider.rejectFunding = true
	qraw = quote("1000", 200)
	json.Unmarshal(qraw, &q)
	oid2 := getID(request("POST", c+"/orders", "alice", map[string]string{"quoteId": q.ID}, uuid.NewString(), 200))
	for i := 0; i < 6; i++ {
		if e = svc.Process(ctx, oid2); e != nil {
			t.Fatal(e)
		}
	}
	json.Unmarshal(request("GET", c+"/orders/"+oid2, "alice", nil, "", 200), &o)
	if o.State != "funding_failed" {
		t.Fatal(o.State)
	}
	json.Unmarshal(request("GET", c+"/wallet", "alice", nil, "", 200), &wallet)
	if wallet.Available != "8400" {
		t.Fatal(wallet.Available)
	}
	provider.rejectFunding = false
	topup := getID(request("POST", c+"/topups", "alice", map[string]string{"orderId": oid2, "fundingMinor": "1000"}, uuid.NewString(), 200))
	var topupOrder issuing.Order
	json.Unmarshal(request("GET", c+"/orders/"+topup, "alice", nil, "", 200), &topupOrder)
	if o.CardName == "" || topupOrder.CardName != o.CardName {
		t.Fatal("topup renamed card")
	}
	for i := 0; i < 5; i++ {
		if e = svc.Process(ctx, topup); e != nil {
			t.Fatal(e)
		}
	}
	if provider.creates != 2 {
		t.Fatal("topup created card")
	}
	json.Unmarshal(request("GET", c+"/wallet", "alice", nil, "", 200), &wallet)
	if wallet.Available != "7400" {
		t.Fatal(wallet.Available)
	}
	// Source facts are replayable; authorization is not a second posted debit.
	provider.transactions = []issuing.SourceTransaction{
		{ID: "purchase", CardID: "card_" + oid, AccountID: "acct", Status: "posted", DetailedStatus: "settled", Amount: json.Number("-100")},
		{ID: "refund", CardID: "card_" + oid, AccountID: "acct", Status: "posted", DetailedStatus: "refund", Amount: json.Number("40")},
		{ID: "authorization", CardID: "card_" + oid, AccountID: "acct", Status: "pending", DetailedStatus: "pending", Amount: json.Number("-500")},
	}
	if e = svc.SyncCard(ctx, oid); e != nil {
		t.Fatal(e)
	}
	_, e = db.Exec(ctx, `UPDATE issuing_sync SET next_attempt_at=now()-interval '1 second' WHERE order_id=$1`, oid)
	if e != nil {
		t.Fatal(e)
	}
	if e = svc.SyncCard(ctx, oid); e != nil {
		t.Fatal(e)
	}
	var net string
	e = db.QueryRow(ctx, `SELECT COALESCE(sum(CASE WHEN destination_id=b.blnk_id THEN amount_minor ELSE -amount_minor END),0)::text FROM issuing_journal j JOIN issuing_balances b ON (j.source_id=b.blnk_id OR j.destination_id=b.blnk_id) WHERE b.customer_id=$1 AND b.account_key=$2`, personal, "card_"+oid).Scan(&net)
	if e != nil || net != "940" {
		t.Fatal("posted facts duplicated", net, e)
	}
	provider.transactions[0].Amount = json.Number("-200")
	_, e = db.Exec(ctx, `UPDATE issuing_sync SET next_attempt_at=now()-interval '1 second' WHERE order_id=$1`, oid)
	if e != nil {
		t.Fatal(e)
	}
	if e = svc.SyncCard(ctx, oid); e != nil {
		t.Fatal(e)
	}
	var reviews int
	e = db.QueryRow(ctx, `SELECT count(*) FROM issuing_postings WHERE state='review_required'`).Scan(&reviews)
	if e != nil || reviews != 1 {
		t.Fatal("correction not isolated", reviews, e)
	}
	request("GET", ac+"/reconciliation", "staff", nil, "", 200)
	// Concurrent orders may queue, but only one may reserve the remaining wallet.
	concurrentIDs := []string{}
	for i := 0; i < 2; i++ {
		qraw = quote("6000", 200)
		json.Unmarshal(qraw, &q)
		concurrentIDs = append(concurrentIDs, getID(request("POST", c+"/orders", "alice", map[string]string{"quoteId": q.ID}, uuid.NewString(), 200)))
	}
	var wg sync.WaitGroup
	for _, id := range concurrentIDs {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			if err := svc.Process(ctx, id); err != nil {
				t.Error(err)
			}
		}(id)
	}
	wg.Wait()
	var reserved, failed int
	e = db.QueryRow(ctx, `SELECT count(*) FILTER(WHERE state='reserved'),count(*) FILTER(WHERE state='failed') FROM issuing_orders WHERE id=ANY($1::uuid[])`, concurrentIDs).Scan(&reserved, &failed)
	if e != nil || reserved != 1 || failed != 1 {
		t.Fatal("overspending", reserved, failed, e)
	}
	// Crash after Blnk reserve but before local state commits: recover, even if paused meanwhile.
	qraw = quote("1000", 200)
	json.Unmarshal(qraw, &q)
	crashQuoteID := q.ID
	crashID := ""
	// The concurrent reserved order currently holds 6300, so release it first via explicit pause below;
	// use a separate injected rollback once funds become available.
	// Pause stops quotes while preserving existing cards; mutation route confusion is rejected.
	p.Revision = 4
	p.Status = "paused"
	request("POST", a+"/products/"+pid, "staff", p, "", 200)
	quote("1000", 409)
	for _, id := range concurrentIDs {
		for i := 0; i < 2; i++ {
			if err := svc.Process(ctx, id); err != nil {
				t.Fatal(err)
			}
		}
	}
	// Temporarily restore product, reserve the queued crash case with a failing local commit.
	p.Revision = 5
	p.Status = "active"
	request("POST", a+"/products/"+pid, "staff", p, "", 200)
	qraw = quote("1000", 200)
	json.Unmarshal(qraw, &q)
	crashQuoteID = q.ID
	crashID = getID(request("POST", c+"/orders", "alice", map[string]string{"quoteId": crashQuoteID}, uuid.NewString(), 200))
	_, e = db.Exec(ctx, `CREATE FUNCTION reject_reserve_state() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='reserved' THEN RAISE EXCEPTION 'simulated local crash'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_reserve BEFORE UPDATE ON issuing_orders FOR EACH ROW EXECUTE FUNCTION reject_reserve_state()`)
	if e != nil {
		t.Fatal(e)
	}
	if e = svc.Process(ctx, crashID); e == nil {
		t.Fatal("rollback injection did not fire")
	}
	_, e = db.Exec(ctx, `DROP TRIGGER reject_reserve ON issuing_orders`)
	if e != nil {
		t.Fatal(e)
	}
	p.Revision = 6
	p.Status = "paused"
	request("POST", a+"/products/"+pid, "staff", p, "", 200)
	for i := 0; i < 3; i++ {
		if e = svc.Process(ctx, crashID); e != nil {
			t.Fatal(e)
		}
	}
	json.Unmarshal(request("GET", c+"/wallet", "alice", nil, "", 200), &wallet)
	if wallet.Available != "7400" {
		t.Fatal("lost reserve was not recovered and released", wallet.Available)
	}
	request("POST", ac+"/products", "staff", p, "", 404)
	request("POST", c+"/deposits", "alice", map[string]any{}, "", 404)
	request("GET", c+"/enrollment", "alice", nil, "", 404)
	// Source catalog import preserves unconfigured values, commercial edits and identity.
	input := issuing.CatalogImport{ActorID: "00000000-0000-0000-0000-000000000003", SupplierID: uuid.NewString(), SupplierName: "Slash trial catalog", EvidenceRef: "fixture:catalog-complete", CollectedAt: time.Now().UTC(), Complete: true, Items: []issuing.CatalogSourceItem{{ID: "card_product_catalog", Prefix: "43612080", Status: "active"}}}
	if n, e := issuing.ImportCatalog(ctx, db, input); e != nil || n != 1 {
		t.Fatal("initial source import", n, e)
	}
	if n, e := issuing.ImportCatalog(ctx, db, input); e != nil || n != 0 {
		t.Fatal("idempotent source import", n, e)
	}
	var draftID string
	var isDraft bool
	if e = db.QueryRow(ctx, `SELECT id::text,status='draft' AND fee_minor IS NULL AND minimum_minor IS NULL AND network='' FROM issuing_products WHERE supplier_id=$1`, input.SupplierID).Scan(&draftID, &isDraft); e != nil || !isDraft {
		t.Fatal("draft invented configuration", e)
	}
	var detail struct {
		Product issuing.Product `json:"product"`
	}
	json.Unmarshal(request("GET", a+"/products/"+draftID, "staff", nil, "", 200), &detail)
	detail.Product.Status = "active"
	request("POST", a+"/products/"+draftID, "staff", detail.Product, "", 400)
	detail.Product.Status = "draft"
	detail.Product.FeeMinor = "0"
	detail.Product.MinimumMinor = "150"
	detail.Product.Network = "visa"
	request("POST", a+"/products/"+draftID, "staff", detail.Product, "", 200)
	input.Items[0].Status = "inactive"
	input.CollectedAt = input.CollectedAt.Add(time.Second)
	if _, e = issuing.ImportCatalog(ctx, db, input); e != nil {
		t.Fatal(e)
	}
	var preserved bool
	db.QueryRow(ctx, `SELECT fee_minor=0 AND minimum_minor=150 AND network='visa' AND status='draft' FROM issuing_products WHERE id=$1`, draftID).Scan(&preserved)
	if !preserved {
		t.Fatal("sync overwrote commercial configuration")
	}
	input.Items[0].Prefix = "40041641"
	if _, e = issuing.ImportCatalog(ctx, db, input); e != issuing.ErrConflict {
		t.Fatal("source mapping silently rebound", e)
	}
	input.Items[0].Prefix = "43612080"
	input.Complete = false
	if _, e = issuing.ImportCatalog(ctx, db, input); e != issuing.ErrInvalid {
		t.Fatal("partial import accepted", e)
	}
	input.Complete = true
	input.ActorID = "00000000-0000-0000-0000-000000000005"
	if _, e = issuing.ImportCatalog(ctx, db, input); e != issuing.ErrForbidden {
		t.Fatal("import without catalog grant", e)
	}
	// Auditing is fail-closed, including reads and configuration writes.
	_, e = db.Exec(ctx, `CREATE FUNCTION reject_issuing_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test'; END $$; CREATE TRIGGER reject_audit BEFORE INSERT ON issuing_audit FOR EACH ROW EXECUTE FUNCTION reject_issuing_audit()`)
	if e != nil {
		t.Fatal(e)
	}
	request("GET", a+"/products", "staff", nil, "", 503)
	supplier.Name = "must rollback"
	request("POST", a+"/suppliers/"+sid, "staff", supplier, "", 503)
	var name string
	db.QueryRow(ctx, `SELECT name FROM issuing_suppliers WHERE id=$1`, sid).Scan(&name)
	if name == supplier.Name {
		t.Fatal("audit failure committed write")
	}
}

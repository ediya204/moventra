package api

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/cryptofunds"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/fundrecords"
	"moventra.local/api/internal/issuing"
	"moventra.local/api/internal/ledger"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestFundRecords(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	cfg, e := pgxpool.ParseConfig(raw)
	if e != nil || cfg.ConnConfig.Host != "/tmp" || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("unsafe database")
	}
	base, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer base.Close()
	schema := "fund_records_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	ns := "shadow_records"
	l, e := ledger.New(db, cryptoBlnk(t), ns, "general_ledger_id")
	if e != nil {
		t.Fatal(e)
	}
	srv := &Server{DB: db, Ledger: l, Verifier: fakeVerifier{}, Issuing: &issuing.Service{DB: db, Mode: "isolated"}}
	h := srv.Handler()
	get := func(token, path string, want int) map[string]any {
		t.Helper()
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: %d %s", token, path, w.Code, w.Body.String())
		}
		var v map[string]any
		json.Unmarshal(w.Body.Bytes(), &v)
		d, _ := v["data"].(map[string]any)
		return d
	}
	// No 021/022 dependency: production still runs without those structures.
	exec(`DROP TABLE issuing_card_projections CASCADE`)
	exec(`DROP FUNCTION capture_otc_message() CASCADE`)
	rows, e := db.Query(ctx, `SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND (tablename LIKE 'message_%' OR tablename LIKE 'notification_%')`)
	if e != nil {
		t.Fatal(e)
	}
	var drop []string
	for rows.Next() {
		var table string
		rows.Scan(&table)
		drop = append(drop, table)
	}
	rows.Close()
	for _, table := range drop {
		exec("DROP TABLE " + table + " CASCADE")
	}
	// Recreate the pre-022 view; CASCADE above only removes the optional view.
	exec(`CREATE OR REPLACE VIEW channel_current_records AS SELECT connection_id,revision,kind,external_id,data FROM channel_records`)
	client := "/client-api/v1/fund-records"
	admin := "/admin-api/v1/fund-records"
	staff := "00000000-0000-0000-0000-000000000003"
	addCrypto := func(customer, namespace, kind, state, amount, fee string) string {
		t.Helper()
		id := uuid.NewString()
		data, _ := json.Marshal(map[string]string{"state": state, "kind": kind, "currency": "USDT", "amountMinor": amount, "feeMinor": fee, "toCurrency": "USD", "receiveMinor": "123", "address": "synthetic-address", "txHash": "synthetic-hash", "postingStatus": "pending"})
		exec(`INSERT INTO crypto_orders(id,namespace,customer_id,kind,state,revision,data,created_at) VALUES($1,$2,$3,$4,$5,1,$6,'2026-09-19T00:00:00Z')`, id, namespace, customer, kind, state, data)
		return id
	}
	var ids []string
	for i := 0; i < 23; i++ {
		ids = append(ids, addCrypto(personal, ns, "deposit", "processing", "9007199254740993123456", "0"))
	}
	addCrypto(other, ns, "deposit", "processing", "999", "0")
	addCrypto(personal, "shadow_other", "deposit", "processing", "999", "0")
	withd := addCrypto(personal, ns, "withdrawal", "unknown", "2000000", "10000")
	addCrypto(personal, ns, "otc", "processing", "2000000", "0")
	diag, e := db.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	_, e = fundrecords.Query(ctx, diag, "00000000-0000-0000-0000-000000000001", false, ns, true, map[string]string{"page": "0"})
	diag.Rollback(ctx)
	if e != nil {
		t.Fatal(e)
	}
	d := get("alice", client, 200)
	if d["total"] != float64(26) || len(d["records"].([]any)) != 20 {
		t.Fatalf("wrong page: %v", d)
	}
	// Same snapshot count, stable paging with identical timestamps and split fees.
	seen := map[string]bool{}
	for page := 0; page < 2; page++ {
		d = get("alice", fmt.Sprintf("%s?page=%d", client, page), 200)
		for _, x := range d["records"].([]any) {
			r := x.(map[string]any)
			id := r["id"].(string)
			if seen[id] {
				t.Fatal("duplicate page record")
			}
			seen[id] = true
			if r["customerName"] != nil {
				t.Fatal("client customer metadata leak")
			}
		}
	}
	if len(seen) != 26 {
		t.Fatal("missing records")
	}
	d = get("alice", client+"?kind=deposit&status=processing&currency=USDT&from=2026-09-19T00:00:00Z&to=2026-09-20T00:00:00Z", 200)
	if d["total"] != float64(23) {
		t.Fatal(d)
	}
	d = get("alice", client+"?to=2026-09-19T00:00:00Z", 200)
	if d["total"] != float64(0) {
		t.Fatal("end is exclusive")
	}
	d = get("alice", client+"?kind=otc&currency=USD", 200)
	if d["total"] != float64(1) {
		t.Fatal("OTC received currency not searchable")
	}
	record := "crypto_" + ids[0] + "_principal"
	d = get("alice", client+"/"+record, 200)
	if d["record"].(map[string]any)["amountMinor"] != "9007199254740993123456" {
		t.Fatal("precision lost")
	}
	get("bob", client+"/"+record, 404)
	get("staff-no-mfa", admin, 403)
	get("alice", admin, 403)
	get("staff", client, 403)
	if get("staff", admin, 200)["total"] != float64(0) {
		t.Fatal("scope leak")
	}
	exec(`INSERT INTO crypto_grants VALUES($1,$2,$3,'read')`, ns, personal, staff)
	if get("staff", admin, 200)["total"] != float64(26) {
		t.Fatal("authorized source missing")
	}
	for _, q := range []string{"?page=-1", "?kind=consumption", "?q=a&q=b", "?from=bad", "?customerId=bad", "?to=2026-09-19T00:00:00Z&from=2026-09-20T00:00:00Z"} {
		get("alice", client+q, 400)
	}
	if get("alice", client+"?q="+withd, 200)["total"] != float64(2) {
		t.Fatal("split fee search")
	}
	// Manual source remains invisible until its own grant is present.
	mid := uuid.NewString()
	exec(`INSERT INTO manual_funds_orders(id,namespace,customer_id,actor_id,direction,source,currency,amount_minor,note,evidence_ref,state) VALUES($1,$2,$3,$4,'credit','offline_receipt','USD',456,'fixture','synthetic-records','pending_review')`, mid, ns, personal, staff)
	if get("staff", admin+"?kind=manual_in", 200)["total"] != float64(0) {
		t.Fatal("manual permission broadened")
	}
	exec(`INSERT INTO manual_funds_grants VALUES($1,$2,'read')`, staff, personal)
	if get("staff", admin+"?kind=manual_in", 200)["total"] != float64(1) {
		t.Fatal("manual missing")
	}
	// Issuing prices and initial funding are separate records, not total + components.
	sid, pid, qid, oid := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	exec(`INSERT INTO issuing_suppliers(id,name,adapter,status) VALUES($1,'fixture','manual','paused')`, sid)
	exec(`INSERT INTO issuing_products(id,supplier_id,name,bin,upstream_id,status) VALUES($1,$2,'fixture','990001','fixture','draft')`, pid, sid)
	exec(`INSERT INTO issuing_quotes(id,customer_id,product_id,fingerprint,snapshot,fee_minor,funding_minor,expires_at) VALUES($1,$2,$3,'fixture','{}',1000,2000,now())`, qid, personal, pid)
	exec(`INSERT INTO issuing_orders(id,customer_id,product_id,quote_id,idempotency_key,snapshot,fee_minor,funding_minor,state,supplier_id,last4) VALUES($1,$2,$3,$4,$5,'{}',1000,2000,'funding_failed',$6,'4321')`, oid, personal, pid, qid, uuid.NewString(), sid)
	if get("staff", admin+"?kind=opening_fee", 200)["total"] != float64(0) {
		t.Fatal("issuing permission broadened")
	}
	exec(`INSERT INTO issuing_grants VALUES($1,$2,'customer:read')`, staff, personal)
	d = get("staff", admin+"?q=4321", 200)
	if d["total"] != float64(2) {
		t.Fatal(d)
	}
	// Check query directly to expose SQL errors during maintenance and never call providers.
	tx, e := db.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	_, e = fundrecords.Query(ctx, tx, staff, true, ns, true, map[string]string{"page": "0"})
	tx.Rollback(ctx)
	if e != nil {
		t.Fatal(e)
	}

	// Dedicated historical issuing journal uses hashed references, including unfund.
	legacyPost := func(step, amount string) {
		raw, _ := json.Marshal(oid + ":" + step)
		ref := fmt.Sprintf("mvl_%x", sha256.Sum256(raw))
		exec(`INSERT INTO issuing_journal(reference,customer_id,transaction_id,source_id,destination_id,amount_minor) VALUES($1,$2,$3,'legacy-source','legacy-target',$4)`, ref, personal, "legacy:"+step, amount)
	}
	legacyPost("fee", "1000")
	legacyPost("fund", "2000")
	legacyPost("unfund", "2000")
	d = get("alice", client+"?q=4321", 200)
	if d["total"] != float64(3) {
		t.Fatal("legacy return missing or double counted", d)
	}
	d = get("alice", client+"/issuing_"+oid+"_fee", 200)
	if d["record"].(map[string]any)["postingStatus"] != "posted" || len(d["evidence"].([]any)) != 3 {
		t.Fatal("legacy posting evidence missing", d)
	}
	// Real deposit shape: RecordCrypto stores the persisted chain evidence ref,
	// not crypto-order:<id>. Querying detail must use exactly that authorized ref.
	dw, dc, dop := uuid.NewString(), uuid.NewString(), uuid.NewString()
	exec(`INSERT INTO ledger_accounts(id,namespace,customer_id,account_key,kind,currency,scale) VALUES($1,$3,$4,'wallet-USDT','wallet','USDT',6),($2,$3,$4,'clearing-USDT','clearing','USDT',6)`, dw, dc, ns, personal)
	exec(`UPDATE crypto_orders SET state='completed',data=data||jsonb_build_object('state','completed','postingStatus','posted','evidenceRef','chain:synthetic:0') WHERE id=$1`, ids[0])
	exec(`INSERT INTO ledger_operations(id,namespace,customer_id,effect_key,kind,source_id,destination_id,amount_minor,currency,scale,state,evidence_ref) VALUES($1,$2,$3,'deposit:synthetic:0','wallet_credit',$4,$5,9007199254740993123456,'USDT',6,'applied','chain:synthetic:0')`, dop, ns, personal, dc, dw)
	exec(`INSERT INTO ledger_journal(operation_id,phase,blnk_reference,blnk_transaction_id,source_id,destination_id,amount_minor) VALUES($1,'apply','synthetic-deposit','synthetic-deposit-tx',$2,$3,9007199254740993123456)`, dop, dc, dw)
	d = get("alice", client+"/"+record, 200)
	if len(d["evidence"].([]any)) != 1 || d["record"].(map[string]any)["postingStatus"] != "posted" {
		t.Fatal("deposit actual evidence link missing", d)
	}
	get("bob", client+"/"+record, 404)
	// Business card ID must never be confused with the ledger account ID.
	account := func(key, kind, connection, external string) string {
		id := uuid.NewString()
		exec(`INSERT INTO ledger_accounts(id,namespace,customer_id,account_key,kind,currency,scale,connection_id,external_card_id) VALUES($1,$2,$3,$4,$5,'USD',2,$6,$7)`, id, ns, personal, key, kind, connection, external)
		return id
	}
	wallet := account("wallet-USD", "wallet", "", "")
	hold := account("hold", "escrow", "", "")
	feeAccount := account("fee", "fee", "", "")
	cardAccount := account("card", "card", "connection-one", "external-one")
	card := uuid.NewString()
	if card == cardAccount {
		t.Fatal("fixture must use distinct IDs")
	}
	exec(`INSERT INTO funds_cards(id,namespace,customer_id,connection_id,external_card_id,name,last4,ledger_account_id) VALUES($1,$2,$3,'connection-one','external-one','Fixture','8765',$4)`, card, ns, personal, cardAccount)
	snapshot, _ := json.Marshal(map[string]string{"fundsNamespace": ns, "connectionId": "connection-one"})
	exec(`UPDATE issuing_orders SET snapshot=$2,external_card_id='external-one',last4='8765' WHERE id=$1`, oid, snapshot)
	transfer := addCrypto(personal, ns, "card_transfer", "processing", "2000", "100")
	exec(`UPDATE crypto_orders SET data=data||jsonb_build_object('cardId',$2::text,'direction','wallet_to_card','currency','USD') WHERE id=$1`, transfer, card)
	d = get("alice", client+"?cardId="+card, 200)
	if d["total"] != float64(4) {
		t.Fatalf("funds card identity mismatch: %v", d)
	}
	for _, v := range d["records"].([]any) {
		r := v.(map[string]any)
		if r["cardId"] != card || r["last4"] != "8765" {
			t.Fatal("card metadata missing", r)
		}
	}
	if get("alice", client+"?cardId="+cardAccount, 200)["total"] != float64(0) {
		t.Fatal("ledger UUID incorrectly accepted as business card ID")
	}
	if get("alice", client+"?q=8765", 200)["total"] != float64(4) {
		t.Fatal("last4 search failed")
	}
	post := func(step, src, dst, amount string) string {
		id := uuid.NewString()
		exec(`INSERT INTO ledger_operations(id,namespace,customer_id,effect_key,kind,source_id,destination_id,amount_minor,currency,scale,state,evidence_ref) VALUES($1,$2,$3,$4,'crypto_move',$5,$6,$7,'USD',2,'applied',$8)`, id, ns, personal, "issuing:"+oid+":"+step, src, dst, amount, "issuing-order:"+oid)
		exec(`INSERT INTO ledger_journal(operation_id,phase,blnk_reference,blnk_transaction_id,source_id,destination_id,amount_minor) VALUES($1,'apply',$2,$3,$4,$5,$6)`, id, "fixture:"+id, "fixture-tx:"+id, src, dst, amount)
		return id
	}
	post("reserve", wallet, hold, "3000")
	post("fee", hold, feeAccount, "1000")
	post("fund", hold, cardAccount, "2000")
	post("unfund:hold", cardAccount, hold, "2000")
	post("unfund", hold, wallet, "2000")
	post("release", hold, wallet, "1")
	refund := post("fee-refund", feeAccount, wallet, "1000")
	d = get("alice", client+"?cardId="+card, 200)
	if d["total"] != float64(6) {
		t.Fatal("reserve/release or duplicate evidence counted as business records", d)
	}
	feeRecord := "issuing_" + oid + "_fee"
	d = get("alice", client+"/"+feeRecord, 200)
	fr := d["record"].(map[string]any)
	if fr["postingStatus"] != "posted" || fr["status"] != "completed" || fr["sourceState"] != "funding_failed" {
		t.Fatal("fee status confused with later order failure", fr)
	}
	d = get("alice", client+"/issuing_"+oid+"_refund-"+refund, 200)
	if d["record"].(map[string]any)["originalId"] != feeRecord {
		t.Fatal("refund original link missing")
	}
	get("bob", client+"/issuing_"+oid+"_refund-"+refund, 404)
	// Reading never changes a balance or replays operations.
	var before, after int
	db.QueryRow(ctx, `SELECT count(*) FROM ledger_journal`).Scan(&before)
	get("alice", client+"?cardId="+card, 200)
	db.QueryRow(ctx, `SELECT count(*) FROM ledger_journal`).Scan(&after)
	if before != after {
		t.Fatal("read mutated ledger")
	}
	// Revoking only issuing access removes its components and refunds, not crypto.
	exec(`DELETE FROM issuing_grants WHERE user_id=$1`, staff)
	if get("staff", admin+"?cardId="+card, 200)["total"] != float64(2) {
		t.Fatal("source grant revocation ignored")
	}
	exec(`UPDATE issuing_orders SET snapshot=jsonb_build_object('fundsNamespace',$2::text,'connectionId','wrong-connection') WHERE id=$1`, oid, ns)
	if get("alice", client+"?cardId="+card, 200)["total"] != float64(2) {
		t.Fatal("cross connection card association")
	}
	exec(`UPDATE issuing_orders SET snapshot=jsonb_build_object('fundsNamespace','shadow_other' ,'connectionId','connection-one') WHERE id=$1`, oid)
	if get("alice", client+"?cardId="+card, 200)["total"] != float64(2) {
		t.Fatal("foreign namespace leaking")
	}
	t.Run("production read without providers or optional migrations", func(t *testing.T) {
		t.Setenv("FUNDS_DISPLAY_MODE", "production")
		get("alice", client, 503) // A shadow runtime may not masquerade as production.
		srv.ProductionFunds = &cryptofunds.Service{Ledger: &ledger.Service{DB: db, Namespace: "live_records"}}
		srv.Issuing.Mode = "prepare"
		defer func() { srv.ProductionFunds = nil; srv.Issuing.Mode = "isolated" }()
		liveID := addCrypto(personal, "live_records", "deposit", "completed", "100000", "0")
		d := get("alice", client, 200)
		if d["mode"] != "live" || d["total"] != float64(1) {
			t.Fatal("production namespace not isolated", d)
		}
		get("alice", client+"/crypto_"+liveID+"_principal", 200)
	})
	// A failed audit prevents successful data responses.
	exec(`CREATE FUNCTION records_deny_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`)
	exec(`CREATE TRIGGER records_deny_audit BEFORE INSERT ON issuing_audit FOR EACH ROW EXECUTE FUNCTION records_deny_audit()`)
	get("alice", client, 503)
}

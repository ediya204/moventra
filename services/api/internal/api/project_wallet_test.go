package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/projection"
)

func TestProjectWalletAssignments(t *testing.T) {
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
	b := projection.Bundle{ConnectionID: "wallet-source", AccountID: "account", Label: "Original source", SourceAt: "2026-09-18T00:00:00Z"}
	card := func(id, va string) projection.Record {
		return projection.Record{Kind: "card", Data: map[string]any{"id": id, "accountId": b.AccountID, "virtualAccountId": va, "cardName": id, "last4": "2047"}}
	}
	trans := func(id, c, va string) projection.Record {
		return projection.Record{Kind: "transaction", Data: map[string]any{"id": id, "accountId": b.AccountID, "virtualAccountId": va, "cardId": c, "amountCents": "-9007199254740993", "date": b.SourceAt}}
	}
	b.Records = []projection.Record{card("old-card", "apexis"), card("outside-card", "other-wallet"), trans("history", "old-card", "apexis"), trans("other-history", "old-card", "other-wallet")}
	rev, e := projection.Import(ctx, db, b, "staff")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = database.BindCardSnapshot(ctx, db, "alice", b.ConnectionID, rev, "old broad snapshot", 2); e != nil {
		t.Fatal(e)
	}
	input := database.WalletAssignment{ConnectionID: b.ConnectionID, AccountID: b.AccountID, VirtualAccountID: "apexis", Label: "APEXIS Op", Revision: rev, CardIDs: []string{"old-card"}, Reason: "explicit initial card assignment", EvidenceRef: "synthetic/verified-wallet"}
	plan := func(uid string, in database.WalletAssignment) database.WalletPlan {
		t.Helper()
		p, e := database.AssignProjectWalletCards(ctx, db, "staff", uid, in, "", false)
		if e != nil {
			t.Fatal(e)
		}
		return p
	}
	apply := func(uid string, in database.WalletAssignment) database.WalletPlan {
		t.Helper()
		p := plan(uid, in)
		r, e := database.AssignProjectWalletCards(ctx, db, "staff", uid, in, p.SHA256, true)
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	p := plan("alice", input)
	if p.Cards != 1 || p.Transactions != 1 || p.LegacyCards != 2 {
		t.Fatal(p)
	}
	var n int
	db.QueryRow(ctx, `SELECT count(*) FROM project_wallets`).Scan(&n)
	if n != 0 {
		t.Fatal("plan mutated configuration")
	}
	if _, e = database.AssignProjectWalletCards(ctx, db, "staff", "alice", input, "wrong", true); e == nil {
		t.Fatal("unreviewed apply")
	}
	for _, variant := range []string{"wallet", "parent", "card", "duplicate", "revision"} {
		bad := input
		switch variant {
		case "wallet":
			bad.VirtualAccountID = "other-wallet"
		case "parent":
			bad.AccountID = "other-account"
		case "card":
			bad.CardIDs = []string{"outside-card"}
		case "duplicate":
			bad.CardIDs = []string{"old-card", "old-card"}
		case "revision":
			bad.Revision = "old"
		}
		if _, e = database.AssignProjectWalletCards(ctx, db, "staff", "alice", bad, "", false); e == nil {
			t.Fatal("invalid scope accepted", variant)
		}
	}
	if _, e = database.AssignProjectWalletCards(ctx, db, "bob", "alice", input, "", false); e == nil {
		t.Fatal("nonoperator assigned")
	}
	apply("alice", input)
	apply("alice", input)
	db.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action LIKE 'project-wallet:assign:%'`).Scan(&n)
	if n != 1 {
		t.Fatal("nonidempotent audit", n)
	}
	if _, e = database.BindCardSnapshot(ctx, db, "bob", b.ConnectionID, rev, "must refuse broad future grant", 2); e == nil {
		t.Fatal("broad binder still available")
	}
	if _, e = database.AssignProjectWalletCards(ctx, db, "staff", "bob", input, "", false); e == nil {
		t.Fatal("ownership changed")
	}
	h := (&Server{DB: db, Verifier: fakeVerifier{}}).Handler()
	request := func(uid, customer, path string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest("GET", "/client-api/v1/customers/"+customer+"/card-projections"+path, nil)
		r.Header.Set("Authorization", "Bearer "+uid)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	rows := func(uid, customer, resource string) map[string]any {
		t.Helper()
		w := request(uid, customer, "/wallet-source/"+resource)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		var d map[string]any
		if e = json.Unmarshal(w.Body.Bytes(), &d); e != nil {
			t.Fatal(e)
		}
		return d["data"].(map[string]any)
	}
	if rows("alice", personal, "cards")["total"] != float64(1) {
		t.Fatal("legacy broad access remained")
	}
	txs := rows("alice", personal, "transactions")
	if txs["total"] != float64(1) || txs["syncMode"] != "assigned_wallet_projection" {
		t.Fatal(txs)
	}
	txrow := txs["rows"].([]any)[0].(map[string]any)
	if txrow["accountId"] != nil || txrow["virtualAccountId"] != nil || txrow["amountCents"] != "-9007199254740993" || txrow["cardLast4"] != "2047" {
		t.Fatal("DTO leak/precision", txrow)
	}
	for _, resource := range []string{"transactions/history", "transactions?keyword=2047"} {
		result := rows("alice", personal, resource)
		if result["total"] != float64(1) || result["rows"].([]any)[0].(map[string]any)["cardLast4"] != "2047" {
			t.Fatal("wallet card suffix missing", resource, result)
		}
	}
	for _, path := range []string{"/wallet-source/cards/outside-card", "/wallet-source/transactions/other-history", "/wallet-source/transactions?cardId=outside-card"} {
		if w := request("alice", personal, path); w.Code != 404 {
			t.Fatal(path, w.Code, w.Body.String())
		}
	}
	if w := request("bob", personal, "/wallet-source/cards"); w.Code != 404 {
		t.Fatal("cross customer", w.Code)
	}
	// Importing a new card does not give it to the initial user; assign explicitly to Bob.
	b.SourceAt = "2026-09-18T01:00:00Z"
	b.Records = append(b.Records, card("new-card", "apexis"), trans("new-history", "new-card", "apexis"))
	newRev, e := projection.Import(ctx, db, b, "staff")
	if e != nil {
		t.Fatal(e)
	}
	if rows("alice", personal, "cards")["total"] != float64(1) {
		t.Fatal("new card auto-owned by Alice")
	}
	if w := request("alice", personal, "/wallet-source/cards?revision="+rev); w.Code != 409 {
		t.Fatal("stale revision accepted")
	}
	if _, e = database.AssignProjectWalletCards(ctx, db, "staff", "bob", input, p.SHA256, true); e == nil {
		t.Fatal("stale plan accepted")
	}
	future := input
	future.Revision = newRev
	future.CardIDs = []string{"new-card"}
	future.Reason = "new customer explicit card allocation"
	apply("bob", future)
	if rows("bob", other, "cards")["total"] != float64(1) || rows("bob", other, "transactions")["total"] != float64(1) {
		t.Fatal("new customer scope")
	}
	if w := request("alice", personal, "/wallet-source/cards/new-card"); w.Code != 404 {
		t.Fatal("new user card exposed")
	}
	if w := request("bob", other, "/wallet-source/transactions/history"); w.Code != 404 {
		t.Fatal("old history exposed")
	}
	bad := future
	bad.CardIDs = []string{"old-card", "new-card"}
	if _, e = database.AssignProjectWalletCards(ctx, db, "staff", "bob", bad, "", false); e == nil {
		t.Fatal("mixed conflict accepted")
	}
	// Original snapshot and source history are retained, while shared pool is never a customer balance.
	db.QueryRow(ctx, `SELECT count(*) FROM customer_card_bindings`).Scan(&n)
	if n != 2 {
		t.Fatal("legacy evidence destroyed")
	}
	db.QueryRow(ctx, `SELECT count(*) FROM project_wallet_cards`).Scan(&n)
	if n != 2 {
		t.Fatal("assignment count", n)
	}
	// Backend status is derived from actual assignment without disclosing customer identity.
	ar := httptest.NewRequest("GET", "/admin-api/v1/channel-projections/wallet-source/cards/old-card", nil)
	ar.Header.Set("Authorization", "Bearer staff")
	aw := httptest.NewRecorder()
	h.ServeHTTP(aw, ar)
	if aw.Code != 200 || !strings.Contains(aw.Body.String(), `"assignmentKind":"project_wallet"`) || strings.Contains(aw.Body.String(), personal) {
		t.Fatal("admin assignment state", aw.Code, aw.Body.String())
	}
	// Missing virtual-account provenance never acquires customer visibility.
	b.SourceAt = "2026-09-18T02:00:00Z"
	absent := trans("unknown-wallet", "old-card", "apexis")
	delete(absent.Data, "virtualAccountId")
	b.Records = append(b.Records, absent, card("unassigned-card", "apexis"))
	lastRev, er := projection.Import(ctx, db, b, "staff")
	if er != nil {
		t.Fatal(er)
	}
	if rows("alice", personal, "transactions")["total"] != float64(1) {
		t.Fatal("unknown-wallet history visible")
	}
	// Assignment and enrollment/audit are one transaction; a failed audit cannot grant a card.
	if _, e = db.Exec(ctx, `CREATE FUNCTION deny_wallet_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'project-wallet:assign:%' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER deny_wallet_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_wallet_audit()`); e != nil {
		t.Fatal(e)
	}
	defer db.Exec(ctx, `DROP TRIGGER deny_wallet_audit ON audit_events; DROP FUNCTION deny_wallet_audit()`)
	pending := future
	pending.Revision = lastRev
	pending.CardIDs = []string{"unassigned-card"}
	pendingPlan := plan("bob", pending)
	if _, e = database.AssignProjectWalletCards(ctx, db, "staff", "bob", pending, pendingPlan.SHA256, true); e == nil {
		t.Fatal("audit failure accepted")
	}
	db.QueryRow(ctx, `SELECT count(*) FROM project_wallet_cards WHERE external_card_id='unassigned-card'`).Scan(&n)
	if n != 0 {
		t.Fatal("partial assignment survived rollback")
	}
	// A read that cannot audit must not disclose the data.
	if _, e = db.Exec(ctx, `ALTER TABLE channel_read_audit ADD CONSTRAINT wallet_deny_audit CHECK(actor_id<>'00000000-0000-0000-0000-000000000001') NOT VALID`); e != nil {
		t.Fatal(e)
	}
	defer db.Exec(ctx, `ALTER TABLE channel_read_audit DROP CONSTRAINT wallet_deny_audit`)
	if w := request("alice", personal, "/wallet-source/cards"); w.Code != 503 || strings.Contains(w.Body.String(), "old-card") {
		t.Fatal("audit fail open")
	}
}

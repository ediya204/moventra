package slashhook

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func testCardSync(t *testing.T, ctx context.Context, db *pgxpool.Pool, s *Service) {
	t.Helper()
	_, err := db.Exec(ctx, `INSERT INTO users(id,firebase_uid,display_name) VALUES('10000000-0000-4000-8000-000000000001','sync-user','Sync');
 INSERT INTO customers(id,kind,name,personal_owner_id) VALUES('20000000-0000-4000-8000-000000000001','personal','Sync','10000000-0000-4000-8000-000000000001');
 INSERT INTO channel_connections(id,account_ref,label,revision,source_at,imported_at) VALUES('source','acct1','Source','rev',now(),now());
 INSERT INTO channel_imports(connection_id,revision,source_at,actor_id,record_count) VALUES('source','rev',now(),'10000000-0000-4000-8000-000000000001',1);
 INSERT INTO channel_records VALUES('source','rev','card','card1','{"id":"card1","accountId":"acct1","virtualAccountId":"wallet1","cardStatus":"active"}');
 INSERT INTO project_wallets VALUES('moventra','source','acct1','wallet1','Wallet','test','10000000-0000-4000-8000-000000000001',now());
 INSERT INTO project_wallet_customers(customer_id,project_key) VALUES('20000000-0000-4000-8000-000000000001','moventra');
 INSERT INTO project_wallet_cards(connection_id,external_card_id,customer_id,virtual_account_ref,evidence_revision,actor_id,reason) VALUES('source','card1','20000000-0000-4000-8000-000000000001','wallet1','rev','10000000-0000-4000-8000-000000000001','test');
 INSERT INTO card_sync_links VALUES('source','trial',true,now());`)
	if err != nil {
		t.Fatal(err)
	}
	status, wallet := "paused", "wallet1"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Error("provider write")
		}
		if r.URL.Path == "/account" {
			fmt.Fprint(w, `{"items":[{"id":"acct1"}]}`)
			return
		}
		if r.URL.Path != "/card/card1" || r.URL.Query().Get("include_cvv") != "false" {
			t.Error("unsafe card fetch")
		}
		fmt.Fprintf(w, `{"id":"card1","accountId":"acct1","virtualAccountId":%q,"status":%q,"cvv":"secret"}`, wallet, status)
	}))
	defer ts.Close()
	s.base = ts.URL
	step := func() {
		t.Helper()
		if err := s.Step(ctx); err != nil {
			t.Fatal(err)
		}
	}
	read := func(wantStatus, wantSync string) {
		t.Helper()
		var a, b string
		if err := db.QueryRow(ctx, `SELECT data->>'cardStatus',data->>'syncState' FROM channel_current_records WHERE external_id='card1'`).Scan(&a, &b); err != nil || a != wantStatus || b != wantSync {
			t.Fatalf("state %s %s %v expected %s %s", a, b, err, wantStatus, wantSync)
		}
	}
	step()
	read("paused", "synced") // periodic repair without webhook
	var original string
	db.QueryRow(ctx, `SELECT data->>'cardStatus' FROM channel_records WHERE external_id='card1'`).Scan(&original)
	if original != "active" {
		t.Fatal("history rewritten")
	}
	event := func(id string, at time.Time) {
		t.Helper()
		if err := s.receive(ctx, "/webhooks/slash", Event{Type: "card.update", ID: id, Entity: "card1", At: at}); err != nil {
			t.Fatal(err)
		}
	}
	event("new-card-event", time.Now())
	read("paused", "pending")
	status = "closed"
	step()
	read("closed", "synced")
	// An older notification must re-fetch latest state, not replay old payload.
	event("old-card-event", time.Now().Add(-time.Hour))
	step()
	read("closed", "synced")
	wallet = "wrong-wallet"
	event("wrong-wallet-event", time.Now())
	step()
	read("closed", "error")
	wallet = "wallet1"
	event("repair-event", time.Now())
	step()
	read("closed", "synced")
	db.Exec(ctx, `UPDATE card_current_states SET checked_at=now()-interval '11 minutes'`)
	read("closed", "stale")
}

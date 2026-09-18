package slashhook

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestMetricReadOnlyPipeline(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("isolated database required")
	}
	cfg, e := pgxpool.ParseConfig(raw)
	if e != nil || cfg.ConnConfig.Host != "/tmp" {
		t.Fatal("local socket required")
	}
	ctx := context.Background()
	admin, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Close()
	schema := "metrics_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	admin.Exec(ctx, "CREATE SCHEMA "+schema)
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	must := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	must(database.Migrate(ctx, db))
	must(database.MigrateCardMetrics(ctx, db))
	_, e = db.Exec(ctx, `INSERT INTO users(id,firebase_uid,display_name) VALUES('10000000-0000-4000-8000-000000000001','metric-user','Synthetic');
 INSERT INTO customers(id,kind,name,personal_owner_id) VALUES('20000000-0000-4000-8000-000000000001','personal','Synthetic','10000000-0000-4000-8000-000000000001');
 INSERT INTO channel_connections(id,account_ref,label,revision,source_at,imported_at) VALUES('metric','acct','Synthetic','rev',now(),now());
 INSERT INTO channel_imports(connection_id,revision,source_at,actor_id,record_count) VALUES('metric','rev',now(),'10000000-0000-4000-8000-000000000001',1);
 INSERT INTO channel_records VALUES('metric','rev','card','card','{"id":"card","accountId":"acct","virtualAccountId":"wallet","cardStatus":"active"}');
 INSERT INTO project_wallets VALUES('moventra','metric','acct','wallet','Synthetic','test','10000000-0000-4000-8000-000000000001',now());
 INSERT INTO project_wallet_customers(customer_id,project_key) VALUES('20000000-0000-4000-8000-000000000001','moventra');
 INSERT INTO project_wallet_cards(connection_id,external_card_id,customer_id,virtual_account_ref,evidence_revision,actor_id,reason) VALUES('metric','card','20000000-0000-4000-8000-000000000001','wallet','rev','10000000-0000-4000-8000-000000000001','test');
 INSERT INTO slash_hook_connections(id,account_ref,endpoint) VALUES('metric-hook','acct','/webhooks/slash/metrics');
 INSERT INTO card_sync_links(connection_id,hook_connection_id) VALUES('metric','metric-hook');`)
	must(e)
	now := time.Now().UTC().Add(-time.Hour).Truncate(time.Millisecond)
	posted := "pending"
	detail := "pending"
	requests := 0
	failPage := false
	loop := false
	transaction := func(id, amount, status, ds string) string {
		return fmt.Sprintf(`{"id":%q,"accountId":"acct","virtualAccountId":"wallet","cardId":"card","amountCents":%s,"date":%q,"status":%q,"detailedStatus":%q,"merchantData":{"description":"Synthetic shop","cvv":"DO_NOT_SAVE"},"pan":"DO_NOT_SAVE"}`, id, amount, now.Format(time.RFC3339Nano), status, ds)
	}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != "GET" {
			t.Error("financial write attempted")
		}
		switch r.URL.Path {
		case "/account":
			fmt.Fprint(w, `{"items":[{"id":"acct"}]}`)
		case "/card/card":
			fmt.Fprint(w, `{"id":"card","accountId":"acct","virtualAccountId":"wallet","spendingConstraint":{"spendingRule":{"utilizationLimit":{"limitAmount":{"amountCents":10000},"preset":"monthly","timezone":"Asia/Hong_Kong"}},"pan":"DO_NOT_SAVE"}}`)
		case "/card/card/utilization":
			fmt.Fprint(w, `{"spend":{"amountCents":123},"availableBalance":{"amountCents":0}}`)
		case "/transaction/new":
			fmt.Fprint(w, transaction("new", "-300", posted, detail))
		case "/transaction":
			q := r.URL.Query()
			if q.Get("filter:cardId") != "card" || q.Get("filter:category") != "card" || q.Get("filter:accountId") != "acct" || q.Get("filter:virtualAccountId") != "wallet" {
				t.Error("unscoped request")
			}
			if q.Get("filter:from_date") == "0" {
				fmt.Fprint(w, `{"items":[],"metadata":{}}`)
				return
			}
			if q.Get("cursor") == "next" {
				if failPage {
					w.WriteHeader(503)
					return
				}
				next := ""
				if loop {
					next = "next"
				}
				fmt.Fprintf(w, `{"items":[%s,%s],"metadata":{"nextCursor":%q}}`, transaction("refund", "200", "posted", "refund"), transaction("new", "-300", posted, detail), next)
				return
			}
			fmt.Fprintf(w, `{"items":[%s],"metadata":{"nextCursor":"next"}}`, transaction("old", "-9007199254740993", "posted", "settled"))
		default:
			t.Errorf("unexpected %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer ts.Close()
	s := New(db, "synthetic-key")
	s.MetricsEnabled = true
	s.base = ts.URL
	manifest, e := s.PlanMetrics(ctx, "metric-user")
	must(e)
	if len(manifest) != 1 {
		t.Fatal(manifest)
	}
	must(s.EnrollMetrics(ctx, "metric-user", manifest))
	must(s.EnrollMetrics(ctx, "metric-user", manifest))
	step := func() { t.Helper(); must(s.Step(ctx)) }
	read := func() map[string]any {
		t.Helper()
		tx, e := db.Begin(ctx)
		must(e)
		defer tx.Rollback(ctx)
		out, e := ReadMetrics(ctx, tx, "metric", []string{"card"})
		must(e)
		m := map[string]any{}
		must(json.Unmarshal(out["card"], &m))
		return m
	}
	failPage = true
	step()
	if read()["spendingMinor"] != nil {
		t.Fatal("partial scan shown as money")
	}
	step()
	var cursor, state string
	must(db.QueryRow(ctx, `SELECT cursor,state FROM card_metric_runs WHERE purpose='recent'`).Scan(&cursor, &state))
	if cursor != "next" || state != "queued" {
		t.Fatal("failure advanced cursor", cursor, state)
	}
	failPage = false
	_, e = db.Exec(ctx, `UPDATE card_metric_runs SET next_attempt=now()`)
	must(e)
	step()
	m := read()
	if m["spendingMinor"] != "9007199254740993" || m["refundMinor"] != "200" || m["availableMinor"] != "0" {
		t.Fatal(m)
	}
	for i := 0; i < 4; i++ {
		step()
	}
	before := requests
	step()
	if requests != before {
		t.Fatal("idle worker polled provider")
	}
	var n int
	must(db.QueryRow(ctx, `SELECT count(*) FROM card_source_transactions`).Scan(&n))
	if n != 3 {
		t.Fatal("duplicate import", n)
	}
	posted = "posted"
	detail = "settled"
	event := Event{Type: "aggregated_transaction.update", ID: "ev1", Entity: "new", At: time.Now()}
	must(s.receive(ctx, "/webhooks/slash/metrics", event))
	must(s.receive(ctx, "/webhooks/slash/metrics", event))
	step()
	for i := 0; i < 3; i++ {
		step()
	}
	m = read()
	if m["spendingMinor"] != "9007199254741293" {
		t.Fatal("update not reflected once", m)
	}
	// An old notification fetches the current resource, never event-time content.
	detail = "refund"
	posted = "posted" // negative refund is a contradictory source fact: never gross it as purchase.
	event.ID = "old-event"
	event.At = time.Now().Add(-time.Hour)
	must(s.receive(ctx, "/webhooks/slash/metrics", event))
	step()
	if read()["spendingMinor"] == "9007199254741293" {
		t.Fatal("refund still counted as purchase")
	}
	var rules string
	must(db.QueryRow(ctx, `SELECT rules::text FROM card_utilization_snapshots LIMIT 1`).Scan(&rules))
	if !strings.Contains(rules, "monthly") || !strings.Contains(rules, "10000") || !strings.Contains(rules, "Asia/Hong_Kong") {
		t.Fatal("source limit period lost", rules)
	}
	var unsafe bool
	must(db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM card_metric_observations WHERE payload::text LIKE '%DO_NOT_SAVE%')`).Scan(&unsafe))
	if unsafe {
		t.Fatal("sensitive payload persisted")
	}
	// A repeated cursor marks the run for review; it cannot announce completeness.
	loop = true
	step()
	step()
	var reviews int
	must(db.QueryRow(ctx, `SELECT count(*) FROM card_metric_runs WHERE state='review' AND last_error='cursor_loop'`).Scan(&reviews))
	if reviews == 0 {
		t.Fatal("loop cursor did not stop")
	}
	var runID, cursorBefore string
	must(db.QueryRow(ctx, `SELECT id::text,cursor FROM card_metric_runs WHERE state='review' AND last_error='cursor_loop' LIMIT 1`).Scan(&runID, &cursorBefore))
	if s.RetryMetricRun(ctx, "different-user", runID) == nil {
		t.Fatal("unauthorized retry accepted")
	}
	must(s.RetryMetricRun(ctx, "metric-user", runID))
	var cursorAfter, runState string
	must(db.QueryRow(ctx, `SELECT cursor,state FROM card_metric_runs WHERE id=$1`, runID).Scan(&cursorAfter, &runState))
	if cursorBefore != cursorAfter || runState != "queued" {
		t.Fatal("retry lost checkpoint")
	}
	loop = false
	tx, e := db.Begin(ctx)
	must(e)
	must(QueueMetricRefresh(ctx, tx, "metric", "card"))
	must(tx.Commit(ctx))
	// Revoke ownership while a follow-up is queued: no further provider query.
	_, e = db.Exec(ctx, `DELETE FROM project_wallet_cards WHERE connection_id='metric'`)
	must(e)
	before = requests
	step()
	if before != requests {
		t.Fatal("revoked card fetched")
	}
	var total int
	must(db.QueryRow(ctx, `SELECT count(*) FROM transactions`).Scan(&total))
	if total != 0 {
		t.Fatal("source backfill wrote business ledger")
	}
}

func TestMetricNumbersAndSanitization(t *testing.T) {
	for _, v := range []string{`1.1`, `1e3`, `null`, `""`, `999999999999999999999999999999999999999`} {
		if _, e := integer(json.RawMessage(v)); e == nil {
			t.Fatal("invalid money accepted", v)
		}
	}
	if v, e := integer(json.RawMessage(`-9007199254740993`)); e != nil || v != "-9007199254740993" {
		t.Fatal(v, e)
	}
}

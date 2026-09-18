package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/messages"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMessagesLifecycle(t *testing.T) {
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
	if e = database.MigrateMessages(ctx, db); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, seed); e != nil {
		t.Fatal(e)
	}
	defer db.Exec(ctx, `TRUNCATE message_namespaces,users CASCADE`)
	_, e = db.Exec(ctx, `INSERT INTO message_namespaces(namespace,otc_enabled,activated_at) VALUES('message-test',true,'2026-01-01'); INSERT INTO staff_grants(user_id,customer_id,permission) SELECT '00000000-0000-0000-0000-000000000003',id,'accounts:read' FROM customers WHERE kind='personal'; INSERT INTO message_grants SELECT 'message-test','00000000-0000-0000-0000-000000000003',c.id,p FROM customers c CROSS JOIN unnest(ARRAY['read','compose','publish','retry']) p WHERE c.kind='personal'`)
	if e != nil {
		t.Fatal(e)
	}
	svc := &messages.Service{DB: db, Namespace: "message-test", Key: []byte(strings.Repeat("x", 32)), SendEnabled: true}
	h := (&Server{DB: db, Verifier: fakeVerifier{}, Messages: svc}).Handler()
	request := func(method, path, token string, body any, key string) *httptest.ResponseRecorder {
		b := ""
		if body != nil {
			raw, _ := json.Marshal(body)
			b = string(raw)
		}
		r := httptest.NewRequest(method, path, strings.NewReader(b))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	decode := func(w *httptest.ResponseRecorder, target any) {
		t.Helper()
		if w.Code != 200 {
			t.Fatalf("status %d: %s", w.Code, w.Body)
		}
		var v struct {
			Data json.RawMessage `json:"data"`
		}
		if e := json.Unmarshal(w.Body.Bytes(), &v); e != nil {
			t.Fatal(e)
		}
		if e := json.Unmarshal(v.Data, target); e != nil {
			t.Fatal(e)
		}
	}
	admin := "/admin-api/v1/message-campaigns"
	client := "/client-api/v1/customers/" + personal + "/messages"
	draft := messages.Draft{Title: "运营通知", Body: "<script>plain text</script>\n请查看订单。", Priority: "normal", Customers: []string{personal, other}}
	var campaign messages.Campaign
	key := uuid.NewString()
	decode(request("POST", admin, "staff", draft, key), &campaign)
	var replay messages.Campaign
	decode(request("POST", admin, "staff", draft, key), &replay)
	if replay.ID != campaign.ID {
		t.Fatal("duplicate draft")
	}
	draft.Title = "changed"
	if w := request("POST", admin, "staff", draft, key); w.Code != 409 {
		t.Fatal("idempotency conflict", w.Code)
	}
	draft.Title = "运营通知"
	if w := request("GET", admin+"/"+campaign.ID, "staff-no-mfa", nil, ""); w.Code != 403 {
		t.Fatal("MFA", w.Code)
	}
	decode(request("GET", admin+"/requests/"+key, "staff", nil, ""), &replay)
	draft.Revision = 99
	if w := request("POST", admin+"/"+campaign.ID+"/draft", "staff", draft, ""); w.Code != 409 {
		t.Fatal("stale draft")
	}
	publish := map[string]int{"revision": campaign.Revision}
	decode(request("POST", admin+"/"+campaign.ID+"/publish", "staff", publish, campaign.ID), &replay)
	decode(request("POST", admin+"/"+campaign.ID+"/publish", "staff", publish, campaign.ID), &replay)
	// Two workers cannot deliver the same pending task twice.
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := svc.DeliverOne(ctx); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	var page messages.Page
	decode(request("GET", client, "alice", nil, ""), &page)
	if len(page.Items) != 1 || page.Summary.Unread != 1 || page.Items[0].Body != draft.Body {
		t.Fatalf("inbox %#v", page)
	}
	first := page.Items[0].ID
	snapshot := page.Summary.Snapshot
	if w := request("GET", client+"/"+first, "bob", nil, ""); w.Code != 404 {
		t.Fatal("cross customer")
	}
	if w := request("POST", client+"/"+first+"/read", "bob", map[string]any{}, ""); w.Code != 404 {
		t.Fatal("cross read")
	}
	if w := request("POST", strings.Replace(client, personal, other, 1)+"/read-all", "bob", map[string]string{"snapshotToken": snapshot}, ""); w.Code != 400 {
		t.Fatal("cross snapshot", w.Code)
	}
	// Snapshot's high-watermark excludes messages delivered afterwards.
	secondDraft := draft
	secondDraft.Revision = 0
	secondDraft.Title = "稍后收到"
	secondDraft.Customers = []string{personal}
	var second messages.Campaign
	decode(request("POST", admin, "staff", secondDraft, uuid.NewString()), &second)
	decode(request("POST", admin+"/"+second.ID+"/publish", "staff", map[string]int{"revision": 1}, second.ID), &replay)
	if _, e = svc.DeliverOne(ctx); e != nil {
		t.Fatal(e)
	}
	var summary messages.Summary
	decode(request("POST", client+"/read-all", "alice", map[string]string{"snapshotToken": snapshot}, ""), &summary)
	if summary.Unread != 1 {
		t.Fatal("swallowed new arrival", summary)
	}
	var detail messages.Message
	decode(request("GET", client+"/"+first, "alice", nil, ""), &detail)
	readAt := detail.ReadAt
	decode(request("POST", client+"/"+first+"/read", "alice", map[string]any{}, ""), &summary)
	decode(request("GET", client+"/"+first, "alice", nil, ""), &detail)
	if readAt == nil || !readAt.Equal(*detail.ReadAt) {
		t.Fatal("first read changed")
	}
	decode(request("GET", client+"?limit=1", "alice", nil, ""), &page)
	if len(page.Items) != 1 || page.Next == "" {
		t.Fatal("pagination")
	}
	next := page.Next
	decode(request("GET", client+"?limit=1&cursor="+next, "alice", nil, ""), &page)
	if len(page.Items) != 1 || page.Items[0].ID != first {
		t.Fatal("cursor did not advance")
	}
	if w := request("GET", client+"?limit=1&status=read&cursor="+next, "alice", nil, ""); w.Code != 400 {
		t.Fatal("cursor filter not bound")
	}
	// Content is immutable once published.
	draft.Revision = 1
	if w := request("POST", admin+"/"+campaign.ID+"/draft", "staff", draft, ""); w.Code != 409 {
		t.Fatal("published content changed")
	}
	// Permission withdrawal between publish and delivery is checked again.
	var skipped messages.Campaign
	decode(request("POST", admin, "staff", secondDraft, uuid.NewString()), &skipped)
	decode(request("POST", admin+"/"+skipped.ID+"/publish", "staff", map[string]int{"revision": 1}, skipped.ID), &replay)
	if _, e = db.Exec(ctx, `DELETE FROM message_grants WHERE permission='publish'`); e != nil {
		t.Fatal(e)
	}
	if _, e = svc.DeliverOne(ctx); e != nil {
		t.Fatal(e)
	}
	decode(request("GET", admin+"/"+skipped.ID, "staff", nil, ""), &skipped)
	if skipped.Counts["skipped"] != 1 {
		t.Fatal("revoked sender delivered")
	}
	// Simulate a storage failure and demonstrate savepoint rollback and durable retry.
	_, e = db.Exec(ctx, `INSERT INTO message_grants SELECT 'message-test','00000000-0000-0000-0000-000000000003',c.id,'publish' FROM customers c WHERE c.kind='personal'; CREATE FUNCTION fail_message_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic outage'; END $$;CREATE TRIGGER fail_message_insert BEFORE INSERT ON message_inbox FOR EACH ROW EXECUTE FUNCTION fail_message_insert()`)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Exec(ctx, `DROP TRIGGER IF EXISTS fail_message_insert ON message_inbox;DROP FUNCTION IF EXISTS fail_message_insert()`)
	var retry messages.Campaign
	decode(request("POST", admin, "staff", secondDraft, uuid.NewString()), &retry)
	decode(request("POST", admin+"/"+retry.ID+"/publish", "staff", map[string]int{"revision": 1}, retry.ID), &replay)
	if _, e = svc.DeliverOne(ctx); e != nil {
		t.Fatal(e)
	}
	var attempts int
	var state string
	if e = db.QueryRow(ctx, `SELECT state,attempts FROM message_jobs WHERE campaign_id=$1`, retry.ID).Scan(&state, &attempts); e != nil || state != "pending" || attempts != 1 {
		t.Fatal("retry persistence", e, state, attempts)
	}
	for i := 1; i < 8; i++ {
		if _, e = db.Exec(ctx, `UPDATE message_jobs SET next_attempt_at=now() WHERE campaign_id=$1`, retry.ID); e != nil {
			t.Fatal(e)
		}
		if _, e = svc.DeliverOne(ctx); e != nil {
			t.Fatal(e)
		}
	}
	decode(request("GET", admin+"/"+retry.ID, "staff", nil, ""), &retry)
	if retry.Counts["failed"] != 1 {
		t.Fatal("retry exhaustion must be visible", retry.Counts)
	}
	decode(request("POST", admin+"/"+retry.ID+"/retry-failed", "staff", map[string]any{}, ""), &replay)
	decode(request("POST", admin+"/"+retry.ID+"/retry-failed", "staff", map[string]any{}, ""), &replay)
	_, e = db.Exec(ctx, `DROP TRIGGER fail_message_insert ON message_inbox;DROP FUNCTION fail_message_insert();UPDATE message_jobs SET next_attempt_at=now() WHERE state='pending'`)
	if e != nil {
		t.Fatal(e)
	}
	restarted := *svc
	if _, e = restarted.DeliverOne(ctx); e != nil {
		t.Fatal(e)
	}
	decode(request("GET", admin+"/"+retry.ID, "staff", nil, ""), &retry)
	if retry.Counts["delivered"] != 1 {
		t.Fatal("retry did not recover")
	}
	// Automatic OTC capture is atomic with order persistence, with minimal facts.
	order := uuid.NewString()
	payload := `{"id":"` + order + `","kind":"otc","state":"processing","currency":"USDT","toCurrency":"USD","amountMinor":"900719925474099300","receiveMinor":"89171272621935","feeMinor":"0","quote":{"rate":"0.99"},"secret":"must-not-copy"}`
	insert := `INSERT INTO crypto_orders(id,namespace,customer_id,kind,state,revision,data) VALUES($1,'message-test',$2,'otc','processing',1,$3)`
	tx, e := db.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = tx.Exec(ctx, insert, order, personal, payload); e != nil {
		t.Fatal(e)
	}
	if e = tx.Rollback(ctx); e != nil {
		t.Fatal(e)
	}
	var n int
	db.QueryRow(ctx, `SELECT count(*) FROM message_jobs WHERE order_id=$1`, order).Scan(&n)
	if n != 0 {
		t.Fatal("rolled back order notified")
	}
	if _, e = db.Exec(ctx, insert, order, personal, payload); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, `UPDATE crypto_orders SET state='completed',revision=2,data=data||'{"state":"completed","postingStatus":"posted"}',updated_at=now() WHERE id=$1`, order); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, `UPDATE crypto_orders SET revision=3 WHERE id=$1`, order); e != nil {
		t.Fatal(e)
	}
	db.QueryRow(ctx, `SELECT count(*) FROM message_jobs WHERE order_id=$1`, order).Scan(&n)
	if n != 2 {
		t.Fatal("wrong OTC event count", n)
	}
	var facts string
	db.QueryRow(ctx, `SELECT facts::text FROM message_jobs WHERE order_id=$1 AND resource_version=2`, order).Scan(&facts)
	if strings.Contains(facts, "secret") || !strings.Contains(facts, "900719925474099300") {
		t.Fatal("facts filtering/precision", facts)
	}
	for i := 0; i < 2; i++ {
		if _, e = svc.DeliverOne(ctx); e != nil {
			t.Fatal(e)
		}
	}
	decode(request("GET", client+"?category=otc", "alice", nil, ""), &page)
	if len(page.Items) != 2 {
		t.Fatal("OTC inbox")
	}
	if _, e = db.Exec(ctx, `UPDATE message_namespaces SET otc_enabled=false WHERE namespace='message-test'`); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, `UPDATE crypto_orders SET state='unknown',data=data||'{"state":"unknown"}',revision=4 WHERE id=$1`, order); e != nil {
		t.Fatal(e)
	}
	db.QueryRow(ctx, `SELECT count(*) FROM message_jobs WHERE order_id=$1`, order).Scan(&n)
	if n != 2 {
		t.Fatal("disabled subscription emitted")
	}
	var audit int
	db.QueryRow(ctx, `SELECT count(*) FROM message_audit WHERE namespace='message-test'`).Scan(&audit)
	if audit < 5 {
		t.Fatal("audit missing")
	}
	if w := request("GET", client+"?category=invalid", "alice", nil, ""); w.Code != 400 {
		t.Fatal("bad filter")
	}
	if w := request("GET", client+"?q=a&q=b", "alice", nil, ""); w.Code != 400 {
		t.Fatal("duplicate filter")
	}
	t.Log(fmt.Sprintf("OTC rollback/commit, concurrent delivery, MFA, scope, durable retry, snapshot read and audit verified at %s", time.Now().UTC().Format(time.RFC3339)))
}

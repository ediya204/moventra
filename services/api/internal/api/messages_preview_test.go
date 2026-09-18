package api

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/messages"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// Explicit local-only browser harness. Test authentication is never compiled
// into cmd/api. This server exposes message routes only, no financial commands.
func TestMessagesBrowserFixture(t *testing.T) {
	if os.Getenv("MESSAGES_BROWSER_FIXTURE") != "yes" {
		t.Skip("explicit browser fixture only")
	}
	cfg, e := pgxpool.ParseConfig(os.Getenv("TEST_DATABASE_URL"))
	if e != nil || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") || cfg.ConnConfig.Host != "/tmp" {
		t.Fatal("fresh local database required")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
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
	_, e = db.Exec(ctx, `INSERT INTO message_namespaces(namespace,otc_enabled) VALUES('browser_messages',true);INSERT INTO staff_grants SELECT '00000000-0000-0000-0000-000000000003',id,'accounts:read' FROM customers WHERE kind='personal';INSERT INTO message_grants SELECT 'browser_messages','00000000-0000-0000-0000-000000000003',c.id,p FROM customers c CROSS JOIN unnest(ARRAY['read','compose','publish','retry']) p WHERE c.kind='personal'`)
	if e != nil {
		t.Fatal(e)
	}
	svc := &messages.Service{DB: db, Namespace: "browser_messages", Key: []byte(strings.Repeat("fixture-only-", 3)), SendEnabled: true}
	order := uuid.NewString()
	payload, _ := json.Marshal(map[string]any{"id": order, "state": "processing", "amountMinor": "10000000", "currency": "USDT", "toCurrency": "USD", "receiveMinor": "990", "feeMinor": "0", "quote": map[string]string{"rate": "0.99"}})
	if _, e = db.Exec(ctx, `INSERT INTO crypto_orders(id,namespace,customer_id,kind,state,revision,data) VALUES($1,'browser_messages',$2,'otc','processing',1,$3)`, order, personal, payload); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, `UPDATE crypto_orders SET state='completed',revision=2,data=data||'{"state":"completed","postingStatus":"posted"}',updated_at=clock_timestamp() WHERE id=$1`, order); e != nil {
		t.Fatal(e)
	}
	go svc.Run(ctx)
	handler := (&Server{DB: db, Verifier: fakeVerifier{}, Messages: svc}).Handler()
	stopped := make(chan struct{}, 1)
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && r.URL.Path == "/__fixture/stop" {
			w.WriteHeader(200)
			select {
			case stopped <- struct{}{}:
			default:
			}
			return
		}
		if strings.Contains(r.URL.Path, "/messages") || strings.HasPrefix(r.URL.Path, "/admin-api/v1/message-campaigns") {
			handler.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	})}
	ln, e := net.Listen("tcp", "127.0.0.1:18746")
	if e != nil {
		t.Fatal(e)
	}
	go server.Serve(ln)
	t.Log("isolated message fixture ready on 127.0.0.1:18746")
	select {
	case <-stopped:
	case <-time.After(20 * time.Minute):
	}
	cancel()
	server.Close()
}

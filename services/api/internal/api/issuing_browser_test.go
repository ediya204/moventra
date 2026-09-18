package api

// Opt-in harness: actual HTTP API, PostgreSQL, Blnk and a separate worker process.
// Test credentials and loopback-only endpoints are never compiled into the API binary.
import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/cryptofunds"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/issuing"
	"moventra.local/api/internal/ledger"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestIssuingBrowserHarness(t *testing.T) {
	output := os.Getenv("ISSUING_BROWSER_OUTPUT")
	if output == "" {
		t.Skip("opt-in browser harness")
	}
	raw := os.Getenv("TEST_DATABASE_URL")
	cfg, e := pgxpool.ParseConfig(raw)
	if e != nil || cfg.ConnConfig.Host != "/tmp" || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("isolated local database required")
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
	if _, e = db.Exec(ctx, `UPDATE customers SET onboarding_status='approved',service_status='active' WHERE id=$1;`, personal); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, `INSERT INTO issuing_grants SELECT '00000000-0000-0000-0000-000000000003',scope,permission FROM (VALUES('catalog','catalog:read'),('catalog','catalog:write'),('catalog','pricing:write'),($1,'customer:read'),($1,'customer:write'),($1,'funding:submit'),($1,'funding:review'),($1,'recovery:write')) v(scope,permission)`, personal); e != nil {
		t.Fatal(e)
	}
	var mu sync.Mutex
	cards := map[string]map[string]any{}
	slash := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		reply := func(v any) { json.NewEncoder(w).Encode(v) }
		if r.URL.Path == "/transaction" {
			reply(map[string]any{"items": []any{}, "metadata": map[string]string{}})
			return
		}
		if r.URL.Path == "/card" && r.Method == "POST" {
			var v map[string]any
			if json.NewDecoder(r.Body).Decode(&v) != nil {
				w.WriteHeader(400)
				return
			}
			id := "fixture_" + uuid.NewString()
			v["id"] = id
			v["last4"] = "4321"
			v["status"] = "active"
			cards[id] = v
			reply(v)
			return
		}
		if r.URL.Path == "/card" {
			items := []any{}
			for _, v := range cards {
				items = append(items, v)
			}
			reply(map[string]any{"items": items, "metadata": map[string]string{}})
			return
		}
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) >= 2 && parts[0] == "card" {
			v := cards[parts[1]]
			if v == nil {
				w.WriteHeader(404)
				return
			}
			if len(parts) == 3 && r.Method == "PUT" {
				var constraint map[string]any
				json.NewDecoder(r.Body).Decode(&constraint)
				v["spendingConstraint"] = constraint
				reply(constraint)
				return
			}
			reply(v)
			return
		}
		w.WriteHeader(404)
	}))
	defer slash.Close()
	if os.Getenv("ISSUING_BROWSER_FAKE_BLNK") == "1" && os.Getenv("BLNK_TEST_URL") == "" {
		issuingBlnk(t)
	}
	unified := os.Getenv("ISSUING_BROWSER_UNIFIED") == "1"
	if unified {
		t.Setenv("ISSUING_FUNDING_SOURCE", "funds_wallet")
		t.Setenv("ISSUING_LOCAL_FUNDS_NAMESPACE", "live_issuing_test_browser")
	}
	sid := uuid.NewString()
	t.Setenv("ISSUING_MODE", "local")
	t.Setenv("ISSUING_FIXTURE_SUPPLIER_ID", sid)
	t.Setenv("ISSUING_FIXTURE_URL", slash.URL)
	t.Setenv("ISSUING_BLNK_URL", os.Getenv("BLNK_TEST_URL"))
	t.Setenv("ISSUING_BLNK_KEY", os.Getenv("BLNK_TEST_KEY"))
	svc, e := issuing.FromEnv(db)
	if e != nil {
		t.Fatal(e)
	}
	tx, e := db.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	// Keep the fixture ID configured in the worker identical to the persisted supplier.
	_, e = tx.Exec(ctx, `INSERT INTO issuing_suppliers(id,name,adapter,status,account_ref,entity_ref) VALUES($1,'隔离验收供应商','slash','active','fixture_account','fixture_entity')`, sid)
	if e != nil {
		t.Fatal(e)
	}
	product, e := issuing.SaveProduct(ctx, tx, issuing.Product{SupplierID: sid, Name: "USD 商务虚拟卡", BIN: "990001", Network: "visa", UpstreamID: "fixture_product", Status: "active", Description: "隔离验收产品，用于验证选择 BIN、支付及开卡流程。", FeeMinor: "500", MinimumMinor: "1000"})
	if e != nil {
		t.Fatal(e)
	}
	if e = issuing.SaveEnrollment(ctx, tx, issuing.Enrollment{CustomerID: personal, Enabled: true}); e != nil {
		t.Fatal(e)
	}
	dep := uuid.NewString()
	_, e = tx.Exec(ctx, `INSERT INTO issuing_deposits(id,customer_id,amount_minor,evidence_ref,submitted_by,reviewed_by,state) VALUES($1,$2,100000,'isolated-fixture','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','approved')`, dep, personal)
	if e != nil {
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	if unified {
		if _, e = db.Exec(ctx, `DELETE FROM issuing_deposits WHERE id=$1`, dep); e != nil {
			t.Fatal(e)
		}
		if _, e = db.Exec(ctx, `INSERT INTO channel_connections(id,account_ref,label) VALUES('issuing-browser','fixture_account','Isolated cards'); INSERT INTO project_wallets(project_key,connection_id,account_ref,virtual_account_ref,label,evidence_ref,actor_id) VALUES('moventra','issuing-browser','fixture_account','fixture_wallet','Isolated cards','fixture','00000000-0000-0000-0000-000000000003')`); e != nil {
			t.Fatal(e)
		}
		a, err := svc.Funds.Provision(ctx, ledger.AccountSpec{CustomerID: personal, Key: "clearing-USD", Kind: "clearing", Currency: "USD"})
		if err != nil {
			t.Fatal(err)
		}
		b, err := svc.Funds.Provision(ctx, ledger.AccountSpec{CustomerID: personal, Key: "wallet-USD", Kind: "wallet", Currency: "USD"})
		if err != nil {
			t.Fatal(err)
		}
		op, err := svc.Funds.Submit(ctx, ledger.Command{CustomerID: personal, EffectKey: "fixture-opening", Kind: "wallet_credit", SourceID: a.ID, DestinationID: b.ID, AmountMinor: "100000", EvidenceRef: "isolated-browser"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = svc.Funds.Process(ctx, personal, op.ID); err != nil {
			t.Fatal(err)
		}
	} else if e = svc.ProcessDeposit(ctx, dep); e != nil {
		t.Fatal(e)
	}
	var isolatedFunds *cryptofunds.Service
	if unified {
		isolatedFunds = &cryptofunds.Service{Ledger: svc.Funds, Live: &cryptofunds.LiveRuntime{Networks: map[string]cryptofunds.NetworkConfig{}}}
	}
	server := httptest.NewServer((&Server{DB: db, Verifier: issuingVerifier{}, Issuing: svc, Ledger: svc.Funds, ProductionFunds: isolatedFunds}).Handler())
	defer server.Close()
	workerPath := os.Getenv("ISSUING_WORKER_BINARY")
	if workerPath == "" {
		t.Fatal("separate worker binary required")
	}
	start := func() *exec.Cmd {
		cmd := exec.Command(workerPath)
		cmd.Env = append(os.Environ(), "DATABASE_URL="+raw)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if e := cmd.Start(); e != nil {
			t.Fatal(e)
		}
		return cmd
	}
	worker := start()
	defer func() { worker.Process.Signal(os.Interrupt); worker.Wait() }()
	data, _ := json.Marshal(map[string]string{"api": server.URL, "customerId": personal, "productId": product.ID})
	if e = os.WriteFile(output, data, 0600); e != nil {
		t.Fatal(e)
	}
	fmt.Println("issuing browser harness ready")
	// One intentional restart after reservation proves durable continuation.
	restarted := false
	deadline := time.Now().Add(15 * time.Minute)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(output + ".stop"); err == nil {
			return
		}
		if !restarted {
			var n int
			_ = db.QueryRow(ctx, `SELECT count(*) FROM issuing_orders WHERE state IN ('reserved','created','fee_charged')`).Scan(&n)
			if n > 0 {
				worker.Process.Signal(os.Interrupt)
				worker.Wait()
				worker = start()
				restarted = true
				fmt.Println("issuing worker restarted during order")
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	t.Fatal("browser harness timed out")
}

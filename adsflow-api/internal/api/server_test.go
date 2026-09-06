package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"adsflow.local/api/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

// No test-token implementation exists in the production binary.
type fakeVerifier struct{}

func (fakeVerifier) Verify(_ context.Context, token string) (Identity, error) {
	switch token {
	case "alice", "bob", "disabled", "staff", "new-user":
		return Identity{UID: token, MFA: true}, nil
	case "staff-no-mfa":
		return Identity{UID: "staff"}, nil
	default:
		return Identity{}, errors.New("invalid, expired or revoked credential")
	}
}

const personal = "10000000-0000-0000-0000-000000000001"
const business = "10000000-0000-0000-0000-000000000002"
const other = "10000000-0000-0000-0000-000000000003"
const seed = `
INSERT INTO users(id,firebase_uid,display_name,status) VALUES
('00000000-0000-0000-0000-000000000001','alice','Alice','active'),
('00000000-0000-0000-0000-000000000002','bob','Bob','active'),
('00000000-0000-0000-0000-000000000003','staff','Operator','active'),
('00000000-0000-0000-0000-000000000004','disabled','Disabled','disabled');
INSERT INTO customers(id,kind,name,personal_owner_id) VALUES
('10000000-0000-0000-0000-000000000001','personal','Alice personal','00000000-0000-0000-0000-000000000001'),
('10000000-0000-0000-0000-000000000002','business','Company A',NULL),
('10000000-0000-0000-0000-000000000003','personal','Bob personal','00000000-0000-0000-0000-000000000002');
INSERT INTO memberships(customer_id,user_id,role) VALUES
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','viewer');
INSERT INTO staff_grants(user_id,customer_id,permission) VALUES
('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','accounts:read');
INSERT INTO accounts(id,customer_id,name,status) VALUES
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Personal account','active'),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Company account','active'),
('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','Other customer secret','active');
INSERT INTO transactions(id,customer_id,account_id,currency,amount_minor,direction,status,occurred_at,source,external_id) VALUES
('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','USDT',9007199254740993,'credit','pending','2026-09-01T00:00:00Z','synthetic-test','1'),
('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','USD',100,'debit','succeeded','2026-08-31T00:00:00Z','synthetic-test','2');
`

func TestPostgresBoundary(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to an isolated adsflow_test_* database")
	}
	ctx := context.Background()
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(cfg.ConnConfig.Database, "adsflow_test_") {
		t.Fatal("refusing non-test database")
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatalf("migration replay: %v", err)
	}
	if _, err = pool.Exec(ctx, seed); err != nil {
		t.Fatal("use a fresh empty test database:", err)
	}
	handler := (&Server{DB: pool, Verifier: fakeVerifier{}}).Handler()
	request := func(method, path, token, body, key string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		if key != "" {
			r.Header.Set("Idempotency-Key", key)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	t.Run("registration boundaries and replay", func(t *testing.T) {
		w := request("GET", "/api/v1/me", "new-user", "", "")
		if w.Code != 403 || !strings.Contains(w.Body.String(), "registration_required") {
			t.Fatal(w.Code, w.Body)
		}
		for _, tc := range []struct {
			token, body string
			code        int
		}{
			{"", `{"name":"New"}`, 401},
			{"fake", `{"name":"New"}`, 401},
			{"new-user", `{"name":" "}`, 400},
			{"new-user", `{"name":"New","role":"admin"}`, 400},
			{"new-user", `{"name":"New","firebase_uid":"alice"}`, 400},
			{"new-user", `{"name":"New"} {}`, 400},
			{"disabled", `{"name":"New"}`, 403},
		} {
			w = request("POST", "/api/v1/register", tc.token, tc.body, "")
			if w.Code != tc.code {
				t.Fatalf("%s: %d %s", tc.token, w.Code, w.Body)
			}
		}
		var group sync.WaitGroup
		for i := 0; i < 6; i++ {
			group.Add(1)
			go func() {
				defer group.Done()
				w := request("POST", "/api/v1/register", "new-user", `{"name":"New"}`, "")
				if w.Code != 200 {
					t.Errorf("register: %d %s", w.Code, w.Body)
				}
			}()
		}
		group.Wait()
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE firebase_uid='new-user'`).Scan(&count); err != nil || count != 1 {
			t.Fatal(count, err)
		}
		var name string
		if err := pool.QueryRow(ctx, `SELECT display_name FROM users WHERE firebase_uid='disabled' AND status='disabled'`).Scan(&name); err != nil || name != "Disabled" {
			t.Fatal(name, err)
		}
		w = request("GET", "/api/v1/me", "new-user", "", "")
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"customers":[]`) || !strings.Contains(w.Body.String(), `"operator":false`) {
			t.Fatal(w.Code, w.Body)
		}
		w = request("GET", "/admin-api/v1/customers/"+business+"/accounts", "new-user", "", "")
		if w.Code != 404 {
			t.Fatal(w.Code, w.Body)
		}
	})
	for _, tc := range []struct {
		name, path, token string
		status            int
	}{
		{"health", "/healthz", "", 200},
		{"ready", "/readyz", "", 200},
		{"anonymous", "/api/v1/me", "", 401},
		{"unverified token", "/api/v1/me", "fake", 401},
		{"disabled local user", "/api/v1/me", "disabled", 403},
		{"personal owner", "/client-api/v1/customers/" + personal + "/accounts", "alice", 200},
		{"business member", "/client-api/v1/customers/" + business + "/accounts", "alice", 200},
		{"cross customer denied", "/client-api/v1/customers/" + other + "/accounts", "alice", 404},
		{"customer cannot become staff", "/admin-api/v1/customers/" + business + "/accounts", "alice", 404},
		{"staff has no implicit client access", "/client-api/v1/customers/" + business + "/accounts", "staff", 404},
		{"staff requires MFA", "/admin-api/v1/customers/" + business + "/accounts", "staff-no-mfa", 403},
		{"scoped staff grant", "/admin-api/v1/customers/" + business + "/accounts", "staff", 200},
		{"staff wrong resource denied", "/admin-api/v1/customers/" + business + "/transactions", "staff", 404},
		{"staff wrong customer denied", "/admin-api/v1/customers/" + other + "/accounts", "staff", 404},
		{"pagination bounded", "/client-api/v1/customers/" + personal + "/accounts?limit=101", "alice", 400},
		{"spoofed scope rejected", "/client-api/v1/customers/" + personal + "/accounts?customerId=" + other, "alice", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := request("GET", tc.path, tc.token, "", "")
			if w.Code != tc.status {
				t.Fatalf("%d: %s", w.Code, w.Body)
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("sensitive response cacheable")
			}
			if strings.Contains(w.Body.String(), "Other customer secret") {
				t.Fatal("cross-customer data leaked")
			}
		})
	}
	t.Run("identity returns both subject types", func(t *testing.T) {
		w := request("GET", "/api/v1/me", "alice", "", "")
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"kind":"personal"`) || !strings.Contains(w.Body.String(), `"kind":"business"`) {
			t.Fatal(w.Body.String())
		}
	})
	t.Run("amount precision and pagination", func(t *testing.T) {
		w := request("GET", "/client-api/v1/customers/"+personal+"/transactions?limit=1", "alice", "", "")
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"amountMinor":"9007199254740993"`) || !strings.Contains(w.Body.String(), `"scale":6`) || !strings.Contains(w.Body.String(), `"hasMore":true`) {
			t.Fatal(w.Body.String())
		}
		next := request("GET", "/client-api/v1/customers/"+personal+"/transactions?limit=1&offset=1", "alice", "", "")
		if !strings.Contains(next.Body.String(), `"currency":"USD"`) || !strings.Contains(next.Body.String(), `"hasMore":false`) {
			t.Fatal(next.Body.String())
		}
	})
	t.Run("revoked membership", func(t *testing.T) {
		if _, err = pool.Exec(ctx, `UPDATE memberships SET status='revoked'`); err != nil {
			t.Fatal(err)
		}
		w := request("GET", "/client-api/v1/customers/"+business+"/accounts", "alice", "", "")
		if w.Code != 404 {
			t.Fatal(w.Code)
		}
	})
	t.Run("audit is mandatory", func(t *testing.T) {
		var n int
		if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events`).Scan(&n); err != nil || n != 1 {
			t.Fatal(n, err)
		}
		if _, err = pool.Exec(ctx, `ALTER TABLE audit_events RENAME TO audit_events_unavailable`); err != nil {
			t.Fatal(err)
		}
		w := request("GET", "/admin-api/v1/customers/"+business+"/accounts", "staff", "", "")
		if _, err = pool.Exec(ctx, `ALTER TABLE audit_events_unavailable RENAME TO audit_events`); err != nil {
			t.Fatal(err)
		}
		if w.Code != 503 || strings.Contains(w.Body.String(), "Company account") {
			t.Fatal(w.Code, w.Body.String())
		}
	})
	t.Run("cross customer foreign key", func(t *testing.T) {
		_, err = pool.Exec(ctx, `INSERT INTO accounts(id,customer_id,parent_id,name,status) VALUES('20000000-0000-0000-0000-000000000004',$1,'20000000-0000-0000-0000-000000000003','bad parent','active')`, personal)
		if err == nil {
			t.Fatal("cross customer parent accepted")
		}
	})
	t.Run("personal cannot have enterprise memberships", func(t *testing.T) {
		_, err = pool.Exec(ctx, `INSERT INTO memberships(customer_id,user_id,role) VALUES($1,'00000000-0000-0000-0000-000000000002','owner')`, personal)
		if err == nil {
			t.Fatal("personal membership accepted")
		}
	})
	t.Run("upgrade submission idempotency and scope", func(t *testing.T) {
		path := "/client-api/v1/customers/" + personal + "/business-upgrade"
		key := "40000000-0000-0000-0000-000000000001"
		body := `{"legalName":"Example business"}`
		if w := request("POST", path, "bob", body, key); w.Code != 404 {
			t.Fatal(w.Code)
		}
		if w := request("POST", path, "alice", body, ""); w.Code != 400 {
			t.Fatal(w.Code)
		}
		var wg sync.WaitGroup
		results := make(chan *httptest.ResponseRecorder, 4)
		for i := 0; i < 4; i++ {
			wg.Add(1)
			go func() { defer wg.Done(); results <- request("POST", path, "alice", body, key) }()
		}
		wg.Wait()
		close(results)
		ids := map[string]bool{}
		created := 0
		for w := range results {
			if w.Code != 200 && w.Code != 201 {
				t.Fatal(w.Code, w.Body.String())
			}
			if w.Code == 201 {
				created++
			}
			var payload struct {
				Data upgrade `json:"data"`
			}
			if err = json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			ids[payload.Data.ID] = true
			if payload.Data.Status != "submitted" || payload.Data.BusinessCustomerID != nil {
				t.Fatal("submission activated business")
			}
		}
		if created != 1 || len(ids) != 1 {
			t.Fatal("duplicate submission", created, ids)
		}
		if w := request("POST", path, "alice", `{"legalName":"Changed"}`, key); w.Code != 409 {
			t.Fatal(w.Code)
		}
		if w := request("POST", path, "alice", body, "40000000-0000-0000-0000-000000000002"); w.Code != 409 {
			t.Fatal(w.Code)
		}
		if w := request("GET", path, "alice", "", ""); w.Code != 200 {
			t.Fatal(w.Code)
		}
		if w := request("GET", path, "bob", "", ""); w.Code != 404 {
			t.Fatal(w.Code)
		}
		var count int
		for _, check := range []struct {
			sql  string
			want int
		}{
			{`SELECT count(*) FROM business_upgrade_requests`, 1},
			{`SELECT count(*) FROM customers`, 3},
			{`SELECT count(*) FROM transactions`, 2},
			{`SELECT count(*) FROM audit_events WHERE action='business_upgrade:submit'`, 1},
		} {
			if err = pool.QueryRow(ctx, check.sql).Scan(&count); err != nil || count != check.want {
				t.Fatal(check.sql, count, err)
			}
		}
	})
	t.Run("migration checksum enforced", func(t *testing.T) {
		if _, err = pool.Exec(ctx, `UPDATE schema_migrations SET checksum='tampered' WHERE version=1`); err != nil {
			t.Fatal(err)
		}
		if err = database.Migrate(ctx, pool); err == nil {
			t.Fatal("checksum mismatch accepted")
		}
	})
	fmt.Println("isolated PostgreSQL boundary checks completed")
}

func TestNoAuthBeforeDatabase(t *testing.T) {
	handler := (&Server{Verifier: fakeVerifier{}}).Handler()
	for _, token := range []string{"", "fake"} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		handler.ServeHTTP(w, r)
		if w.Code != 401 {
			t.Fatal(w.Code)
		}
	}
}

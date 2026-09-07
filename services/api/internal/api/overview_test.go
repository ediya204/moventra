package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
)

func TestOverviewWindow(t *testing.T) {
	now := time.Date(2026, 9, 6, 16, 1, 2, 0, time.UTC)
	for _, days := range []int{7, 14, 30} {
		t.Run(fmt.Sprint(days), func(t *testing.T) {
			n, from, to, err := overviewWindow(url.Values{"days": {fmt.Sprint(days)}}, now)
			if err != nil || n != days || from.Hour() != 0 || from.Day() != now.Add(8*time.Hour).AddDate(0, 0, -(days-1)).Day() || !to.Equal(now) {
				t.Fatal(n, from, to, err)
			}
			_, offset := from.Zone()
			if offset != 8*60*60 {
				t.Fatal("not Hong Kong time")
			}
		})
	}
	for _, query := range []string{"days=0", "days=8", "days=31", "days=7&days=30", "customerId=other", "currency=USDT", "days=07"} {
		q, _ := url.ParseQuery(query)
		if _, _, _, err := overviewWindow(q, now); err == nil {
			t.Fatal("accepted invalid query", query)
		}
	}
}

func TestOverviewExactAmountsAndUnknownDays(t *testing.T) {
	_, from, to, _ := overviewWindow(url.Values{"days": {"7"}}, time.Date(2026, 9, 7, 4, 0, 0, 0, time.UTC))
	in, out := "18446744073709551614", "9007199254740993"
	result, err := buildOverview(7, from, to, []overviewDaily{{Date: "2026-09-07", IncomingMinor: &in, OutgoingMinor: &out, Posted: 3, Pending: 1, Failed: 2, Total: 6}})
	if err != nil || result.Totals.IncomingMinor != in || result.Totals.NetMinor != "18437736874454810621" || result.Totals.Transactions != 6 {
		t.Fatal(result, err)
	}
	if len(result.Daily) != 7 || result.Daily[0].IncomingMinor != nil || *result.Daily[6].NetMinor != result.Totals.NetMinor {
		t.Fatal(result.Daily)
	}
	if result.Coverage.Complete || result.Sync.LastSuccessAt != nil || result.Totals.ActiveCards != nil || result.Availability.Customers {
		t.Fatal("unsupported data presented as available")
	}
	bad := "1.5"
	if _, err = buildOverview(7, from, to, []overviewDaily{{IncomingMinor: &bad, OutgoingMinor: &out}}); err == nil {
		t.Fatal("accepted invalid amount")
	}
}

func TestOverviewRejectsMalformedRawQuery(t *testing.T) {
	for _, query := range []string{"days=7;bad=1", "days=%zz", "days=7&bad=%"} {
		t.Run(query, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/admin-api/v1/ops/overview?"+query, nil)
			r = r.WithContext(context.WithValue(r.Context(), principalKey{}, principal{Identity: Identity{MFA: true}}))
			w := httptest.NewRecorder()
			// Malformed input must be rejected before any database query. URL.Query
			// silently discards invalid fields, so it cannot enforce this contract.
			(&Server{}).opsOverview(w, r)
			if w.Code != 400 || !strings.Contains(w.Body.String(), "invalid_query") {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
}

func TestOverviewPostgres(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set TEST_DATABASE_URL to an isolated moventra_test_* database")
	}
	ctx := context.Background()
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("refusing non-test database", err)
	}
	// The existing integration suite mutates its own public schema. This suite
	// uses an independent schema in the same disposable local test database.
	admin, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := "overview_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, `DROP SCHEMA `+schema+` CASCADE`)
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, seed); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `DELETE FROM transactions`); err != nil {
		t.Fatal(err)
	}
	handler := (&Server{DB: pool, Verifier: fakeVerifier{}}).Handler()
	request := func(path, token string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, path, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		handler.ServeHTTP(w, r)
		return w
	}
	path := "/admin-api/v1/ops/overview?days=7"
	t.Run("authentication MFA and default deny", func(t *testing.T) {
		for _, tc := range []struct {
			token string
			code  int
		}{{"", 401}, {"fake", 401}, {"disabled", 403}, {"staff-no-mfa", 403}, {"alice", 403}, {"staff", 403}} {
			w := request(path, tc.token)
			if w.Code != tc.code {
				t.Fatal(tc, w.Code, w.Body.String())
			}
		}
	})
	if _, err = pool.Exec(ctx, `INSERT INTO staff_grants(user_id,customer_id,permission) VALUES('00000000-0000-0000-0000-000000000003',$1,'transactions:read')`, personal); err != nil {
		t.Fatal(err)
	}
	_, from, _, _ := overviewWindow(url.Values{"days": {"7"}}, time.Now())
	insert := func(customerID, accountSuffix, amount, direction, state, currency string, at time.Time) {
		t.Helper()
		id := uuid.NewString()
		_, err := pool.Exec(ctx, `INSERT INTO transactions(id,customer_id,account_id,currency,amount_minor,direction,status,occurred_at,source,external_id) VALUES($1,$2,$3,$4,$5::text::bigint,$6,$7,$8,'overview-fixture',$9)`, id, customerID, "20000000-0000-0000-0000-"+accountSuffix, currency, amount, direction, state, at, id)
		if err != nil {
			t.Fatal(err)
		}
	}
	insert(personal, "000000000001", "9223372036854775807", "credit", "succeeded", "USD", from)
	insert(personal, "000000000001", "9223372036854775807", "credit", "succeeded", "USD", from.Add(time.Second))
	insert(personal, "000000000001", "9007199254740993", "debit", "succeeded", "USD", from.Add(time.Second))
	insert(personal, "000000000001", "12345", "debit", "pending", "USD", from.Add(time.Second))
	insert(personal, "000000000001", "54321", "credit", "failed", "USD", from.Add(time.Second))
	insert(personal, "000000000001", "999999", "credit", "succeeded", "USDT", from.Add(time.Second))
	insert(personal, "000000000001", "888888", "credit", "succeeded", "USD", from.Add(-time.Microsecond))
	insert(personal, "000000000001", "777777", "credit", "succeeded", "USD", time.Now().Add(time.Hour))
	insert(business, "000000000002", "666666", "credit", "succeeded", "USD", from.Add(time.Second))
	insert(other, "000000000003", "555555", "credit", "succeeded", "USD", from.Add(time.Second))
	var overview operationsOverview
	t.Run("authorized projection aggregate is precise bounded and currency isolated", func(t *testing.T) {
		w := request(path, "staff")
		if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(w.Code, w.Body.String())
		}
		var payload struct {
			Data operationsOverview `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		overview = payload.Data
		if overview.Totals.Transactions != 5 || overview.Totals.IncomingMinor != "18446744073709551614" || overview.Totals.OutgoingMinor != "9007199254740993" || overview.Totals.NetMinor != "18437736874454810621" {
			t.Fatal(overview.Totals)
		}
		if overview.Totals.Posted != 3 || overview.Totals.Pending != 1 || overview.Totals.Failed != 1 || len(overview.Daily) != 7 || overview.Daily[0].Total != 5 || overview.Daily[1].IncomingMinor != nil {
			t.Fatal(overview)
		}
		if len(overview.Currencies) != 1 || overview.Currencies[0].Code != "USD" || overview.Totals.Customers != nil || overview.Totals.ActiveCards != nil || overview.Availability.Merchants {
			t.Fatal("unsupported metadata leaked", overview)
		}
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE customer_id=$1 AND action='transactions:overview:read'`, personal).Scan(&count); err != nil || count != 1 {
			t.Fatal("missing scoped audit", count, err)
		}
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE customer_id<>$1`, personal).Scan(&count); err != nil || count != 0 {
			t.Fatal("audited unauthorized customer", count, err)
		}
	})
	t.Run("scope spoofing rejected and refresh version is content based", func(t *testing.T) {
		for _, query := range []string{"days=31", "days=7&customerId=" + other, "currency=USDT", "days=7&days=14", "days=7;bad=1", "days=%zz", "days=7&bad=%"} {
			if w := request("/admin-api/v1/ops/overview?"+query, "staff"); w.Code != 400 {
				t.Fatal(query, w.Code, w.Body.String())
			}
		}
		var payload struct {
			Data operationsOverview `json:"data"`
		}
		w := request(path, "staff")
		if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil || payload.Data.Revision != overview.Revision {
			t.Fatal("same snapshot changed revision", err, w.Body.String())
		}
		if _, err := pool.Exec(ctx, `UPDATE transactions SET status='succeeded' WHERE customer_id=$1 AND status='pending'`, personal); err != nil {
			t.Fatal(err)
		}
		w = request(path, "staff")
		if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil || payload.Data.Revision == overview.Revision || payload.Data.Totals.Posted != 4 || payload.Data.Totals.OutgoingMinor != "9007199254753338" {
			t.Fatal("status change not reflected once", err, w.Body.String())
		}
	})
	t.Run("mandatory audit fails closed", func(t *testing.T) {
		if _, err := pool.Exec(ctx, `ALTER TABLE audit_events RENAME TO audit_events_unavailable`); err != nil {
			t.Fatal(err)
		}
		w := request(path, "staff")
		if _, err := pool.Exec(ctx, `ALTER TABLE audit_events_unavailable RENAME TO audit_events`); err != nil {
			t.Fatal(err)
		}
		if w.Code != 503 || strings.Contains(w.Body.String(), "incomingMinor") {
			t.Fatal("audit failure leaked data", w.Code, w.Body.String())
		}
	})
	t.Run("revoked permission takes effect on next request", func(t *testing.T) {
		if _, err := pool.Exec(ctx, `DELETE FROM staff_grants WHERE permission='transactions:read'`); err != nil {
			t.Fatal(err)
		}
		if w := request(path, "staff"); w.Code != 403 {
			t.Fatal(w.Code, w.Body.String())
		}
	})
}

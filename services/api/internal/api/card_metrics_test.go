package api

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/projection"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestCardMetricsQueryAndRefreshIsolation(t *testing.T) {
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
	bundle := projection.Bundle{ConnectionID: "metric-source", AccountID: "account", Label: "Fixture", SourceAt: "2026-09-18T00:00:00Z", Records: []projection.Record{{Kind: "card", Data: map[string]any{"id": "card", "accountId": "account", "virtualAccountId": "wallet", "last4": "1234"}}}}
	rev, e := projection.Import(ctx, db, bundle, "staff")
	if e != nil {
		t.Fatal(e)
	}
	input := database.WalletAssignment{ConnectionID: bundle.ConnectionID, AccountID: "account", VirtualAccountID: "wallet", Label: "Fixture", Revision: rev, CardIDs: []string{"card"}, Reason: "fixture only", EvidenceRef: "synthetic"}
	plan, e := database.AssignProjectWalletCards(ctx, db, "staff", "alice", input, "", false)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = database.AssignProjectWalletCards(ctx, db, "staff", "alice", input, plan.SHA256, true); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, `INSERT INTO slash_hook_connections(id,account_ref,endpoint) VALUES('metric-hook','account','metric-endpoint');INSERT INTO card_sync_links(connection_id,hook_connection_id) VALUES('metric-source','metric-hook')`); e != nil {
		t.Fatal(e)
	}

	_, e = db.Exec(ctx, `INSERT INTO card_metric_scopes(connection_id,external_card_id,customer_id,account_ref,virtual_account_ref,binding_created_at) SELECT b.connection_id,b.external_card_id,b.customer_id,'account',b.virtual_account_ref,b.created_at FROM project_wallet_cards b;
 INSERT INTO card_metric_runs(id,connection_id,external_card_id,from_at,to_at,purpose,state,completed_at) VALUES('90000000-0000-4000-8000-000000000001','metric-source','card','2026-08-20','2026-09-19','recent','done',now());
 INSERT INTO card_source_transactions(connection_id,external_id,external_card_id,account_ref,virtual_account_ref,amount_minor,source_date,status,detailed_status,category_verified,data,observed_at) VALUES
 ('metric-source','purchase','card','account','wallet',-123,'2026-09-18','posted','settled',true,'{"id":"purchase","cardId":"card","accountId":"account","virtualAccountId":"wallet","amountCents":"-123","date":"2026-09-18T00:00:00Z","status":"posted","detailedStatus":"settled"}',now()),
 ('metric-source','refund','card','account','wallet',50,'2026-09-18','posted','refund',true,'{"id":"refund","cardId":"card","accountId":"account","virtualAccountId":"wallet","amountCents":"50","date":"2026-09-18T00:00:00Z","status":"posted","detailedStatus":"refund"}',now())`)
	if e != nil {
		t.Fatal(e)
	}
	h := (&Server{DB: db, Verifier: fakeVerifier{}, CardMetricsEnabled: true}).Handler()
	base := "/client-api/v1/customers/" + personal + "/card-projections/metric-source"
	request := func(method, path, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, base+path, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	w := request("GET", "/cards/card", "alice")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var body struct {
		Data struct{ Rows []map[string]json.RawMessage }
	}
	if json.Unmarshal(w.Body.Bytes(), &body) != nil {
		t.Fatal("invalid result")
	}
	var metrics map[string]any
	json.Unmarshal(body.Data.Rows[0]["metrics"], &metrics)
	if metrics["spendingMinor"] != "123" || metrics["refundMinor"] != "50" {
		t.Fatal(metrics)
	}
	if strings.Contains(w.Body.String(), "accountId") || strings.Contains(w.Body.String(), "virtualAccountId") {
		t.Fatal("source identifiers leaked")
	}
	w = request("GET", "/transactions?metric=spending&cardId=card&from=2026-08-20T00:00:00Z&to=2026-09-19T00:00:00Z", "alice")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"total":1`) || strings.Contains(w.Body.String(), `"id":"refund"`) {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, token := range []string{"bob", "staff"} {
		w = request("POST", "/cards/card/metrics-sync", token)
		if w.Code != 404 && w.Code != 403 {
			t.Fatal("unauthorized refresh", token, w.Code)
		}
	}
	w = request("POST", "/cards/card/metrics-sync", "alice")
	if w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = request("POST", "/cards/card/metrics-sync", "alice")
	if w.Code != 202 {
		t.Fatal(w.Code)
	}
	var count int
	db.QueryRow(ctx, `SELECT count(*) FROM card_metric_refreshes`).Scan(&count)
	if count != 1 {
		t.Fatal("duplicate tasks", count)
	}
	w = request("GET", "/cards?metric=spending", "alice")
	if w.Code != 400 {
		t.Fatal("card query accepted metric")
	}
	_, e = db.Exec(ctx, `DELETE FROM project_wallet_cards`)
	if e != nil {
		t.Fatal(e)
	}
	w = request("POST", "/cards/card/metrics-sync", "alice")
	if w.Code != 404 {
		t.Fatal("revoked scope", w.Code)
	}
}

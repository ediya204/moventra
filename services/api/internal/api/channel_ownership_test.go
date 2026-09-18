package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/projection"
)

func TestAdminChannelOwnership(t *testing.T) {
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
	b := projection.Bundle{ConnectionID: "owner-source", AccountID: "account", Label: "Synthetic", SourceAt: "2026-09-18T00:00:00Z"}
	card := func(id string) projection.Record {
		return projection.Record{Kind: "card", Data: map[string]any{"id": id, "accountId": b.AccountID, "virtualAccountId": "wallet", "cardName": "Random Name", "last4": "1234"}}
	}
	for i := 0; i < 25; i++ {
		b.Records = append(b.Records, card(fmt.Sprintf("card-%02d", i)))
	}
	b.Records = append(b.Records, projection.Record{Kind: "transaction", Data: map[string]any{"id": "tx", "cardId": "card-00", "accountId": b.AccountID, "virtualAccountId": "wallet", "date": b.SourceAt, "amountCents": "-9007199254740993"}})
	importBundle := func(in projection.Bundle) string {
		t.Helper()
		rev, err := projection.Import(ctx, db, in, "staff")
		if err != nil {
			t.Fatal(err)
		}
		return rev
	}
	rev := importBundle(b)
	h := (&Server{DB: db, Verifier: fakeVerifier{}}).Handler()
	request := func(path, token string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	base := "/admin-api/v1/channel-projections/owner-source/"
	rows := func(path string) []map[string]any {
		t.Helper()
		w := request(path, "staff")
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		var d struct {
			Data struct {
				Rows []map[string]any `json:"rows"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &d); err != nil {
			t.Fatal(err)
		}
		return d.Data.Rows
	}
	check := func(path, kind, status, name string) {
		t.Helper()
		rr := rows(path)
		if len(rr) == 0 {
			t.Fatal("missing rows", path)
		}
		for _, r := range rr {
			owner, ok := r["internal"].(map[string]any)
			if !ok || owner["ownershipStatus"] != status || r["assignmentKind"] != kind {
				t.Fatal(path, r)
			}
			if name != "" {
				if owner["customerName"] != name || owner["customerId"] != personal || owner["userId"] != "00000000-0000-0000-0000-000000000001" {
					t.Fatal("wrong identity", r)
				}
			} else if owner["customerId"] != nil || owner["userId"] != nil || owner["customerName"] != nil {
				t.Fatal("identity leak", r)
			}
		}
	}
	check(base+"cards/card-00", "unassigned", "unassigned", "")
	if _, e = database.BindCardSnapshot(ctx, db, "alice", b.ConnectionID, rev, "synthetic snapshot", 25); e != nil {
		t.Fatal(e)
	}
	check(base+"cards/card-00", "test_snapshot", "restricted", "")
	if _, e = db.Exec(ctx, `INSERT INTO staff_grants(user_id,customer_id,permission) VALUES('00000000-0000-0000-0000-000000000003',$1,'accounts:read')`, personal); e != nil {
		t.Fatal(e)
	}
	for _, path := range []string{"cards", "cards?page=1", "cards/card-00", "transactions", "transactions/tx"} {
		check(base+path, "test_snapshot", "bound", "Alice")
	}
	if len(rows(base+"cards")) != 20 || len(rows(base+"cards?page=1")) != 5 {
		t.Fatal("pagination changed")
	}
	// Connection collisions and names/tails cannot copy ownership.
	collision := b
	collision.ConnectionID = "owner-other"
	collision.Records = []projection.Record{card("card-00")}
	importBundle(collision)
	check("/admin-api/v1/channel-projections/owner-other/cards/card-00", "unassigned", "unassigned", "")
	// A refreshed source revision retains the legacy binding identity too.
	b.SourceAt = "2026-09-18T00:30:00Z"
	rev = importBundle(b)
	check(base+"cards/card-00", "test_snapshot", "bound", "Alice")
	input := database.WalletAssignment{ConnectionID: b.ConnectionID, AccountID: b.AccountID, VirtualAccountID: "wallet", Label: "Synthetic wallet", Revision: rev, CardIDs: []string{"card-00"}, Reason: "synthetic reviewed assignment", EvidenceRef: "test/owner"}
	plan, e := database.AssignProjectWalletCards(ctx, db, "staff", "alice", input, "", false)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = database.AssignProjectWalletCards(ctx, db, "staff", "alice", input, plan.SHA256, true); e != nil {
		t.Fatal(e)
	}
	for _, path := range []string{"cards/card-00", "transactions/tx"} {
		check(base+path, "project_wallet", "bound", "Alice")
	}
	check(base+"cards/card-01", "unassigned", "unassigned", "") // superseded broad snapshot
	// New imports and duplicate imports never delete or expand explicit assignments.
	b.SourceAt = "2026-09-18T01:00:00Z"
	b.Records = append(b.Records, card("new-card"))
	importBundle(b)
	importBundle(b)
	check(base+"cards/card-00", "project_wallet", "bound", "Alice")
	check(base+"cards/new-card", "unassigned", "unassigned", "")
	if _, e = db.Exec(ctx, `UPDATE users SET display_name='Alice updated' WHERE firebase_uid='alice'`); e != nil {
		t.Fatal(e)
	}
	check(base+"cards/card-00", "project_wallet", "bound", "Alice updated")
	// Wrong or absent source wallet metadata must not expose an existing identity.
	b.SourceAt = "2026-09-18T02:00:00Z"
	b.Records[0].Data["virtualAccountId"] = "wrong-wallet"
	delete(b.Records[25].Data, "virtualAccountId")
	importBundle(b)
	check(base+"cards/card-00", "project_wallet", "scope_mismatch", "")
	check(base+"transactions/tx", "project_wallet", "scope_mismatch", "")
	b.SourceAt = "2026-09-18T03:00:00Z"
	b.Records[0].Data["virtualAccountId"] = "wallet"
	b.Records[25].Data["virtualAccountId"] = "wallet"
	importBundle(b)
	client := request("/client-api/v1/customers/"+personal+"/card-projections/owner-source/cards", "alice")
	if client.Code != 200 || strings.Contains(client.Body.String(), "internal") || strings.Contains(client.Body.String(), "Alice updated") || strings.Contains(client.Body.String(), "assignmentKind") {
		t.Fatal("client identity leak", client.Code, client.Body.String())
	}
	for _, token := range []string{"alice", "staff-no-mfa"} {
		w := request(base+"cards/card-00", token)
		if w.Code != 403 || strings.Contains(w.Body.String(), "Alice") {
			t.Fatal("access leak", w.Code, w.Body.String())
		}
	}
	if _, e = db.Exec(ctx, `DELETE FROM staff_grants WHERE user_id='00000000-0000-0000-0000-000000000003' AND customer_id=$1 AND permission='accounts:read'`, personal); e != nil {
		t.Fatal(e)
	}
	check(base+"cards/card-00", "project_wallet", "restricted", "")
	if _, e = db.Exec(ctx, `DELETE FROM channel_read_grants WHERE connection_id='owner-source'`); e != nil {
		t.Fatal(e)
	}
	if w := request(base+"cards/card-00", "staff"); w.Code != 404 || strings.Contains(w.Body.String(), "Alice") {
		t.Fatal("revoked connection", w.Code)
	}
	if _, e = db.Exec(ctx, `INSERT INTO channel_read_grants VALUES('owner-source','00000000-0000-0000-0000-000000000003')`); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, `ALTER TABLE channel_read_audit ADD CONSTRAINT deny_owner_audit CHECK(false) NOT VALID`); e != nil {
		t.Fatal(e)
	}
	defer db.Exec(ctx, `ALTER TABLE channel_read_audit DROP CONSTRAINT deny_owner_audit`)
	if w := request(base+"cards/card-00", "staff"); w.Code != 503 || strings.Contains(w.Body.String(), "Alice") {
		t.Fatal("audit fail open", w.Code, w.Body.String())
	}
}

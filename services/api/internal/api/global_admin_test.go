package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
)

func TestGlobalAdminScopesAndRevocation(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("isolated PostgreSQL required")
	}
	cfg, e := pgxpool.ParseConfig(raw)
	if e != nil || cfg.ConnConfig.Host != "/tmp" || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("unsafe database")
	}
	ctx := context.Background()
	base, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer base.Close()
	schema := "global_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = base.Exec(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer base.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = database.Migrate(ctx, db); e != nil {
		t.Fatal(e)
	}
	if e = database.MigrateGlobalAdmin(ctx, db); e != nil {
		t.Fatal(e)
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, e := db.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec(seed)
	staff := "00000000-0000-0000-0000-000000000003"
	if e = database.SetGlobalAdmin(ctx, db, "alice", "test", true); e == nil {
		t.Fatal("customer promoted")
	}
	handler := (&Server{DB: db, Verifier: fakeVerifier{}}).Handler()
	get := func(path, token string, want int) string {
		t.Helper()
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: %d %s", token, path, w.Code, w.Body)
		}
		return w.Body.String()
	}
	path := "/admin-api/v1/customers/" + personal + "/accounts"
	get(path, "staff", 404)
	for i := 0; i < 2; i++ {
		if e = database.SetGlobalAdmin(ctx, db, "staff", "test-global", true); e != nil {
			t.Fatal(e)
		}
	}
	var n int
	if e = db.QueryRow(ctx, `SELECT count(*) FROM global_admin_audit`).Scan(&n); e != nil || n != 1 {
		t.Fatal("non-idempotent audit", n, e)
	}
	get(path, "staff", 200)
	get(path, "staff-no-mfa", 403)
	get(path, "alice", 403)
	get("/client-api/v1/customers/"+personal+"/accounts", "staff", 403)
	get("/admin-api/v1/customers/"+personal+"/onboarding", "staff", 200)
	get("/admin-api/v1/card-issuing/products", "staff", 200)
	// A customer and connection created AFTER authorization are visible without a grant job.
	future := uuid.NewString()
	exec(`INSERT INTO customers(id,kind,name) VALUES($1,'business','Future customer')`, future)
	exec(`INSERT INTO channel_connections(id,account_ref,label,revision,source_at,imported_at) VALUES('future','account','Future channel','r1',now(),now())`)
	get("/admin-api/v1/customers/"+future+"/accounts", "staff", 200)
	if !strings.Contains(get("/admin-api/v1/channel-projections", "staff", 200), "Future channel") {
		t.Fatal("future channel missing")
	}
	var me map[string]any
	if e = json.Unmarshal([]byte(get("/admin-api/v1/me", "staff", 200)), &me); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(get("/admin-api/v1/me", "staff", 200), future) {
		t.Fatal("scope discovery incomplete")
	}
	if me["data"].(map[string]any)["globalAdmin"] != true {
		t.Fatal("missing global indicator")
	}
	if strings.Contains(get("/admin-api/v1/me", "staff-no-mfa", 200), `"globalAdmin":true`) {
		t.Fatal("MFA bypass in discovery")
	}
	// Namespace-specific crypto scopes, all backend configuration and future ledger scopes.
	queries := []string{
		`SELECT count(*) FROM effective_crypto_grants('live_new') WHERE user_id=$1 AND customer_id='10000000-0000-0000-0000-000000000001'`,
		`SELECT count(*) FROM effective_manual_funds_grants WHERE user_id=$1`,
		`SELECT count(*) FROM effective_issuing_grants WHERE user_id=$1 AND scope_id='catalog'`,
		`SELECT count(*) FROM effective_ledger_read_grants WHERE user_id=$1`,
	}
	for i, q := range queries {
		if e = db.QueryRow(ctx, q, staff).Scan(&n); e != nil || n != []int{4, 4, 3, 4}[i] {
			t.Fatalf("scope %d: %d %v", i, n, e)
		}
	}
	exec(`INSERT INTO crypto_sync(namespace,connection_id,project_id,mode) VALUES('live_new','future-cregis','project','observation')`)
	if e = db.QueryRow(ctx, `SELECT count(*) FROM effective_crypto_connection_grants WHERE user_id=$1`, staff).Scan(&n); e != nil || n != 2 {
		t.Fatal("future source", n, e)
	}
	exec(`UPDATE users SET status='disabled' WHERE id=$1`, staff)
	get(path, "staff", 403)
	exec(`UPDATE users SET status='active' WHERE id=$1`, staff)
	// Failure to append audit must roll back privilege changes.
	exec(`CREATE FUNCTION reject_global_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test'; END $$; CREATE TRIGGER reject_global_audit BEFORE INSERT ON global_admin_audit FOR EACH ROW EXECUTE FUNCTION reject_global_audit()`)
	if e = database.SetGlobalAdmin(ctx, db, "staff", "revoke-test", false); e == nil {
		t.Fatal("audit failure accepted")
	}
	get(path, "staff", 200)
	exec(`DROP TRIGGER reject_global_audit ON global_admin_audit`)
	if e = database.SetGlobalAdmin(ctx, db, "staff", "revoke-test", false); e != nil {
		t.Fatal(e)
	}
	get(path, "staff", 404)
	get("/admin-api/v1/customers/"+business+"/accounts", "staff", 200) // original scope preserved
	get("/admin-api/v1/card-issuing/products", "staff", 404)
	exec(`UPDATE schema_migrations SET checksum='bad' WHERE version=19`)
	if database.MigrateGlobalAdmin(ctx, db) == nil {
		t.Fatal("changed migration accepted")
	}
}

package api

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"os"
	"strings"
	"testing"
)

func TestExistingOnboardingGrants(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated database required")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("refusing non-test DB")
	}
	ctx := context.Background()
	base, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	if _, err = base.Exec(ctx, `CREATE SCHEMA onboarding_grants`); err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = "onboarding_grants"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, seed); err != nil {
		t.Fatal(err)
	}

	if _, err = pool.Exec(ctx, `INSERT INTO staff_grants VALUES
 ('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','accounts:read'),
 ('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','transactions:read'),
 ('00000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','accounts:read'),
 ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','accounts:read')`); err != nil {
		t.Fatal(err)
	}
	n, err := database.GrantExistingOnboarding(ctx, pool)
	if err != nil || n != 1 {
		t.Fatal(n, err)
	}
	n, err = database.GrantExistingOnboarding(ctx, pool)
	if err != nil || n != 0 {
		t.Fatal(n, err)
	}
	var grants, audits int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM staff_grants WHERE permission='onboarding:review'`).Scan(&grants); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action LIKE 'staff:provision:user-request:%:onboarding:review:existing-scope'`).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if grants != 1 || audits != 1 {
		t.Fatal(grants, audits)
	}
	// Existing stale grants must not restore a downgraded customer's staff scope.
	if _, err = pool.Exec(ctx, `DELETE FROM staff_grants WHERE permission='onboarding:review'; UPDATE users SET role='customer' WHERE firebase_uid='staff'`); err != nil {
		t.Fatal(err)
	}
	if n, err = database.GrantExistingOnboarding(ctx, pool); err != nil || n != 0 {
		t.Fatal("demoted identity granted", n, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE users SET role='admin' WHERE firebase_uid='staff'`); err != nil {
		t.Fatal(err)
	}
	// An audit failure must undo every new permission.
	if _, err = pool.Exec(ctx, `DELETE FROM staff_grants WHERE permission='onboarding:review';CREATE FUNCTION reject_grant_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$;CREATE TRIGGER reject_grant_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_grant_audit()`); err != nil {
		t.Fatal(err)
	}
	if _, err = database.GrantExistingOnboarding(ctx, pool); err == nil {
		t.Fatal("expected audit failure")
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM staff_grants WHERE permission='onboarding:review'`).Scan(&grants); err != nil || grants != 0 {
		t.Fatal(grants, err)
	}
}

package database

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
	"testing"
)

func TestRoleMigration(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("isolated database required")
	}
	cfg, err := pgxpool.ParseConfig(raw)
	if err != nil || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("refusing non-test database")
	}
	ctx := context.Background()
	base, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	schema := "roles_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = base.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	defer base.Exec(ctx, `DROP SCHEMA `+schema+` CASCADE`)
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err = pool.Exec(ctx, initial); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `CREATE TABLE schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())`); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES(1,$1)`, fmt.Sprintf("%x", sha256.Sum256([]byte(initial)))); err != nil {
		t.Fatal(err)
	}
	// Reproduce the deployed 001/002/003 baseline before applying 004.
	for i, sql := range []string{channelProjection, onboarding} {
		if _, err = pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)`, i+2, fmt.Sprintf("%x", sha256.Sum256([]byte(sql)))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = pool.Exec(ctx, `
 INSERT INTO users(id,firebase_uid,display_name) VALUES
 ('00000000-0000-0000-0000-000000000001','customer','Customer'),
 ('00000000-0000-0000-0000-000000000002','staff','Staff');
 INSERT INTO customers(id,kind,name,personal_owner_id) VALUES
 ('10000000-0000-0000-0000-000000000001','personal','Customer','00000000-0000-0000-0000-000000000001');
 INSERT INTO staff_grants(user_id,customer_id,permission) VALUES
 ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','accounts:read');
 `); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO staff_grants(user_id,customer_id,permission) VALUES('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','onboarding:review');INSERT INTO channel_connections(id,account_ref,label) VALUES('existing','existing','Existing');INSERT INTO channel_read_grants(connection_id,user_id) VALUES('existing','00000000-0000-0000-0000-000000000002');INSERT INTO onboarding_events(customer_id,actor_id,action,reason,revision) VALUES('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','approve_activate','Existing approval',1)`); err != nil {
		t.Fatal(err)
	}
	// Mixed legacy identity blocks migration atomically.
	if _, err = pool.Exec(ctx, `INSERT INTO customers(id,kind,name,personal_owner_id) VALUES('10000000-0000-0000-0000-000000000002','personal','Mixed','00000000-0000-0000-0000-000000000002')`); err != nil {
		t.Fatal(err)
	}
	if err = Migrate(ctx, pool); err == nil {
		t.Fatal("mixed identity accepted")
	}
	if _, err = pool.Exec(ctx, `DELETE FROM customers WHERE name='Mixed'`); err != nil {
		t.Fatal(err)
	}
	if err = Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	for uid, want := range map[string]string{"customer": "customer", "staff": "admin"} {
		var role string
		if err = pool.QueryRow(ctx, `SELECT role FROM users WHERE firebase_uid=$1`, uid).Scan(&role); err != nil || role != want {
			t.Fatal(uid, role, err)
		}
	}
	var grants int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM staff_grants`).Scan(&grants); err != nil || grants != 2 {
		t.Fatal("grants changed", grants, err)
	}
	var channels, approvals, versions int
	if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM channel_read_grants),(SELECT count(*) FROM onboarding_events),(SELECT count(*) FROM schema_migrations)`).Scan(&channels, &approvals, &versions); err != nil || channels != 1 || approvals != 1 || versions != 4 {
		t.Fatal("prior production data changed", channels, approvals, versions, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE users SET role='reviewer' WHERE firebase_uid='staff'`); err == nil {
		t.Fatal("third role accepted")
	}
	if _, err = pool.Exec(ctx, `UPDATE users SET role='customer' WHERE firebase_uid='staff'`); err != nil {
		t.Fatal(err)
	}
	if err = Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var role string
	if err = pool.QueryRow(ctx, `SELECT role FROM users WHERE firebase_uid='staff'`).Scan(&role); err != nil || role != "customer" {
		t.Fatal("replay revived administrator", role, err)
	}
	if _, err = pool.Exec(ctx, `CREATE FUNCTION deny_role_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='identity:role:admin:provision' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER deny_role_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_role_audit()`); err != nil {
		t.Fatal(err)
	}
	if _, err = ProvisionOperator(ctx, pool, "staff", "customer"); err == nil {
		t.Fatal("role change accepted without audit")
	}
	if err = pool.QueryRow(ctx, `SELECT role FROM users WHERE firebase_uid='staff'`).Scan(&role); err != nil || role != "customer" {
		t.Fatal("role change not rolled back", role, err)
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER deny_role_audit ON audit_events; DROP FUNCTION deny_role_audit()`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err = ProvisionOperator(ctx, pool, "staff", "customer"); err != nil {
			t.Fatal(err)
		}
	}
	var audits int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action='identity:role:admin:provision'`).Scan(&audits); err != nil || audits != 1 {
		t.Fatal("role audit not idempotent", audits, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE schema_migrations SET checksum='tampered' WHERE version=4`); err != nil {
		t.Fatal(err)
	}
	if err = Migrate(ctx, pool); err == nil {
		t.Fatal("role migration checksum ignored")
	}
}

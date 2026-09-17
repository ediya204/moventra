package database

import (
	"context"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
	"testing"
)

func TestPoolConfig(t *testing.T) {
	for _, v := range []string{"0", "-1", "101", "invalid"} {
		if _, err := PoolConfig("postgresql://localhost/test", v); err == nil {
			t.Fatal(v)
		}
	}
	for _, v := range []string{"", "12"} {
		c, err := PoolConfig("postgresql://localhost/test", v)
		if err != nil {
			t.Fatal(err)
		}
		want := int32(5)
		if v == "12" {
			want = 12
		}
		if c.MaxConns != want {
			t.Fatal(c.MaxConns)
		}
	}
	if _, err := PoolConfig("postgresql://localhost/test?pool_min_conns=10", "5"); err == nil {
		t.Fatal("inconsistent pool accepted")
	}
	if _, err := PoolConfig("", ""); err == nil {
		t.Fatal("empty URL accepted")
	}
}
func TestReadyMigrationIntegrity(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("requires isolated test database")
	}
	cfg, err := pgxpool.ParseConfig(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") || cfg.ConnConfig.Host != "/tmp" {
		t.Fatal("unsafe test database")
	}
	ctx := context.Background()
	base, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	schema := "runtime_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = base.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer base.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if Ready(ctx, db, false) == nil {
		t.Fatal("missing migrations accepted")
	}
	if err = Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err = Ready(ctx, db, true); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, "DELETE FROM schema_migrations WHERE version=6"); err != nil {
		t.Fatal(err)
	}
	if Ready(ctx, db, true) == nil {
		t.Fatal("missing ledger migration accepted")
	}
	if err = Ready(ctx, db, false); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, "UPDATE schema_migrations SET checksum='corrupt' WHERE version=1"); err != nil {
		t.Fatal(err)
	}
	if Ready(ctx, db, false) == nil {
		t.Fatal("corrupt migration accepted")
	}
}

package issuing

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"testing"
)

func TestIssuingLocalConfig(t *testing.T) {
	for _, tc := range []struct {
		dsn, url string
		want     bool
	}{
		{"postgresql:///moventra_test_local?host=/tmp", "http://127.0.0.1:5001", true},
		{"postgresql:///moventra_production?host=/tmp", "http://127.0.0.1:5001", false},
		{"postgresql://remote.invalid/moventra_test_local", "http://127.0.0.1:5001", false},
		{"postgresql:///moventra_test_local?host=/tmp", "https://remote.invalid", false},
	} {
		t.Run(tc.dsn+tc.url, func(t *testing.T) {
			t.Setenv("ISSUING_MODE", "local")
			t.Setenv("ISSUING_BLNK_URL", tc.url)
			t.Setenv("ISSUING_FIXTURE_URL", tc.url)
			t.Setenv("ISSUING_BLNK_KEY", "synthetic")
			t.Setenv("ISSUING_FIXTURE_SUPPLIER_ID", "10000000-0000-4000-8000-000000000001")
			db, e := pgxpool.New(context.Background(), tc.dsn)
			if e != nil {
				t.Fatal(e)
			}
			defer db.Close()
			svc, e := FromEnv(db)
			if (e == nil) != tc.want {
				t.Fatal(e)
			}
			if e == nil && (!svc.Enabled || svc.Mode != "isolated") {
				t.Fatal("wrong mode")
			}
		})
	}
	t.Setenv("ISSUING_MODE", "")
	svc, e := FromEnv(nil)
	if e != nil || svc.Enabled || svc.Blnk != nil {
		t.Fatal("default must be disabled")
	}
}

func TestPreparationCannotExecute(t *testing.T) {
	t.Setenv("ISSUING_MODE", "prepare")
	t.Setenv("ISSUING_BLNK_URL", "https://moventra-blnk:5443")
	t.Setenv("ISSUING_BLNK_KEY", "synthetic")
	t.Setenv("ISSUING_BLNK_CA_PEM", "")
	t.Setenv("LEDGER_MODE", "")
	t.Setenv("BLNK_URL", "")
	db, err := pgxpool.New(context.Background(), "postgresql:///moventra?host=/tmp")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc, err := FromEnv(db)
	if err != nil {
		t.Fatal(err)
	}
	if svc.Enabled || svc.Mode != "prepare" || len(svc.Providers) != 0 || svc.Blnk == nil {
		t.Fatal("preparation capability incorrect")
	}
	if svc.Tick(context.Background()) != ErrBlocked {
		t.Fatal("preparation executed work")
	}
	t.Setenv("ISSUING_MODE", "live")
	t.Setenv("ISSUING_CERTIFICATION_FILE", "/nonexistent")
	if _, err = FromEnv(db); err == nil {
		t.Fatal("live bypassed evidence")
	}
}

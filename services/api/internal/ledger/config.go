package ledger

import (
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/blnk"
	"net"
	"net/url"
	"os"
	"strings"
)

// This release only supports explicit, isolated local shadow mode.
func FromEnv(db *pgxpool.Pool) (*Service, error) {
	mode := os.Getenv("LEDGER_MODE")
	if mode == "" || mode == "disabled" {
		return nil, nil
	}
	if mode != "shadow" {
		return nil, errors.New("only_shadow_ledger_supported")
	}
	if err := CheckLocalDatabase(db.Config()); err != nil {
		return nil, err
	}
	u, err := url.Parse(os.Getenv("BLNK_URL"))
	if err != nil || !localHost(u.Hostname()) {
		return nil, errors.New("shadow_blnk_must_be_local")
	}
	c, err := blnk.New(os.Getenv("BLNK_URL"), os.Getenv("BLNK_API_KEY"))
	if err != nil {
		return nil, err
	}
	return New(db, c, os.Getenv("BLNK_NAMESPACE"), os.Getenv("BLNK_LEDGER_ID"))
}
func localHost(host string) bool {
	ip := net.ParseIP(host)
	return host == "localhost" || (ip != nil && ip.IsLoopback())
}
func CheckLocalDatabase(cfg *pgxpool.Config) error {
	name := cfg.ConnConfig.Database
	if (!strings.HasPrefix(name, "moventra_shadow_") && !strings.HasPrefix(name, "moventra_test_")) || (!localHost(cfg.ConnConfig.Host) && cfg.ConnConfig.Host != "/tmp") {
		return errors.New("isolated_local_shadow_database_required")
	}
	for _, f := range cfg.ConnConfig.Fallbacks {
		if !localHost(f.Host) && f.Host != "/tmp" {
			return errors.New("remote_database_fallback_forbidden")
		}
	}
	return nil
}

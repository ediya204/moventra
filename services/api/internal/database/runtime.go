package database

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PoolConfig keeps the existing five-connection default. Callers never log URLs.
func PoolConfig(raw, max string) (*pgxpool.Config, error) {
	cfg, err := pgxpool.ParseConfig(raw)
	if err != nil || raw == "" {
		return nil, fmt.Errorf("invalid_database_configuration")
	}
	n := 5
	if max != "" {
		n, err = strconv.Atoi(max)
		if err != nil || n < 1 || n > 100 {
			return nil, fmt.Errorf("DB_MAX_CONNS must be between 1 and 100")
		}
	}
	cfg.MaxConns = int32(n)
	if cfg.MinConns > cfg.MaxConns {
		return nil, fmt.Errorf("database_min_connections_exceed_max")
	}
	return cfg, nil
}

// Ready verifies installed migrations, without applying any migration.
func Ready(ctx context.Context, db *pgxpool.Pool, ledgerEnabled bool) error {
	required := map[int]string{1: initial, 2: channelProjection, 3: onboarding, 4: userRoles, 5: userDirectoryAudit, 7: customerCardSnapshots}
	if ledgerEnabled {
		required[6] = blnkShadow
	}
	for version, sql := range required {
		var checksum string
		if err := db.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, version).Scan(&checksum); err != nil {
			return fmt.Errorf("required_migration_unavailable")
		}
		if checksum != fmt.Sprintf("%x", sha256.Sum256([]byte(sql))) {
			return fmt.Errorf("migration_checksum_mismatch")
		}
	}
	return nil
}

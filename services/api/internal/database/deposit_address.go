package database

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MigrateDepositAddresses only adds the three reviewed funds migrations. It
// does not activate the ledger, migrate balances, or change other migrations.
func MigrateDepositAddresses(ctx context.Context, db *pgxpool.Pool) error {
	tx, e := db.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73019001)`); e != nil {
		return e
	}
	for _, m := range []struct {
		v int
		s string
	}{{1, initial}, {2, channelProjection}, {3, onboarding}, {4, userRoles}, {5, userDirectoryAudit}, {6, blnkShadow}, {13, cryptoFunds}, {15, fundsFlows}} {
		hash := fmt.Sprintf("%x", sha256.Sum256([]byte(m.s)))
		var got string
		e = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, m.v).Scan(&got)
		if e == nil {
			if got != hash {
				return fmt.Errorf("migration_checksum_mismatch_%d", m.v)
			}
			continue
		}
		if e != pgx.ErrNoRows {
			return e
		}
		if m.v < 6 {
			return fmt.Errorf("base_migration_required_%d", m.v)
		}
		if _, e = tx.Exec(ctx, m.s); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)`, m.v, hash); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}

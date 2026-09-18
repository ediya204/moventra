package database

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MigrateGlobalAdmin installs only 019, after verifying every dependency.
func MigrateGlobalAdmin(ctx context.Context, db *pgxpool.Pool) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SET LOCAL lock_timeout='5s'; SELECT pg_advisory_xact_lock(73019001)`); err != nil {
		return err
	}
	all := []string{initial, channelProjection, onboarding, userRoles, userDirectoryAudit, blnkShadow, customerCardSnapshots, onlineTestWallet, onlineTestFunds, slashWebhook, projectWallet, cardIssuing, cryptoFunds, issuingCheckout, fundsFlows, manualFunds, cardStateSync, cardControls}
	for i, sql := range all {
		var got string
		if err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, i+1).Scan(&got); err != nil {
			return fmt.Errorf("missing_dependency_%d", i+1)
		}
		if got != fmt.Sprintf("%x", sha256.Sum256([]byte(sql))) {
			return fmt.Errorf("migration_%d_conflict", i+1)
		}
	}
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(globalAdmin)))
	var got string
	err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=19`).Scan(&got)
	if err == nil {
		if got != hash {
			return errors.New("migration_19_conflict")
		}
		return tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if _, err = tx.Exec(ctx, globalAdmin); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES(19,$1)`, hash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SetGlobalAdmin never changes application roles or scoped grants. Identity is
// resolved by the trusted CLI against Firebase, not supplied by an HTTP caller.
func SetGlobalAdmin(ctx context.Context, db *pgxpool.Pool, uid, evidence string, grant bool) error {
	if strings.TrimSpace(uid) == "" || strings.TrimSpace(evidence) == "" || len([]rune(evidence)) > 300 {
		return errors.New("explicit_identity_and_evidence_required")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(7352195)`); err != nil {
		return err
	}
	var id, role, state string
	if err = tx.QueryRow(ctx, `SELECT id::text,role,status FROM users WHERE firebase_uid=$1 FOR UPDATE`, uid).Scan(&id, &role, &state); err != nil {
		return errors.New("identity_not_found")
	}
	if grant {
		var mixed bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM customers WHERE personal_owner_id=$1) OR EXISTS(SELECT 1 FROM memberships WHERE user_id=$1)`, id).Scan(&mixed); err != nil {
			return err
		}
		if role != "admin" || state != "active" || mixed {
			return errors.New("active_unmixed_admin_required")
		}
	}
	action := "revoke"
	var tagRows int64
	if grant {
		action = "grant"
		tag, e := tx.Exec(ctx, `INSERT INTO global_admins(user_id,evidence_ref) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, evidence)
		err = e
		tagRows = tag.RowsAffected()
	} else {
		tag, e := tx.Exec(ctx, `DELETE FROM global_admins WHERE user_id=$1`, id)
		err = e
		tagRows = tag.RowsAffected()
	}
	if err != nil {
		return err
	}
	if tagRows > 0 {
		if _, err = tx.Exec(ctx, `INSERT INTO global_admin_audit(user_id,action,evidence_ref) VALUES($1,$2,$3)`, id, action, evidence); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

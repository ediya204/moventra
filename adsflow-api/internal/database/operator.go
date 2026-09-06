package database

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ProvisionOperator grants the two implemented read permissions for exactly
// one existing personal customer. Identity checks belong to the controlled CLI.
func ProvisionOperator(ctx context.Context, pool *pgxpool.Pool, operatorUID, ownerUID string) (string, error) {
	if operatorUID == "" || ownerUID == "" || operatorUID == ownerUID {
		return "", errors.New("distinct explicit identities required")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	// Serialize grants made by this command and lock both active identities.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(7352194)`); err != nil {
		return "", err
	}
	var operator, owner, state string
	if err = tx.QueryRow(ctx, `SELECT id::text,status FROM users WHERE firebase_uid=$1 FOR UPDATE`, operatorUID).Scan(&operator, &state); err != nil || state != "active" {
		return "", errors.New("operator is not active")
	}
	if err = tx.QueryRow(ctx, `SELECT id::text,status FROM users WHERE firebase_uid=$1 FOR UPDATE`, ownerUID).Scan(&owner, &state); err != nil || state != "active" {
		return "", errors.New("owner is not active")
	}
	var mixed bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM staff_grants WHERE user_id=$1) OR EXISTS(SELECT 1 FROM customers WHERE personal_owner_id=$2) OR EXISTS(SELECT 1 FROM memberships WHERE user_id=$2)`, owner, operator).Scan(&mixed); err != nil {
		return "", err
	}
	if mixed {
		return "", errors.New("existing roles are mixed; explicit review required")
	}
	var customer string
	if err = tx.QueryRow(ctx, `SELECT id::text FROM customers WHERE kind='personal' AND personal_owner_id=$1`, owner).Scan(&customer); err != nil {
		return "", errors.New("personal customer missing")
	}
	for _, permission := range []string{"accounts:read", "transactions:read"} {
		result, err := tx.Exec(ctx, `INSERT INTO staff_grants(user_id,customer_id,permission) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, operator, customer, permission)
		if err != nil {
			return "", err
		}
		if result.RowsAffected() > 0 {
			if _, err = tx.Exec(ctx, `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,$3)`, operator, customer, "staff:provision:user-request:"+permission); err != nil {
				return "", err
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return customer, nil
}

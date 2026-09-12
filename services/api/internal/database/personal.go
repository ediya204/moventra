package database

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ProvisionPersonal links a verified identity's existing active login user to
// one personal subject. It never activates services or changes financial data.
func ProvisionPersonal(ctx context.Context, pool *pgxpool.Pool, uid string) (string, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var owner, status, name, role string
	err = tx.QueryRow(ctx, `SELECT id::text,status,display_name,role FROM users WHERE firebase_uid=$1 FOR UPDATE`, uid).Scan(&owner, &status, &name, &role)
	if err != nil {
		return "", errors.New("local user not found")
	}
	if role != "customer" {
		return "", errors.New("customer role required")
	}
	if status != "active" {
		return "", errors.New("local user disabled")
	}
	var customer string
	err = tx.QueryRow(ctx, `SELECT id::text FROM customers WHERE personal_owner_id=$1 AND kind='personal'`, owner).Scan(&customer)
	if errors.Is(err, pgx.ErrNoRows) {
		customer = uuid.NewString()
		if name == "" {
			name = "个人"
		}
		_, err = tx.Exec(ctx, `INSERT INTO customers(id,kind,name,personal_owner_id,onboarding_status,service_status) VALUES($1,'personal',$2,$3,'draft','inactive')`, customer, name+" · 个人", owner)
		if err != nil {
			return "", err
		}
		_, err = tx.Exec(ctx, `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,'personal:provision:user-request')`, owner, customer)
		if err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return customer, nil
}

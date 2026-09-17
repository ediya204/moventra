package database

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BindCardSnapshot assigns an explicitly reviewed, fixed snapshot for testing.
// The caller must verify Firebase UID/email and email verification first.
func BindCardSnapshot(ctx context.Context, pool *pgxpool.Pool, uid, connection, revision, reason string, expected int) (int, error) {
	if uid == "" || connection == "" || revision == "" || len(reason) < 1 || len(reason) > 500 || expected < 1 {
		return 0, errors.New("explicit binding scope required")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	// Serialize assignment across customers and lock the import head against concurrent imports.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73019007)`); err != nil {
		return 0, err
	}
	var user, customer string
	err = tx.QueryRow(ctx, `SELECT u.id::text,c.id::text FROM users u JOIN customers c ON c.personal_owner_id=u.id AND c.kind='personal' WHERE u.firebase_uid=$1 AND u.status='active' AND u.role='customer' FOR UPDATE OF u,c`, uid).Scan(&user, &customer)
	if err != nil {
		return 0, errors.New("active customer with personal subject required")
	}
	var current string
	if err = tx.QueryRow(ctx, `SELECT revision FROM channel_connections WHERE id=$1 FOR UPDATE`, connection).Scan(&current); err != nil || current != revision {
		return 0, errors.New("source revision changed or missing")
	}
	var count, conflicts int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM channel_records WHERE connection_id=$1 AND revision=$2 AND kind='card'`, connection, revision).Scan(&count); err != nil {
		return 0, err
	}
	if count != expected {
		return 0, errors.New("card count differs from reviewed plan")
	}
	var existing string
	err = tx.QueryRow(ctx, `SELECT revision FROM customer_card_snapshots WHERE customer_id=$1 AND connection_id=$2`, customer, connection).Scan(&existing)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	if existing != "" && existing != revision {
		return 0, errors.New("snapshot replacement requires separate review")
	}
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM customer_card_bindings b JOIN channel_records r ON r.connection_id=b.connection_id AND r.external_id=b.external_card_id AND r.kind='card' WHERE r.connection_id=$1 AND r.revision=$2 AND (b.customer_id<>$3 OR b.revision<>$2)`, connection, revision, customer).Scan(&conflicts); err != nil {
		return 0, err
	}
	if conflicts > 0 {
		return 0, errors.New("existing card assignment conflict; no rebind allowed")
	}
	if existing == "" {
		if _, err = tx.Exec(ctx, `INSERT INTO customer_card_snapshots(customer_id,connection_id,revision,target_user_id,reason) VALUES($1,$2,$3,$4,$5)`, customer, connection, revision, user, reason); err != nil {
			return 0, err
		}
	}
	result, err := tx.Exec(ctx, `INSERT INTO customer_card_bindings(connection_id,external_card_id,customer_id,revision) SELECT connection_id,external_id,$3,revision FROM channel_records WHERE connection_id=$1 AND revision=$2 AND kind='card' ON CONFLICT(connection_id,external_card_id) DO NOTHING`, connection, revision, customer)
	if err != nil {
		return 0, err
	}
	if result.RowsAffected() > 0 {
		if _, err = tx.Exec(ctx, `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,$3)`, user, customer, "card-snapshot:bind:user-request:"+connection+":"+revision); err != nil {
			return 0, err
		}
	}
	return int(result.RowsAffected()), tx.Commit(ctx)
}

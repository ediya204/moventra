package database

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GrantExistingOnboarding is a one-time, explicitly authorized operations command.
// It copies only existing personal-customer read scopes of active staff, never
// customer owners or business members. It is not called by migration or startup.
func GrantExistingOnboarding(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	// Short maintenance transaction: serialize scope/identity changes and its audit.
	if _, err = tx.Exec(ctx, `LOCK TABLE users,customers,memberships,staff_grants IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return 0, err
	}
	var count int64
	err = tx.QueryRow(ctx, `WITH granted AS (
 INSERT INTO staff_grants(user_id,customer_id,permission)
 SELECT DISTINCT g.user_id,g.customer_id,'onboarding:review'
 FROM staff_grants g JOIN users u ON u.id=g.user_id
 JOIN customers c ON c.id=g.customer_id
 WHERE u.status='active' AND u.role='admin' AND c.kind='personal'
 AND g.permission IN ('accounts:read','transactions:read')
 AND NOT EXISTS(SELECT 1 FROM customers owned WHERE owned.personal_owner_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id)
 ON CONFLICT DO NOTHING RETURNING user_id,customer_id
 ), audited AS (
 INSERT INTO audit_events(actor_id,customer_id,action)
 SELECT user_id,customer_id,'staff:provision:user-request:2026-09-13:onboarding:review:existing-scope' FROM granted
 RETURNING id
 ) SELECT count(*) FROM audited`).Scan(&count)
	if err != nil {
		return 0, err
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	return count, nil
}

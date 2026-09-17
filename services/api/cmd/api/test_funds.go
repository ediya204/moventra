package main

import (
	"context"
	"encoding/json"
	"errors"
	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
)

func testFundsReviewCommand(ctx context.Context, db *pgxpool.Pool, auth *firebaseauth.Client, apply bool) error {
	email := strings.TrimSpace(os.Getenv("TEST_WALLET_EMAIL"))
	if email == "" {
		return errors.New("TEST_WALLET_EMAIL required")
	}
	identity, e := auth.GetUserByEmail(ctx, email)
	if e != nil || identity.Disabled || !identity.EmailVerified || !strings.EqualFold(identity.Email, email) {
		return errors.New("verified_enabled_email_required")
	}
	tx, e := db.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var customer string
	e = tx.QueryRow(ctx, `SELECT c.id::text FROM customers c JOIN users u ON u.id=c.personal_owner_id WHERE u.firebase_uid=$1 AND u.role='customer' AND u.status='active' AND EXISTS(SELECT 1 FROM online_test_wallet_grants g WHERE g.customer_id=c.id) FOR UPDATE OF c`, identity.UID).Scan(&customer)
	if e != nil {
		return errors.New("existing_test_customer_required")
	}
	rows, e := tx.Query(ctx, `SELECT u.id::text FROM staff_grants g JOIN users u ON u.id=g.user_id WHERE g.customer_id=$1 AND g.permission='onboarding:review' AND u.role='admin' AND u.status='active' ORDER BY u.id FOR SHARE OF g,u`, customer)
	if e != nil {
		return e
	}
	reviewers := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return e
		}
		reviewers = append(reviewers, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	added := int64(0)
	if apply {
		if os.Getenv("CONFIRM_ONLINE_TEST_ONLY") != "yes" || len(reviewers) != 1 || os.Getenv("TEST_FUNDS_REVIEWER_ID") != reviewers[0] {
			return errors.New("one_explicit_existing_reviewer_required")
		}
		r, err := tx.Exec(ctx, `INSERT INTO online_test_funds_review_grants(user_id,customer_id,reason) VALUES($1,$2,'User-requested isolated online test funds review; existing onboarding reviewer') ON CONFLICT DO NOTHING`, reviewers[0], customer)
		if err != nil {
			return err
		}
		added = r.RowsAffected()
		if added > 0 {
			if _, err = tx.Exec(ctx, `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,'test-funds:review-grant:user-request')`, reviewers[0], customer); err != nil {
				return err
			}
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"customerId": customer, "eligibleReviewerIds": reviewers, "newGrants": added, "mode": "online_test", "realFundsPermission": false})
}

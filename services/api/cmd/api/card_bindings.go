package main

import (
	"context"
	"encoding/json"
	"errors"
	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"os"
	"strconv"
	"strings"
)

func cardBindings(ctx context.Context, pool *pgxpool.Pool, auth *firebaseauth.Client, apply bool) error {
	email := strings.TrimSpace(os.Getenv("BIND_EMAIL"))
	if email == "" {
		return errors.New("BIND_EMAIL required")
	}
	identity, err := auth.GetUserByEmail(ctx, email)
	if err != nil || identity.Disabled || !identity.EmailVerified || !strings.EqualFold(identity.Email, email) {
		return errors.New("verified enabled Firebase email required")
	}
	var user, customer, role, state string
	err = pool.QueryRow(ctx, `SELECT u.id::text,c.id::text,u.role,u.status FROM users u LEFT JOIN customers c ON c.personal_owner_id=u.id AND c.kind='personal' WHERE u.firebase_uid=$1`, identity.UID).Scan(&user, &customer, &role, &state)
	if err != nil || role != "customer" || state != "active" {
		return errors.New("active local customer and personal subject required")
	}
	if apply {
		count, err := strconv.Atoi(os.Getenv("BIND_EXPECTED_CARDS"))
		if err != nil {
			return errors.New("explicit BIND_EXPECTED_CARDS required")
		}
		added, err := database.BindCardSnapshot(ctx, pool, identity.UID, os.Getenv("BIND_CONNECTION"), os.Getenv("BIND_REVISION"), os.Getenv("BIND_REASON"), count)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"customerId": customer, "boundCards": count, "newBindings": added, "mode": "test_snapshot"})
	}
	rows, err := pool.Query(ctx, `SELECT c.id,c.revision,count(*) FILTER(WHERE r.kind='card'),count(*) FILTER(WHERE r.kind='transaction' AND EXISTS(SELECT 1 FROM channel_records card WHERE card.connection_id=r.connection_id AND card.revision=r.revision AND card.kind='card' AND card.external_id=r.data->>'cardId')) FROM channel_connections c JOIN channel_records r ON r.connection_id=c.id AND r.revision=c.revision GROUP BY c.id ORDER BY c.id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	data := []map[string]any{}
	for rows.Next() {
		var connection, revision string
		var cards, transactions int
		if err = rows.Scan(&connection, &revision, &cards, &transactions); err != nil {
			return err
		}
		data = append(data, map[string]any{"connection": connection, "revision": revision, "cards": cards, "transactions": transactions})
	}
	if err = rows.Err(); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"email": email, "customerId": customer, "connections": data, "readOnly": true})
}

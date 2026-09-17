package api

import (
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"moventra.local/api/internal/database"
	"net/http"
)

func (s *Server) testWallet(w http.ResponseWriter, r *http.Request) {
	customer := r.PathValue("customerID")
	p := r.Context().Value(principalKey{}).(principal)
	if _, err := uuid.Parse(customer); err != nil {
		fail(w, 400, "invalid_customer_id")
		return
	}
	if r.URL.RawQuery != "" {
		fail(w, 400, "invalid_query")
		return
	}
	tx, err := s.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var allowed bool
	err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM customers WHERE id=$1 AND personal_owner_id=$2 AND kind='personal')`, customer, p.ID).Scan(&allowed)
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if !allowed {
		fail(w, 404, "not_found")
		return
	}
	out, err := database.ReadTestWallet(r.Context(), tx, customer)
	if err != nil {
		fail(w, 503, "test_wallet_unavailable")
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,'test-wallet:read')`, p.ID, customer); err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	respond(w, 200, map[string]any{"data": out})
}

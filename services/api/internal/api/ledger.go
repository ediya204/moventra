package api

import (
	"github.com/google/uuid"
	"net/http"
)

func (s *Server) ledgerSnapshot(surface string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.Ledger == nil {
			fail(w, 503, "ledger_disabled")
			return
		}
		customer := r.PathValue("customerID")
		if _, err := uuid.Parse(customer); err != nil || r.URL.RawQuery != "" {
			fail(w, 400, "invalid_ledger_query")
			return
		}
		p := r.Context().Value(principalKey{}).(principal)
		if surface == "admin" && !p.Identity.MFA {
			fail(w, 403, "mfa_required")
			return
		}
		tx, err := s.DB.Begin(r.Context())
		if err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		defer tx.Rollback(r.Context())
		var allowed bool
		if surface == "admin" {
			err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM ledger_read_grants WHERE user_id=$1 AND customer_id=$2)`, p.ID, customer).Scan(&allowed)
		} else {
			err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM customers WHERE id=$1 AND kind='personal' AND personal_owner_id=$2)`, customer, p.ID).Scan(&allowed)
		}
		if err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		if !allowed {
			fail(w, 404, "not_found")
			return
		}
		data, err := s.Ledger.SnapshotTx(r.Context(), tx, customer)
		if err != nil {
			fail(w, 503, "ledger_unavailable")
			return
		}
		_, err = tx.Exec(r.Context(), `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,$3)`, p.ID, customer, "ledger:shadow:read")
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			fail(w, 503, "audit_unavailable")
			return
		}
		respond(w, 200, map[string]any{"data": data})
	}
}

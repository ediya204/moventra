package api

import (
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"io"
	"moventra.local/api/internal/testfunds"
	"net/http"
	"slices"
	"strconv"
)

func fundsFailure(w http.ResponseWriter, err error) {
	var f *testfunds.Fault
	if errors.As(err, &f) {
		fail(w, f.Status, f.Code)
	} else {
		fail(w, 503, "test_funds_unavailable")
	}
}
func (s *Server) testFunds(admin bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.Context().Value(principalKey{}).(principal)
		customer := r.PathValue("customerID")
		id := r.PathValue("orderID")
		if _, e := uuid.Parse(customer); e != nil {
			fail(w, 400, "invalid_customer_id")
			return
		}
		if id != "" {
			if _, e := uuid.Parse(id); e != nil {
				fail(w, 400, "invalid_order_id")
				return
			}
		}
		if admin && !p.Identity.MFA {
			fail(w, 403, "mfa_required")
			return
		}
		page := 0
		kind, status := "", ""
		for k, v := range r.URL.Query() {
			if len(v) != 1 || r.Method != "GET" || id != "" {
				fail(w, 400, "invalid_query")
				return
			}
			switch k {
			case "page":
				n, e := strconv.Atoi(v[0])
				if e != nil || n < 0 || n > 500 {
					fail(w, 400, "invalid_query")
					return
				}
				page = n
			case "kind":
				kind = v[0]
				if kind != "" && kind != "deposit" && kind != "exchange" && kind != "withdraw" {
					fail(w, 400, "invalid_query")
					return
				}
			case "status":
				status = v[0]
				if status != "" && !slices.Contains([]string{"pending", "confirming", "pending_review", "processing", "unknown", "completed", "cancelled", "rejected", "failed"}, status) {
					fail(w, 400, "invalid_query")
					return
				}
			default:
				fail(w, 400, "invalid_query")
				return
			}
		}
		var in testfunds.Input
		if r.Method == "POST" {
			if r.Header.Get("Content-Type") != "application/json" {
				fail(w, 415, "json_required")
				return
			}
			d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
			d.DisallowUnknownFields()
			if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
				fail(w, 400, "invalid_body")
				return
			}
		}
		tx, e := s.DB.Begin(r.Context())
		if e != nil {
			fundsFailure(w, e)
			return
		}
		defer tx.Rollback(r.Context())
		enabled, operate, e := testfunds.Authorize(r.Context(), tx, customer, p.ID, admin, r.Method == "POST")
		if e != nil {
			fundsFailure(w, e)
			return
		}
		var out any
		if r.Method == "POST" {
			if !enabled {
				fail(w, 403, "test_wallet_not_enabled")
				return
			}
			out, e = testfunds.Execute(r.Context(), tx, customer, p.ID, r.Header.Get("Idempotency-Key"), admin, operate, in)
		} else if id != "" {
			var order testfunds.Order
			var events []testfunds.Event
			order, events, e = testfunds.GetOrder(r.Context(), tx, customer, id)
			out = map[string]any{"mode": "online_test", "executionEligible": false, "order": order, "events": events}
		} else {
			out, e = testfunds.List(r.Context(), tx, customer, kind, status, page, enabled, operate)
		}
		if e != nil {
			fundsFailure(w, e)
			return
		}
		if r.Method == "GET" {
			_, e = tx.Exec(r.Context(), `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,'test-funds:read')`, p.ID, customer)
		}
		if e == nil {
			e = tx.Commit(r.Context())
		}
		if e != nil {
			fundsFailure(w, e)
			return
		}
		respond(w, 200, map[string]any{"data": out})
	})
}
func (s *Server) testFundsScopes(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	if !p.Identity.MFA {
		fail(w, 403, "mfa_required")
		return
	}
	if r.URL.RawQuery != "" {
		fail(w, 400, "invalid_query")
		return
	}
	rows, e := s.DB.Query(r.Context(), `SELECT c.id::text,c.name FROM online_test_funds_review_grants g JOIN customers c ON c.id=g.customer_id WHERE g.user_id=$1 ORDER BY c.id`, p.ID)
	if e != nil {
		fundsFailure(w, e)
		return
	}
	defer rows.Close()
	out := []map[string]string{}
	for rows.Next() {
		var id, name string
		if e = rows.Scan(&id, &name); e != nil {
			fundsFailure(w, e)
			return
		}
		out = append(out, map[string]string{"id": id, "name": name})
	}
	if e = rows.Err(); e != nil {
		fundsFailure(w, e)
		return
	}
	respond(w, 200, map[string]any{"data": out})
}

package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type onboardingState struct {
	CustomerID  string `json:"customerId"`
	Name        string `json:"name"`
	Status      string `json:"onboardingStatus"`
	Service     string `json:"serviceStatus"`
	Revision    int64  `json:"revision"`
	AllFeatures bool   `json:"allFeaturesEnabled"`
}

// Entitlement is separate from whether a product's execution API exists.
func allClientFeatures(status, service string) bool {
	return status == "approved" && service == "active"
}

func (s *Server) onboarding(admin bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.Context().Value(principalKey{}).(principal)
		id := r.PathValue("customerID")
		if _, err := uuid.Parse(id); err != nil {
			fail(w, 400, "invalid_customer_id")
			return
		}
		if len(r.URL.Query()) > 0 {
			fail(w, 400, "invalid_query")
			return
		}
		if admin && !p.Identity.MFA {
			fail(w, 403, "mfa_required")
			return
		}
		tx, err := s.DB.Begin(r.Context())
		if err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		defer tx.Rollback(r.Context())
		var state onboardingState
		var owner string
		// Lock scope and state for both the authorization decision and transition.
		err = tx.QueryRow(r.Context(), `SELECT id::text,name,personal_owner_id::text,onboarding_status,service_status,onboarding_revision FROM customers WHERE id=$1 AND kind='personal' FOR UPDATE`, id).Scan(&state.CustomerID, &state.Name, &owner, &state.Status, &state.Service, &state.Revision)
		if errors.Is(err, pgx.ErrNoRows) {
			fail(w, 404, "not_found")
			return
		}
		if err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		allowed := owner == p.ID
		if admin {
			var grant string
			err = tx.QueryRow(r.Context(), `SELECT permission FROM staff_grants WHERE user_id=$1 AND customer_id=$2 AND permission='onboarding:review' FOR SHARE`, p.ID, id).Scan(&grant)
			allowed = err == nil && owner != p.ID
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				fail(w, 503, "temporarily_unavailable")
				return
			}
		}
		if !allowed {
			fail(w, 404, "not_found")
			return
		}
		if r.Method == "POST" {
			if r.Header.Get("Content-Type") != "application/json" {
				fail(w, 415, "json_required")
				return
			}
			var input struct {
				Action   string `json:"action"`
				Revision *int64 `json:"revision"`
				Reason   string `json:"reason"`
			}
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
			decoder.DisallowUnknownFields()
			if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || input.Revision == nil {
				fail(w, 400, "invalid_body")
				return
			}
			input.Reason = strings.TrimSpace(input.Reason)
			if len([]rune(input.Reason)) > 500 || admin && input.Reason == "" {
				fail(w, 400, "review_reason_required")
				return
			}
			if *input.Revision != state.Revision {
				fail(w, 409, "onboarding_changed")
				return
			}
			nextStatus, nextService := state.Status, state.Service
			valid := false
			if !admin {
				valid = input.Action == "submit" && (state.Status == "draft" || state.Status == "rejected") && state.Service == "inactive"
				if valid {
					nextStatus = "submitted"
				}
			} else {
				switch input.Action {
				case "approve_activate":
					valid = state.Status == "submitted" && state.Service == "inactive"
					nextStatus = "approved"
					nextService = "active"
				case "reject":
					valid = state.Status == "submitted" && state.Service == "inactive"
					nextStatus = "rejected"
				case "suspend":
					valid = state.Status == "approved" && state.Service == "active"
					nextService = "suspended"
				case "resume":
					valid = state.Status == "approved" && state.Service == "suspended"
					nextService = "active"
				case "activate":
					valid = state.Status == "approved" && state.Service == "inactive"
					nextService = "active"
				}
			}
			if !valid {
				fail(w, 409, "invalid_onboarding_transition")
				return
			}
			state.Status = nextStatus
			state.Service = nextService
			state.Revision++
			_, err = tx.Exec(r.Context(), `UPDATE customers SET onboarding_status=$2,service_status=$3,onboarding_revision=$4 WHERE id=$1`, id, state.Status, state.Service, state.Revision)
			if err == nil {
				_, err = tx.Exec(r.Context(), `INSERT INTO onboarding_events(customer_id,actor_id,action,reason,revision) VALUES($1,$2,$3,$4,$5)`, id, p.ID, input.Action, input.Reason, state.Revision)
			}
			if err == nil {
				_, err = tx.Exec(r.Context(), `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,$3)`, p.ID, id, "onboarding:"+input.Action)
			}
		} else if admin {
			_, err = tx.Exec(r.Context(), `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,'onboarding:read')`, p.ID, id)
		}
		if err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		if err = tx.Commit(r.Context()); err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		state.AllFeatures = allClientFeatures(state.Status, state.Service)
		respond(w, 200, map[string]any{"data": state})
	})
}

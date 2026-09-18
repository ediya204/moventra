package api

import (
	"encoding/json"
	"github.com/google/uuid"
	"io"
	"net/http"
	"strconv"
)

func (s *Server) depositAddress(w http.ResponseWriter, r *http.Request) {
	if s.Deposits == nil {
		fail(w, 503, "deposit_addresses_disabled")
		return
	}
	customer := r.PathValue("customerID")
	if _, e := uuid.Parse(customer); e != nil {
		fail(w, 400, "invalid_customer_id")
		return
	}
	p := r.Context().Value(principalKey{}).(principal)
	eligible, e := s.Deposits.Eligible(r.Context(), customer, p.ID)
	if e != nil {
		fail(w, 404, "not_found")
		return
	}
	if !eligible {
		fail(w, 403, "user_not_enabled")
		return
	}
	page, event := 0, ""
	for k, v := range r.URL.Query() {
		if r.Method != "GET" || len(v) != 1 {
			fail(w, 400, "invalid_query")
			return
		}
		switch k {
		case "page":
			n, err := strconv.Atoi(v[0])
			if err != nil || n < 0 || n > 500 {
				fail(w, 400, "invalid_query")
				return
			}
			page = n
		case "event":
			if _, err := uuid.Parse(v[0]); err != nil {
				fail(w, 400, "invalid_query")
				return
			}
			event = v[0]
		default:
			fail(w, 400, "invalid_query")
			return
		}
	}
	if event != "" && page != 0 {
		fail(w, 400, "invalid_query")
		return
	}
	if r.Method == "POST" {
		if r.Header.Get("Content-Type") != "application/json" {
			fail(w, 415, "json_required")
			return
		}
		if _, e = uuid.Parse(r.Header.Get("Idempotency-Key")); e != nil {
			fail(w, 400, "idempotency_key_required")
			return
		}
		var in struct {
			Network string `json:"network"`
		}
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		d.DisallowUnknownFields()
		if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF || in.Network != "TRC20" {
			fail(w, 400, "network_not_enabled")
			return
		}
		if _, e = s.Deposits.Request(r.Context(), customer, p.ID); e != nil {
			fail(w, 503, "address_result_pending")
			return
		}
	}
	a, e := s.Deposits.Get(r.Context(), customer)
	if e != nil {
		fail(w, 503, "crypto_unavailable")
		return
	}
	events, e := s.Deposits.Events(r.Context(), customer, page, event)
	if e != nil {
		fail(w, 503, "crypto_unavailable")
		return
	}
	pilot, e := s.DepositPilot.DepositPilotStatus(r.Context(), customer)
	if e != nil {
		fail(w, 503, "crypto_unavailable")
		return
	}
	mode := "observation"
	if pilot.Cap != "" {
		mode = "deposit_pilot"
	}
	respond(w, 200, map[string]any{"data": map[string]any{"address": a, "events": events, "postingEnabled": pilot.Enabled, "mode": mode, "pilot": pilot}})
}

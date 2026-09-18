package api

import (
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"io"
	"moventra.local/api/internal/cryptofunds"
	"net/http"
	"os"
	"strconv"
	"strings"
)

func cryptoFail(w http.ResponseWriter, e error) {
	var f *cryptofunds.Fault
	if errors.As(e, &f) {
		fail(w, f.Status, f.Code)
	} else {
		fail(w, 503, "crypto_unavailable")
	}
}
func (s *Server) cryptoRoutes(mux *http.ServeMux) {
	mux.Handle("GET /admin-api/v1/crypto-sources", s.authenticate(http.HandlerFunc(s.cryptoSourceAPI)))
	mux.Handle("GET /admin-api/v1/crypto-sources/{connection}/events", s.authenticate(http.HandlerFunc(s.cryptoSourceAPI)))
	mux.Handle("GET /admin-api/v1/crypto-sources/{connection}/events/{eventID}", s.authenticate(http.HandlerFunc(s.cryptoSourceAPI)))
	mux.Handle("POST /admin-api/v1/crypto-sources/{connection}/sync", s.authenticate(http.HandlerFunc(s.cryptoSourceAPI)))
	mux.Handle("GET /admin-api/v1/crypto-scopes", s.authenticate(http.HandlerFunc(s.cryptoScopes)))
	for _, surface := range []string{"client", "admin"} {
		base := "/" + surface + "-api/v1/customers/{customerID}/crypto"
		mux.Handle("GET "+base, s.authenticate(http.HandlerFunc(s.cryptoAPI)))
		for _, method := range []string{"GET", "POST"} {
			mux.Handle(method+" "+base+"/{rest...}", s.authenticate(http.HandlerFunc(s.cryptoAPI)))
		}
	}
}

// The pilot's ledger may be queried independently of financial execution.
func (s *Server) fundsReadService() (*cryptofunds.Service, error) {
	if s.ProductionFunds != nil {
		return s.ProductionFunds, nil
	}
	svc, e := cryptofunds.New(s.Ledger)
	if e != nil && s.DepositPilot != nil && s.DepositPilot.Ledger.IsLive() {
		return s.DepositPilot, nil
	}
	if e == nil && os.Getenv("FUNDS_DISPLAY_MODE") == "production" && !svc.Ledger.IsLive() {
		return nil, errors.New("production_ledger_required")
	}
	return svc, e
}
func (s *Server) cryptoScopes(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	if !p.Identity.MFA {
		fail(w, 403, "mfa_required")
		return
	}
	if r.URL.RawQuery != "" {
		fail(w, 400, "invalid_query")
		return
	}
	svc, e := s.fundsReadService()
	if e != nil {
		fail(w, 503, "crypto_disabled")
		return
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		cryptoFail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	rows, e := tx.Query(r.Context(), `SELECT c.id::text,c.name,array_agg(g.permission ORDER BY g.permission) FROM crypto_grants g JOIN customers c ON c.id=g.customer_id WHERE namespace=$1 AND user_id=$2 GROUP BY c.id,c.name ORDER BY c.id LIMIT 201`, svc.NS(), p.ID)
	if e != nil {
		cryptoFail(w, e)
		return
	}
	out := []map[string]any{}
	for rows.Next() {
		var id, name string
		var permissions []string
		if e = rows.Scan(&id, &name, &permissions); e != nil {
			break
		}
		out = append(out, map[string]any{"id": id, "name": name, "permissions": permissions})
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		cryptoFail(w, e)
		return
	}
	if len(out) > 200 {
		fail(w, 503, "scope_capacity_exceeded")
		return
	}
	e = svc.Audit(r.Context(), tx, "", "", p.ID, "scopes:read", map[string]int{"count": len(out)})
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		cryptoFail(w, e)
		return
	}
	respond(w, 200, map[string]any{"data": out})
}
func (s *Server) cryptoAPI(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	customer := r.PathValue("customerID")
	rest := r.PathValue("rest")
	admin := strings.HasPrefix(r.URL.Path, "/admin-api/")
	write := r.Method == "POST"
	if _, e := uuid.Parse(customer); e != nil {
		fail(w, 400, "invalid_customer_id")
		return
	}
	if admin && !p.Identity.MFA {
		fail(w, 403, "mfa_required")
		return
	}
	svc, e := s.fundsReadService()
	if e != nil {
		fail(w, 503, "crypto_disabled")
		return
	}
	readOnly := svc.Pilot != nil
	if write && readOnly {
		fail(w, 503, "crypto_disabled")
		return
	}
	permission := "read"
	var in cryptofunds.Input
	if write {
		if r.Header.Get("Content-Type") != "application/json" {
			fail(w, 415, "json_required")
			return
		}
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
		d.DisallowUnknownFields()
		if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
			fail(w, 400, "invalid_body")
			return
		}
		routes := map[string]string{"addresses": "address", "otc/quotes": "otc_quote", "otc/orders": "otc_order", "withdrawals/quotes": "withdraw_quote", "withdrawals/orders": "withdraw_order", "cancel": "cancel", "cards/quotes": "card_quote", "cards/orders": "card_order"}
		if admin {
			routes = map[string]string{"settings": "configure", "approve": "approve", "reject": "reject", "recover": "recover"}
		}
		action, ok := routes[rest]
		if !ok || in.Action != "" && in.Action != action {
			fail(w, 404, "not_found")
			return
		}
		in.Action = action
		if admin {
			permission = "review"
			if action == "configure" {
				permission = "configure"
			}
			if action == "recover" {
				permission = "recover"
			}
		}
	} else if rest != "" && !strings.HasPrefix(rest, "orders/") {
		fail(w, 404, "not_found")
		return
	}
	page, limit := 0, 20
	cardID := ""
	kind, status := "", ""
	for k, v := range r.URL.Query() {
		if write || rest != "" || len(v) != 1 {
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
		case "limit":
			n, err := strconv.Atoi(v[0])
			if err != nil || (n != 5 && n != 20) {
				fail(w, 400, "invalid_query")
				return
			}
			limit = n
		case "cardId":
			cardID = v[0]
			if _, err := uuid.Parse(cardID); err != nil {
				fail(w, 400, "invalid_query")
				return
			}
		case "kind":
			kind = v[0]
			if kind != "" && kind != "otc" && kind != "withdrawal" && kind != "deposit" && kind != "card_transfer" {
				fail(w, 400, "invalid_query")
				return
			}
		case "status":
			status = v[0]
			if len(status) > 40 {
				fail(w, 400, "invalid_query")
				return
			}
		default:
			fail(w, 400, "invalid_query")
			return
		}
	}
	if in.OrderID != "" {
		if _, e = uuid.Parse(in.OrderID); e != nil {
			fail(w, 400, "invalid_order_id")
			return
		}
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		cryptoFail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if e = svc.Authorize(r.Context(), tx, customer, p.ID, permission, admin, write && in.Action != "cancel" && in.Action != "reject" && in.Action != "recover"); e != nil {
		cryptoFail(w, e)
		return
	}
	var out any
	if write {
		out, e = svc.Execute(r.Context(), tx, customer, p.ID, r.Header.Get("Idempotency-Key"), admin, in)
	} else if rest != "" {
		id := strings.TrimPrefix(rest, "orders/")
		if _, e = uuid.Parse(id); e != nil {
			fail(w, 400, "invalid_order_id")
			return
		}
		order, err := svc.Get(r.Context(), tx, customer, id)
		e = err
		if e == nil {
			rows, err := tx.Query(r.Context(), `SELECT action,data,created_at FROM crypto_audit WHERE namespace=$1 AND customer_id=$2 AND order_id=$3 ORDER BY id LIMIT 501`, svc.NS(), customer, id)
			if err != nil {
				cryptoFail(w, err)
				return
			}
			events := []map[string]any{}
			for rows.Next() {
				var action string
				var raw json.RawMessage
				var at any
				if e = rows.Scan(&action, &raw, &at); e != nil {
					break
				}
				events = append(events, map[string]any{"action": action, "data": raw, "createdAt": at})
			}
			if e == nil {
				e = rows.Err()
			}
			rows.Close()
			if len(events) > 500 {
				fail(w, 503, "timeline_capacity_exceeded")
				return
			}
			postings := []map[string]any{}
			journal, err := tx.Query(r.Context(), `SELECT o.id::text,o.effect_key,o.currency,o.amount_minor::text,o.state,COALESCE(j.blnk_reference,''),COALESCE(j.blnk_transaction_id,'') FROM ledger_operations o LEFT JOIN ledger_journal j ON j.operation_id=o.id WHERE o.namespace=$1 AND o.customer_id=$2 AND (o.evidence_ref=$3 OR ($4<>'' AND o.evidence_ref=$4)) ORDER BY o.created_at,o.id,j.id LIMIT 20`, svc.NS(), customer, "crypto-order:"+id, order.Evidence)
			if err != nil {
				cryptoFail(w, err)
				return
			}
			for journal.Next() {
				var operation, key, currency, amount, state, reference, transaction string
				if e = journal.Scan(&operation, &key, &currency, &amount, &state, &reference, &transaction); e != nil {
					break
				}
				postings = append(postings, map[string]any{"id": operation, "step": key, "currency": currency, "amountMinor": amount, "state": state, "reference": reference, "transactionId": transaction})
			}
			if e == nil {
				e = journal.Err()
			}
			journal.Close()
			out = map[string]any{"mode": svc.Mode(), "executionEligible": svc.Live != nil && !readOnly, "order": order, "events": events, "postings": postings}
		}
	} else {
		config, err := svc.Settings(r.Context(), tx)
		if err != nil {
			cryptoFail(w, err)
			return
		}
		snapshot, err := svc.Ledger.SnapshotTx(r.Context(), tx, customer)
		if err != nil {
			cryptoFail(w, err)
			return
		}
		var total int
		e = tx.QueryRow(r.Context(), `SELECT count(*) FROM crypto_orders WHERE namespace=$1 AND customer_id=$2 AND ($3='' OR kind=$3) AND ($4='' OR state=$4) AND ($5='' OR data->>'cardId'=$5)`, svc.NS(), customer, kind, status, cardID).Scan(&total)
		if e != nil {
			cryptoFail(w, e)
			return
		}
		rows, err := tx.Query(r.Context(), `SELECT data FROM crypto_orders WHERE namespace=$1 AND customer_id=$2 AND ($3='' OR kind=$3) AND ($4='' OR state=$4) AND ($5='' OR data->>'cardId'=$5) ORDER BY created_at DESC,id LIMIT $6 OFFSET $7`, svc.NS(), customer, kind, status, cardID, limit, page*limit)
		if err != nil {
			cryptoFail(w, err)
			return
		}
		orders := []json.RawMessage{}
		for rows.Next() {
			var raw json.RawMessage
			if e = rows.Scan(&raw); e != nil {
				break
			}
			orders = append(orders, raw)
		}
		if e == nil {
			e = rows.Err()
		}
		rows.Close()
		if e != nil {
			cryptoFail(w, e)
			return
		}
		rows, err = tx.Query(r.Context(), `SELECT address,network,mode,effective_at FROM crypto_addresses WHERE namespace=$1 AND customer_id=$2 AND mode=$3`, svc.NS(), customer, map[bool]string{true: "live", false: "synthetic"}[svc.Live != nil])
		if err != nil {
			cryptoFail(w, err)
			return
		}
		addresses := []map[string]any{}
		for rows.Next() {
			var a, n, m string
			var at any
			if e = rows.Scan(&a, &n, &m, &at); e != nil {
				break
			}
			addresses = append(addresses, map[string]any{"address": a, "network": n, "mode": m, "effectiveAt": at})
		}
		if e == nil {
			e = rows.Err()
		}
		rows.Close()
		if e != nil {
			cryptoFail(w, e)
			return
		}
		var pendingDeposit string
		if err := tx.QueryRow(r.Context(), "SELECT COALESCE(sum((data->>'amountMinor')::numeric),0)::text FROM crypto_orders WHERE namespace=$1 AND customer_id=$2 AND kind='deposit' AND state='processing'", svc.NS(), customer).Scan(&pendingDeposit); err != nil {
			cryptoFail(w, err)
			return
		}
		cards, err := svc.Cards(r.Context(), tx, customer, snapshot)
		if err != nil {
			cryptoFail(w, err)
			return
		}
		var canOperate bool
		err = tx.QueryRow(r.Context(), `SELECT onboarding_status='approved' AND service_status='active' FROM customers WHERE id=$1`, customer).Scan(&canOperate)
		if err != nil {
			cryptoFail(w, err)
			return
		}
		jobs := map[string]string{}
		jr, err := tx.Query(r.Context(), `SELECT network,state FROM funds_address_jobs WHERE namespace=$1 AND customer_id=$2`, svc.NS(), customer)
		if err != nil {
			cryptoFail(w, err)
			return
		}
		for jr.Next() {
			var n, state string
			if err = jr.Scan(&n, &state); err != nil {
				break
			}
			jobs[n] = state
		}
		if err == nil {
			err = jr.Err()
		}
		jr.Close()
		if err != nil {
			cryptoFail(w, err)
			return
		}
		out = map[string]any{"cards": cards, "addressJobs": jobs, "networks": svc.Capabilities(config), "canOperate": canOperate && !readOnly && (svc.Production == nil || svc.ProductionReady()), "capabilities": map[string]any{"currencies": []string{"USDT", "USD"}, "networks": []string{"TRC20", "ERC20"}, "realWrites": svc.Live != nil && !readOnly, "quoteSeconds": 60, "otcEnabled": config.OTCEnabled && !readOnly, "cardTransfersEnabled": svc.Live != nil && svc.Live.Cards != nil && !readOnly}, "pendingDepositsMinor": map[string]string{"USDT": pendingDeposit, "USD": "0"}, "mode": svc.Mode(), "executionEligible": svc.Live != nil && !readOnly, "customerId": customer, "settings": config, "ledger": snapshot, "orders": orders, "addresses": addresses, "total": total, "page": page}
	}
	if e == nil && !write {
		e = svc.Audit(r.Context(), tx, customer, "", p.ID, "read", map[string]string{"path": rest})
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		cryptoFail(w, e)
		return
	}
	respond(w, 200, map[string]any{"data": out})
}

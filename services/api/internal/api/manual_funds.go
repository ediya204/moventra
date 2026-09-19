package api

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"io"
	"log/slog"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/manualfunds"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// Formal balance reads do not activate manual money movement.
func (s *Server) manualService() *manualfunds.Service {
	svc := &manualfunds.Service{DB: s.DB, Ledger: s.Ledger}
	if svc.Ledger == nil {
		if funding, e := s.fundsReadService(); e == nil {
			svc.Ledger = funding.Ledger
			svc.ReadOnly = s.ProductionFunds == nil || !funding.Ledger.IsLive() || os.Getenv("FUNDS_PRODUCTION_MODE") != "enabled" || !s.ProductionFunds.ProductionReady()
		}
	}
	return svc
}

// Explicit activation reuses the verified production wallet, never the pilot.
// Schema checks are read-only; starting the worker does not create orders.
func (s *Server) CheckManualFunds(ctx context.Context) error {
	if os.Getenv("MANUAL_FUNDS_ENABLED") != "true" {
		return nil
	}
	// Preserve the legacy ledger profile and its separately managed worker.
	if s.Ledger != nil && s.ProductionFunds == nil {
		return database.ReadyManualFunds(ctx, s.DB)
	}
	if s.ProductionFunds == nil || os.Getenv("FUNDS_PRODUCTION_MODE") != "enabled" || s.Ledger != nil {
		return errors.New("manual_funds_production_profile_required")
	}
	return database.ReadyManualFunds(ctx, s.DB)
}

func (s *Server) drainManualFunds(ctx context.Context) error {
	if err := s.CheckManualFunds(ctx); err != nil {
		return err
	}
	svc := s.manualService()
	if !svc.Enabled() {
		return errors.New("manual_funds_disabled")
	}
	_, err := svc.Drain(ctx)
	return err
}

func (s *Server) RunManualFunds(ctx context.Context) {
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	for {
		work, cancel := context.WithTimeout(ctx, 45*time.Second)
		err := s.drainManualFunds(work)
		cancel()
		if err != nil {
			slog.Warn("manual funds awaiting recovery")
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
func manualFail(w http.ResponseWriter, e error) {
	var f *manualfunds.Fault
	if errors.As(e, &f) {
		fail(w, f.Status, f.Code)
	} else {
		fail(w, 503, "manual_funds_unavailable")
	}
}
func (s *Server) manualRoutes(mux *http.ServeMux) {
	for _, p := range []string{"/admin-api/v1/balances", "/admin-api/v1/balances/{customerID}"} {
		mux.Handle("GET "+p, s.authenticate(http.HandlerFunc(s.balancesAPI)))
	}
	for _, surface := range []string{"admin", "client"} {
		base := "/" + surface + "-api/v1/customers/{customerID}/manual-funds"
		mux.Handle("GET "+base, s.authenticate(http.HandlerFunc(s.manualAPI)))
		mux.Handle("GET "+base+"/orders/{orderID}", s.authenticate(http.HandlerFunc(s.manualAPI)))
		if surface == "admin" {
			mux.Handle("POST "+base+"/orders", s.authenticate(http.HandlerFunc(s.manualAPI)))
			mux.Handle("POST "+base+"/orders/{orderID}/{action}", s.authenticate(http.HandlerFunc(s.manualAPI)))
		}
	}
}
func pageQuery(r *http.Request, allowed ...string) (int, error) {
	page := 0
	for k, vs := range r.URL.Query() {
		ok := false
		for _, a := range allowed {
			ok = ok || k == a
		}
		if !ok || len(vs) != 1 {
			return 0, &manualfunds.Fault{Code: "invalid_query", Status: 400}
		}
		if k == "page" {
			n, e := strconv.Atoi(vs[0])
			if e != nil || n < 0 || n > 10000 {
				return 0, &manualfunds.Fault{Code: "invalid_query", Status: 400}
			}
			page = n
		}
	}
	return page, nil
}
func (s *Server) manualAPI(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	admin := strings.HasPrefix(r.URL.Path, "/admin-api/")
	write := r.Method == "POST"
	c, id := r.PathValue("customerID"), r.PathValue("orderID")
	if _, e := uuid.Parse(c); e != nil {
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
	allowed := []string{"page"}
	if write || id != "" {
		allowed = nil
	}
	page, e := pageQuery(r, allowed...)
	if e != nil {
		manualFail(w, e)
		return
	}
	svc := s.manualService()
	var in manualfunds.Input
	permission := "read"
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
		action := r.PathValue("action")
		if id == "" {
			action = "create"
		}
		if in.Action != "" && in.Action != action {
			fail(w, 400, "invalid_action")
			return
		}
		in.Action = action
		switch action {
		case "create", "cancel":
			permission = "create"
		case "approve", "reject":
			permission = "review"
		case "confirm_payment", "payment_failed", "reconcile":
			permission = "execute"
		default:
			fail(w, 404, "not_found")
			return
		}
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		manualFail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if admin {
		// Every action also requires read access; knowing an ID never grants a write.
		e = svc.Authorize(r.Context(), tx, p.ID, c, "read", false)
		if e == nil && write {
			e = svc.Authorize(r.Context(), tx, p.ID, c, permission, in.Action == "create" || in.Action == "approve")
		}
	} else {
		var ok bool
		e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM customers WHERE id=$1 AND kind='personal' AND personal_owner_id=$2)`, c, p.ID).Scan(&ok)
		if e == nil && !ok {
			fail(w, 404, "not_found")
			return
		}
	}
	if e != nil {
		manualFail(w, e)
		return
	}
	var out any
	if write {
		out, e = svc.Execute(r.Context(), tx, p.ID, c, id, r.Header.Get("Idempotency-Key"), in)
	} else if id != "" {
		o, err := svc.Get(r.Context(), tx, c, id)
		e = err
		if e == nil {
			events := []map[string]any{}
			rows, err := tx.Query(r.Context(), `SELECT action,created_at,COALESCE(actor_id::text,''),data FROM manual_funds_audit WHERE namespace=$1 AND customer_id=$2 AND order_id=$3 ORDER BY id DESC LIMIT 101`, svc.NS(), c, id)
			e = err
			if e == nil {
				for rows.Next() {
					var action, actor string
					var at time.Time
					var data json.RawMessage
					if e = rows.Scan(&action, &at, &actor, &data); e != nil {
						break
					}
					item := map[string]any{"action": action, "createdAt": at}
					if admin {
						item["actorId"] = actor
						item["data"] = data
					}
					events = append(events, item)
				}
				if e == nil {
					e = rows.Err()
				}
				rows.Close()
			}
			more := len(events) > 100
			if more {
				events = events[:100]
			}
			out = map[string]any{"order": visibleManualOrder(o, admin), "events": events, "eventsHasMore": more, "mode": svc.Mode(), "enabled": svc.Enabled()}
		}
	} else {
		orders, total, err := svc.List(r.Context(), tx, c, page)
		e = err
		visible := []any{}
		for _, o := range orders {
			visible = append(visible, visibleManualOrder(o, admin))
		}
		out = map[string]any{"orders": visible, "total": total, "page": page, "mode": svc.Mode(), "enabled": svc.Enabled()}
	}
	if e == nil && !write {
		e = svc.Audit(r.Context(), tx, c, id, p.ID, "read", map[string]any{"page": page, "admin": admin})
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		manualFail(w, e)
		return
	}
	respond(w, 200, map[string]any{"data": out})
}
func visibleManualOrder(o manualfunds.Order, admin bool) any {
	if admin {
		return o
	}
	return map[string]any{"id": o.ID, "customerId": o.CustomerID, "direction": o.Direction, "source": o.Source, "currency": o.Currency, "amountMinor": o.Amount, "state": o.State, "revision": o.Revision, "walletBeforeMinor": o.Before, "walletAfterMinor": o.After, "originalId": o.OriginalID, "createdAt": o.Created, "updatedAt": o.Updated}
}

type balanceRow struct {
	UserID     string  `json:"userId"`
	CustomerID string  `json:"customerId"`
	Name       string  `json:"name"`
	Email      *string `json:"email"`
	UID        string  `json:"-"`
	Status     string  `json:"status"`
	Onboarding string  `json:"onboarding"`
	Service    string  `json:"service"`
	Currency   string  `json:"currency"`
	Wallet     *string `json:"walletMinor"`
	Held       *string `json:"heldMinor"`
	Cards      *string `json:"cardsMinor"`
	Total      *string `json:"totalMinor"`
	Pending    int     `json:"pendingOperations"`
	Coverage   string  `json:"coverage"`
	Registered bool    `json:"walletRegistered"`
}

// Bounded, server-paged journal projection. It is never a spending decision or
// a statement of the upstream pool balance. Zero and missing wallet are distinct.
func (s *Server) balancesAPI(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	if !p.Identity.MFA {
		fail(w, 403, "mfa_required")
		return
	}
	c := r.PathValue("customerID")
	if c != "" {
		if _, e := uuid.Parse(c); e != nil {
			fail(w, 400, "invalid_customer_id")
			return
		}
	}
	allowed := []string{"page", "q", "currency", "status"}
	if c != "" {
		allowed = []string{"currency", "page"}
	}
	page, e := pageQuery(r, allowed...)
	if e != nil {
		manualFail(w, e)
		return
	}
	currency := r.URL.Query().Get("currency")
	if currency == "" {
		currency = "USD"
	}
	if currency != "USD" && currency != "USDT" {
		fail(w, 400, "invalid_currency")
		return
	}
	q, status := strings.TrimSpace(r.URL.Query().Get("q")), r.URL.Query().Get("status")
	if len(q) > 200 || (status != "" && status != "active" && status != "disabled") {
		fail(w, 400, "invalid_query")
		return
	}
	svc := s.manualService()
	tx, e := s.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if e != nil {
		manualFail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var anyGrant bool
	e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM effective_manual_funds_grants WHERE user_id=$1 AND permission='read')`, p.ID).Scan(&anyGrant)
	if e != nil {
		manualFail(w, e)
		return
	}
	if !anyGrant {
		fail(w, 403, "balance_read_required")
		return
	}
	uid := ""
	if strings.Contains(q, "@") {
		if s.Directory == nil {
			fail(w, 503, "identity_directory_unavailable")
			return
		}
		identity, err := s.Directory.ByEmail(r.Context(), q)
		if err != nil {
			fail(w, 503, "identity_directory_unavailable")
			return
		}
		uid = "__identity_not_found__"
		if identity != nil {
			uid = identity.UID
		}
		q = ""
	}
	base := `WITH scoped AS (SELECT u.id user_id,u.firebase_uid,u.display_name,u.status,c.id customer_id,COALESCE(c.onboarding_status,'') onboarding,COALESCE(c.service_status,'') service
 FROM users u LEFT JOIN customers c ON c.personal_owner_id=u.id AND c.kind='personal'
 WHERE u.role='customer' AND ($2='' OR c.id::text=$2) AND ($3='' OR position(lower($3) in lower(u.display_name))>0 OR c.id::text=$3) AND ($4='' OR u.firebase_uid=$4) AND ($5='' OR u.status=$5)
 AND EXISTS(SELECT 1 FROM effective_manual_funds_grants g WHERE g.user_id=$1 AND g.permission='read' AND (g.scope='*' OR g.scope=c.id::text)))`
	args := []any{p.ID, c, q, uid, status}
	var total int
	if e = tx.QueryRow(r.Context(), base+` SELECT count(*) FROM scoped`, args...).Scan(&total); e != nil {
		manualFail(w, e)
		return
	}
	if c != "" && total == 0 {
		fail(w, 404, "not_found")
		return
	}
	offset := page * 20
	if c != "" {
		offset = 0
	}
	args = append(args, offset)
	rows, e := tx.Query(r.Context(), base+` SELECT user_id::text,COALESCE(customer_id::text,''),firebase_uid,display_name,status,onboarding,service FROM scoped ORDER BY user_id LIMIT 20 OFFSET $6`, args...)
	if e != nil {
		manualFail(w, e)
		return
	}
	out := []balanceRow{}
	uids := []string{}
	for rows.Next() {
		var b balanceRow
		if e = rows.Scan(&b.UserID, &b.CustomerID, &b.UID, &b.Name, &b.Status, &b.Onboarding, &b.Service); e != nil {
			break
		}
		b.Currency = currency
		b.Coverage = "not_opened"
		out = append(out, b)
		uids = append(uids, b.UID)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		manualFail(w, e)
		return
	}
	if len(uids) > 0 {
		if s.Directory == nil {
			fail(w, 503, "identity_directory_unavailable")
			return
		}
		identities, err := s.Directory.ByUIDs(r.Context(), uids)
		if err != nil {
			fail(w, 503, "identity_directory_unavailable")
			return
		}
		for i := range out {
			if identity, ok := identities[out[i].UID]; ok {
				email := identity.Email
				out[i].Email = &email
			}
		}
	}
	// SQL aggregation covers every filtered user, not only the current page.
	totals := map[string]any{"walletMinor": nil, "heldMinor": nil, "cardsMinor": nil, "totalMinor": nil, "coverage": "ledger_disabled"}
	if svc.Ledger != nil {
		for i := range out {
			b := &out[i]
			if b.CustomerID == "" {
				continue
			}
			if e = balanceAmounts(r, tx, svc.NS(), b); e != nil {
				manualFail(w, e)
				return
			}
		}
		// The global report explicitly returns journal-only figures. Pending work and
		// unmapped cards remain separate coverage information on each customer.
		summary := base + `, amounts AS (
 SELECT a.id,a.kind,COALESCE(sum(CASE WHEN j.destination_id=a.id THEN j.amount_minor ELSE -j.amount_minor END),0) amount
 FROM ledger_accounts a JOIN scoped s ON s.customer_id=a.customer_id LEFT JOIN ledger_journal j ON j.source_id=a.id OR j.destination_id=a.id
 WHERE a.namespace=$6 AND a.currency=$7 AND a.kind IN ('wallet','card','escrow','transit') GROUP BY a.id,a.kind)
 SELECT COALESCE(sum(amount) FILTER(WHERE kind='wallet'),0)::text,COALESCE(sum(amount) FILTER(WHERE kind IN ('escrow','transit')),0)::text,COALESCE(sum(amount) FILTER(WHERE kind='card'),0)::text,COALESCE(sum(amount),0)::text FROM amounts`
		var wallet, held, cards, all string
		e = tx.QueryRow(r.Context(), summary, p.ID, c, q, uid, status, svc.NS(), currency).Scan(&wallet, &held, &cards, &all)
		if e != nil {
			manualFail(w, e)
			return
		}
		totals = map[string]any{"walletMinor": wallet, "heldMinor": held, "cardsMinor": cards, "totalMinor": all, "coverage": "journal_only"}
	} else {
		for i := range out {
			out[i].Coverage = "ledger_disabled"
		}
	}
	result := map[string]any{"rows": out, "total": total, "page": page, "currency": currency, "summary": totals, "mode": svc.Mode(), "enabled": svc.Enabled(), "observedAt": time.Now().UTC(), "source": "ledger_journal", "externalReconciliation": "not_checked"}
	if c != "" {
		permissions := []string{}
		for _, permission := range []string{"read", "create", "review", "execute"} {
			ok, err := manualfunds.Allowed(r.Context(), tx, p.ID, c, permission)
			if err != nil {
				manualFail(w, err)
				return
			}
			if ok {
				permissions = append(permissions, permission)
			}
		}
		result["permissions"] = permissions
		orders, count, err := svc.List(r.Context(), tx, c, page)
		if err != nil {
			manualFail(w, err)
			return
		}
		result["orders"] = orders
		result["orderTotal"] = count
		if svc.Ledger != nil {
			if err := manualLedgerRows(r, tx, svc.NS(), c, currency, page, result); err != nil {
				manualFail(w, err)
				return
			}
		}
	}
	if e = svc.Audit(r.Context(), tx, c, "", p.ID, "balances:read", map[string]any{"page": page, "currency": currency, "count": len(out)}); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		manualFail(w, e)
		return
	}
	respond(w, 200, map[string]any{"data": result})
}
func balanceAmounts(r *http.Request, tx pgx.Tx, ns string, b *balanceRow) error {
	var wallet, held, cards, total string
	e := tx.QueryRow(r.Context(), `WITH amounts AS(SELECT a.id,a.kind,COALESCE(sum(CASE WHEN j.destination_id=a.id THEN j.amount_minor ELSE -j.amount_minor END),0) amount FROM ledger_accounts a LEFT JOIN ledger_journal j ON j.source_id=a.id OR j.destination_id=a.id WHERE a.namespace=$1 AND a.customer_id=$2 AND a.currency=$3 AND a.kind IN ('wallet','card','escrow','transit') GROUP BY a.id,a.kind)
 SELECT EXISTS(SELECT 1 FROM amounts WHERE kind='wallet'),COALESCE(sum(amount) FILTER(WHERE kind='wallet'),0)::text,COALESCE(sum(amount) FILTER(WHERE kind IN ('escrow','transit')),0)::text,COALESCE(sum(amount) FILTER(WHERE kind='card'),0)::text,COALESCE(sum(amount),0)::text FROM amounts`, ns, b.CustomerID, b.Currency).Scan(&b.Registered, &wallet, &held, &cards, &total)
	if e != nil {
		return e
	}
	if !b.Registered {
		return nil
	}
	b.Wallet = &wallet
	b.Held = &held
	b.Cards = &cards
	b.Total = &total
	b.Coverage = "journal_only"
	e = tx.QueryRow(r.Context(), `SELECT count(*) FROM ledger_operations WHERE namespace=$1 AND customer_id=$2 AND currency=$3 AND state NOT IN ('applied','released','rejected')`, ns, b.CustomerID, b.Currency).Scan(&b.Pending)
	if e != nil {
		return e
	}
	if b.Pending > 0 {
		b.Coverage = "pending_reconciliation"
	}
	return nil
}

func manualLedgerRows(r *http.Request, tx pgx.Tx, ns, c, currency string, page int, out map[string]any) error {
	var total int
	e := tx.QueryRow(r.Context(), `SELECT count(*) FROM ledger_journal j JOIN ledger_operations o ON o.id=j.operation_id WHERE o.namespace=$1 AND o.customer_id=$2 AND o.currency=$3`, ns, c, currency).Scan(&total)
	if e != nil {
		return e
	}
	rows, e := tx.Query(r.Context(), `SELECT j.id::text,o.id::text,o.kind,o.evidence_ref,j.amount_minor::text,a.kind,b.kind,j.created_at FROM ledger_journal j JOIN ledger_operations o ON o.id=j.operation_id JOIN ledger_accounts a ON a.id=j.source_id JOIN ledger_accounts b ON b.id=j.destination_id WHERE o.namespace=$1 AND o.customer_id=$2 AND o.currency=$3 ORDER BY j.id DESC LIMIT 20 OFFSET $4`, ns, c, currency, page*20)
	if e != nil {
		return e
	}
	movements := []map[string]any{}
	for rows.Next() {
		var id, op, kind, evidence, amount, from, to string
		var at time.Time
		if e = rows.Scan(&id, &op, &kind, &evidence, &amount, &from, &to, &at); e != nil {
			break
		}
		movements = append(movements, map[string]any{"id": id, "operationId": op, "kind": kind, "evidenceRef": evidence, "amountMinor": amount, "from": from, "to": to, "createdAt": at})
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return e
	}
	out["movements"] = movements
	out["movementTotal"] = total
	if e = tx.QueryRow(r.Context(), `SELECT count(*) FROM ledger_accounts WHERE namespace=$1 AND customer_id=$2 AND kind='card' AND currency=$3`, ns, c, currency).Scan(&total); e != nil {
		return e
	}
	rows, e = tx.Query(r.Context(), `SELECT a.id::text,a.account_key,a.connection_id,a.external_card_id,COALESCE(sum(CASE WHEN j.destination_id=a.id THEN j.amount_minor ELSE -j.amount_minor END),0)::text FROM ledger_accounts a LEFT JOIN ledger_journal j ON j.source_id=a.id OR j.destination_id=a.id WHERE a.namespace=$1 AND a.customer_id=$2 AND a.kind='card' AND a.currency=$3 GROUP BY a.id ORDER BY a.id LIMIT 20 OFFSET $4`, ns, c, currency, page*20)
	if e != nil {
		return e
	}
	defer rows.Close()
	cards := []map[string]string{}
	for rows.Next() {
		var id, name, conn, external, amount string
		if e = rows.Scan(&id, &name, &conn, &external, &amount); e != nil {
			return e
		}
		cards = append(cards, map[string]string{"id": id, "name": name, "connection": conn, "cardId": external, "amountMinor": amount})
	}
	out["cards"] = cards
	out["cardTotal"] = total
	return rows.Err()
}

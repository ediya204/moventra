package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	DB        *pgxpool.Pool
	Verifier  Verifier
	Directory UserDirectory
}
type principal struct {
	ID       string
	Identity Identity
	Role     string
}
type principalKey struct{}

func respond(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
func fail(w http.ResponseWriter, status int, code string) {
	respond(w, status, map[string]any{"error": map[string]string{"code": code}})
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		var version int
		if err := s.DB.QueryRow(r.Context(), `SELECT version FROM schema_migrations WHERE version=5`).Scan(&version); err != nil {
			fail(w, 503, "not_ready")
			return
		}
		respond(w, 200, map[string]string{"status": "ready"})
	})
	mux.Handle("GET /admin-api/v1/channel-projections", s.authenticate(http.HandlerFunc(s.channelRead)))
	mux.Handle("GET /admin-api/v1/channel-projections/{connection}/{resource}", s.authenticate(http.HandlerFunc(s.channelRead)))
	mux.Handle("GET /admin-api/v1/channel-projections/{connection}/{resource}/{id}", s.authenticate(http.HandlerFunc(s.channelRead)))
	mux.HandleFunc("POST /api/v1/register", s.register)
	mux.Handle("GET /admin-api/v1/users", s.authenticate(http.HandlerFunc(s.userDirectory)))
	mux.Handle("GET /api/v1/me", s.authenticate(http.HandlerFunc(s.me)))
	mux.Handle("GET /client-api/v1/me", s.authenticate(http.HandlerFunc(s.me)))
	mux.Handle("GET /admin-api/v1/me", s.authenticate(http.HandlerFunc(s.me)))
	mux.Handle("GET /admin-api/v1/ops/overview", s.authenticate(http.HandlerFunc(s.opsOverview)))
	mux.Handle("POST /client-api/v1/customers/{customerID}/business-upgrade", s.authenticate(http.HandlerFunc(s.submitUpgrade)))
	mux.Handle("GET /client-api/v1/customers/{customerID}/business-upgrade", s.authenticate(http.HandlerFunc(s.getUpgrade)))
	for _, surface := range []string{"client", "admin"} {
		for _, method := range []string{"GET", "POST"} {
			mux.Handle(method+" /"+surface+"-api/v1/customers/{customerID}/onboarding", s.authenticate(s.onboarding(surface == "admin")))
		}
		for _, resource := range []string{"accounts", "transactions"} {
			mux.Handle("GET /"+surface+"-api/v1/customers/{customerID}/"+resource, s.authenticate(s.query(surface, resource)))
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		mux.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Fields(r.Header.Get("Authorization"))
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			fail(w, 401, "unauthenticated")
			return
		}
		identity, err := s.Verifier.Verify(r.Context(), parts[1])
		if err != nil || identity.UID == "" {
			fail(w, 401, "unauthenticated")
			return
		}
		var id, status, role string
		err = s.DB.QueryRow(r.Context(), `SELECT id::text,status,role FROM users WHERE firebase_uid=$1`, identity.UID).Scan(&id, &status, &role)
		if errors.Is(err, pgx.ErrNoRows) {
			fail(w, 403, "registration_required")
			return
		}
		if err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		if status != "active" {
			fail(w, 403, "user_disabled")
			return
		}
		if strings.HasPrefix(r.URL.Path, "/admin-api/") && role != "admin" {
			fail(w, 403, "operator_required")
			return
		}
		if strings.HasPrefix(r.URL.Path, "/client-api/") && role != "customer" {
			fail(w, 403, "customer_required")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, principal{id, identity, role})))
	})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	rows, err := s.DB.Query(r.Context(), `SELECT c.id::text,c.kind,c.name FROM customers c WHERE c.personal_owner_id=$1 OR EXISTS(SELECT 1 FROM memberships m WHERE m.customer_id=c.id AND m.user_id=$1 AND m.status='active') ORDER BY c.id`, p.ID)
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	defer rows.Close()
	customers := []map[string]string{}
	for rows.Next() {
		var id, kind, name string
		if err = rows.Scan(&id, &kind, &name); err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		customers = append(customers, map[string]string{"id": id, "kind": kind, "name": name})
	}
	if rows.Err() != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	rows.Close()
	operator := p.Role == "admin"
	if operator {
		customers = []map[string]string{}
	}
	scopes := []map[string]string{}
	// Scope discovery is gated by MFA too; it does not grant access. Every data
	// request rechecks staff_grants and the verified token independently.
	if operator && p.Identity.MFA {
		grants, err := s.DB.Query(r.Context(), `SELECT g.customer_id::text,c.name,g.permission FROM staff_grants g JOIN customers c ON c.id=g.customer_id WHERE g.user_id=$1 ORDER BY g.customer_id,g.permission`, p.ID)
		if err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		defer grants.Close()
		for grants.Next() {
			var id, name, permission string
			if err = grants.Scan(&id, &name, &permission); err != nil {
				fail(w, 503, "temporarily_unavailable")
				return
			}
			scopes = append(scopes, map[string]string{"customerId": id, "name": name, "permission": permission})
		}
		if grants.Err() != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
	}
	respond(w, 200, map[string]any{"data": map[string]any{"id": p.ID, "role": p.Role, "customers": customers, "operator": operator, "mfaVerified": p.Identity.MFA, "requiresMfa": operator && !p.Identity.MFA, "staffScopes": scopes}})
}

func (s *Server) query(surface, resource string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.Context().Value(principalKey{}).(principal)
		customerID := r.PathValue("customerID")
		if _, err := uuid.Parse(customerID); err != nil {
			fail(w, 400, "invalid_customer_id")
			return
		}
		limit, offset := 50, 0
		for key, values := range r.URL.Query() {
			if (key != "limit" && key != "offset") || len(values) != 1 {
				fail(w, 400, "invalid_query")
				return
			}
			n, err := strconv.Atoi(values[0])
			if err != nil {
				fail(w, 400, "invalid_pagination")
				return
			}
			if key == "limit" {
				limit = n
			} else {
				offset = n
			}
		}
		if limit < 1 || limit > 100 || offset < 0 || offset > 10000 {
			fail(w, 400, "invalid_pagination")
			return
		}
		if surface == "admin" && !p.Identity.MFA {
			fail(w, 403, "mfa_required")
			return
		}
		// Repeatable-read provides a consistent authorization/data/audit snapshot.
		tx, err := s.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
		if err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		defer tx.Rollback(r.Context())
		var allowed bool
		if surface == "admin" {
			err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM staff_grants WHERE user_id=$1 AND customer_id=$2 AND permission=$3)`, p.ID, customerID, resource+":read").Scan(&allowed)
		} else {
			err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM customers c WHERE c.id=$2 AND (c.personal_owner_id=$1 OR EXISTS(SELECT 1 FROM memberships m WHERE m.customer_id=c.id AND m.user_id=$1 AND m.status='active')))`, p.ID, customerID).Scan(&allowed)
		}
		if err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		// Same response for nonexistent and inaccessible customers.
		if !allowed {
			fail(w, 404, "not_found")
			return
		}
		var rows pgx.Rows
		if resource == "accounts" {
			rows, err = tx.Query(r.Context(), `SELECT id::text,parent_id::text,name,status FROM accounts WHERE customer_id=$1 ORDER BY id LIMIT $2 OFFSET $3`, customerID, limit+1, offset)
		} else {
			rows, err = tx.Query(r.Context(), `SELECT id::text,account_id::text,currency,amount_minor::text,direction,status,occurred_at FROM transactions WHERE customer_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT $2 OFFSET $3`, customerID, limit+1, offset)
		}
		if err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		data := []map[string]any{}
		for rows.Next() {
			if resource == "accounts" {
				var id, name, status string
				var parent *string
				err = rows.Scan(&id, &parent, &name, &status)
				data = append(data, map[string]any{"id": id, "customerId": customerID, "parentId": parent, "name": name, "status": status})
			} else {
				var id, account, currency, amount, direction, status string
				var occurred time.Time
				err = rows.Scan(&id, &account, &currency, &amount, &direction, &status, &occurred)
				scale := 2
				if currency == "USDT" {
					scale = 6
				}
				data = append(data, map[string]any{"id": id, "customerId": customerID, "accountId": account, "currency": currency, "amountMinor": amount, "scale": scale, "direction": direction, "status": status, "occurredAt": occurred.UTC().Format(time.RFC3339Nano)})
			}
			if err != nil {
				break
			}
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		if err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		if surface == "admin" {
			_, err = tx.Exec(r.Context(), `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,$3)`, p.ID, customerID, resource+":read")
			if err != nil {
				fail(w, 503, "temporarily_unavailable")
				return
			}
		}
		if err = tx.Commit(r.Context()); err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		hasMore := len(data) > limit
		if hasMore {
			data = data[:limit]
		}
		respond(w, 200, map[string]any{"data": data, "meta": map[string]any{"limit": limit, "offset": offset, "hasMore": hasMore}})
	})
}

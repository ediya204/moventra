package api

import (
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5/pgconn"
	"io"
	"moventra.local/api/internal/issuing"
	"net/http"
	"strconv"
	"strings"
)

func decodeIssuing(w http.ResponseWriter, r *http.Request, v any) error {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return issuing.ErrInvalid
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32768))
	d.DisallowUnknownFields()
	if d.Decode(v) != nil {
		return issuing.ErrInvalid
	}
	if d.Decode(new(any)) != io.EOF {
		return issuing.ErrInvalid
	}
	return nil
}
func (s *Server) issuingRoutes(mux *http.ServeMux) {
	for _, m := range []string{"GET", "POST"} {
		for _, suffix := range []string{"/{resource}", "/{resource}/{id}"} {
			mux.Handle(m+" /admin-api/v1/card-issuing"+suffix, s.authenticate(http.HandlerFunc(s.issuingAPI)))
			for _, surface := range []string{"client", "admin"} {
				mux.Handle(m+" /"+surface+"-api/v1/customers/{customerID}/card-issuing"+suffix, s.authenticate(http.HandlerFunc(s.issuingAPI)))
			}
		}
	}
}
func (s *Server) issuingAPI(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	ctx := r.Context()
	customer, resource, id := r.PathValue("customerID"), r.PathValue("resource"), r.PathValue("id")
	admin := strings.HasPrefix(r.URL.Path, "/admin-api/")
	write := r.Method == "POST"
	if customer != "" && !issuing.ValidID(customer) || id != "" && !issuing.ValidID(id) {
		fail(w, 400, "invalid_issuing_request")
		return
	}
	// Enforce exact resource/method/surface combinations at origin as well as gateway.
	validRoute := false
	if customer == "" && admin {
		if write {
			validRoute = resource == "suppliers" || resource == "products" || resource == "groups" || (resource == "prices" && id == "")
		} else {
			validRoute = resource == "suppliers" || resource == "products" || resource == "groups" || (resource == "audit" && id == "")
		}
	} else if customer != "" {
		if write {
			if admin {
				validRoute = (id == "" && (resource == "enrollment" || resource == "deposits")) || (id != "" && (resource == "deposit-reviews" || resource == "recoveries"))
			} else {
				validRoute = id == "" && (resource == "quotes" || resource == "orders" || resource == "topups")
			}
		} else {
			validRoute = resource == "orders" || resource == "cards" || resource == "products" || (id == "" && (resource == "terms" || resource == "wallet" || (admin && (resource == "enrollment" || resource == "deposits" || resource == "audit" || resource == "reconciliation"))))
		}
	}
	if !validRoute {
		fail(w, 404, "not_found")
		return
	}
	offset := 0
	for k, vs := range r.URL.Query() {
		if write || len(vs) != 1 || (k != "q" && k != "status" && k != "page") {
			fail(w, 400, "invalid_query")
			return
		}
	}
	if q := r.URL.Query().Get("page"); q != "" {
		n, e := strconv.Atoi(q)
		if e != nil || n < 1 || n > 2000 {
			fail(w, 400, "invalid_query")
			return
		}
		offset = (n - 1) * 50
	}
	if len(r.URL.Query().Get("q")) > 180 {
		fail(w, 400, "invalid_query")
		return
	}
	permission := "catalog:read"
	if customer != "" {
		permission = "customer:read"
	}
	if write {
		switch resource {
		case "suppliers", "products", "groups":
			permission = "catalog:write"
		case "prices":
			permission = "pricing:write"
		case "enrollment":
			permission = "customer:write"
		case "deposits":
			permission = "funding:submit"
		case "deposit-reviews":
			permission = "funding:review"
		case "recoveries":
			permission = "recovery:write"
		case "quotes", "orders", "topups":
			if admin {
				fail(w, 404, "not_found")
				return
			}
		default:
			fail(w, 404, "not_found")
			return
		}
	}
	if admin && !p.Identity.MFA {
		fail(w, 403, "mfa_required")
		return
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	defer tx.Rollback(ctx)
	allowed := false
	if admin {
		scope := customer
		if scope == "" {
			scope = "catalog"
		}
		e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM effective_issuing_grants WHERE user_id=$1 AND scope_id=$2 AND permission=$3)`, p.ID, scope, permission).Scan(&allowed)
	} else if customer != "" {
		e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM customers WHERE id=$1 AND personal_owner_id=$2 AND kind='personal')`, customer, p.ID).Scan(&allowed)
	}
	if e != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if !allowed {
		fail(w, 404, "not_found")
		return
	}
	svc := s.Issuing
	if svc == nil {
		svc = &issuing.Service{DB: s.DB}
	}
	var auditDetail any = map[string]string{"resource": resource}
	var result any = map[string]any{"saved": true}
	if !write {
		if customer == "" {
			result, e = issuing.Catalog(ctx, tx, resource, id, r.URL.Query().Get("q"), r.URL.Query().Get("status"), offset)
		} else {
			switch resource {
			case "products":
				if id != "" {
					result, e = svc.ClientProduct(ctx, tx, customer, id)
				} else {
					result, e = svc.ClientProducts(ctx, tx, customer, r.URL.Query().Get("q"), offset)
				}
			case "terms":
				result = svc.Terms()
			case "cards":
				result, e = svc.Cards(ctx, tx, customer, id, offset)
			case "reconciliation":
				result, e = svc.Reconciliation(ctx, tx, customer)
			case "wallet":
				var balance string
				balance, e = svc.Wallet(ctx, tx, customer)
				result = map[string]any{"currency": "USD", "availableMinor": balance, "mode": svc.Mode, "fundingSource": svc.FundingSource(), "executionEnabled": svc.Enabled}
			case "orders":
				result, e = issuing.CustomerRead(ctx, tx, customer, resource, id, offset)
			default:
				if !admin {
					e = issuing.ErrNotFound
				} else {
					result, e = issuing.CustomerRead(ctx, tx, customer, resource, id, offset)
				}
			}
		}
	} else {
		switch resource {
		case "suppliers":
			var v issuing.Supplier
			e = decodeIssuing(w, r, &v)
			auditDetail = v
			if e == nil {
				if v.ID != id {
					e = issuing.ErrInvalid
				} else {
					result, e = issuing.SaveSupplier(ctx, tx, v)
				}
			}
		case "products":
			var v issuing.Product
			e = decodeIssuing(w, r, &v)
			auditDetail = v
			if e == nil {
				if v.ID != id {
					e = issuing.ErrInvalid
				} else {
					var pricing bool
					e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM effective_issuing_grants WHERE user_id=$1 AND scope_id='catalog' AND permission='pricing:write')`, p.ID).Scan(&pricing)
					if e == nil && !pricing {
						var unchanged bool
						if id != "" {
							e = tx.QueryRow(ctx, `SELECT COALESCE(fee_minor::text,'')=$2 AND COALESCE(minimum_minor::text,'')=$3 FROM issuing_products WHERE id=$1`, id, v.FeeMinor, v.MinimumMinor).Scan(&unchanged)
						} else {
							unchanged = v.FeeMinor == "" && v.MinimumMinor == ""
						}
						if e == nil && !unchanged {
							e = issuing.ErrForbidden
						}
					}
					if e == nil {
						result, e = issuing.SaveProduct(ctx, tx, v)
					}
				}
			}
		case "prices":
			var v issuing.Price
			e = decodeIssuing(w, r, &v)
			auditDetail = v
			if e == nil {
				e = issuing.SavePrice(ctx, tx, v)
			}
		case "groups":
			var v struct {
				ID       string `json:"id"`
				Name     string `json:"name"`
				Revision int64  `json:"revision"`
			}
			e = decodeIssuing(w, r, &v)
			auditDetail = v
			if e == nil {
				if v.ID != id {
					e = issuing.ErrInvalid
				} else {
					result, e = issuing.Group(ctx, tx, v.ID, v.Name, v.Revision)
				}
			}
		case "enrollment":
			var v issuing.Enrollment
			e = decodeIssuing(w, r, &v)
			auditDetail = v
			if e == nil {
				if v.CustomerID != customer {
					e = issuing.ErrInvalid
				} else {
					e = issuing.SaveEnrollment(ctx, tx, v)
				}
			}
		case "quotes":
			var v struct {
				ProductID    string `json:"productId"`
				FundingMinor string `json:"fundingMinor"`
			}
			e = decodeIssuing(w, r, &v)
			auditDetail = v
			if e == nil {
				result, e = svc.Quote(ctx, tx, customer, v.ProductID, v.FundingMinor)
			}
		case "orders":
			var v issuing.Checkout
			e = decodeIssuing(w, r, &v)
			auditDetail = v
			if e == nil {
				result, e = svc.Checkout(ctx, tx, customer, p.ID, r.Header.Get("Idempotency-Key"), v)
			}
		case "topups":
			var v struct {
				OrderID      string `json:"orderId"`
				FundingMinor string `json:"fundingMinor"`
			}
			e = decodeIssuing(w, r, &v)
			auditDetail = v
			if e == nil {
				result, e = svc.Topup(ctx, tx, customer, v.OrderID, r.Header.Get("Idempotency-Key"), v.FundingMinor)
			}
		case "deposits":
			if svc.Funds != nil {
				e = issuing.ErrBlocked
				break
			}
			var v struct {
				AmountMinor string `json:"amountMinor"`
				EvidenceRef string `json:"evidenceRef"`
			}
			e = decodeIssuing(w, r, &v)
			auditDetail = v
			if e == nil {
				result, e = issuing.Deposit(ctx, tx, customer, p.ID, v.AmountMinor, v.EvidenceRef)
			}
		case "deposit-reviews":
			if svc.Funds != nil {
				e = issuing.ErrBlocked
				break
			}
			var v struct {
				Revision int64 `json:"revision"`
				Approve  bool  `json:"approve"`
			}
			e = decodeIssuing(w, r, &v)
			auditDetail = v
			if e == nil {
				e = issuing.ReviewDeposit(ctx, tx, customer, p.ID, id, v.Revision, v.Approve)
			}
		case "recoveries":
			var v struct {
				EvidenceRef string `json:"evidenceRef"`
			}
			e = decodeIssuing(w, r, &v)
			auditDetail = v
			if e == nil {
				if len(v.EvidenceRef) < 1 || len(v.EvidenceRef) > 300 {
					e = issuing.ErrInvalid
				} else {
					var exists bool
					e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_orders WHERE customer_id=$1 AND id=$2)`, customer, id).Scan(&exists)
					if e == nil && !exists {
						e = issuing.ErrNotFound
					}
					if e == nil {
						var tag pgconn.CommandTag
						tag, e = tx.Exec(ctx, `UPDATE issuing_orders SET next_attempt_at=now(),state=CASE WHEN state='review_required' THEN 'provider_unknown' ELSE state END WHERE customer_id=$1 AND id=$2 AND (state IN ('provider_unknown','creating','enabling','created','fee_charged','funded','releasing') OR (state='review_required' AND error_code='card_restriction_unverified'))`, customer, id)
						if e == nil && tag.RowsAffected() != 1 {
							e = issuing.ErrConflict
						}
						result = map[string]any{"queuedForVerification": true}
						if e == nil {
							e = issuing.Audit(ctx, tx, p.ID, customer, id, "recovery.request", v)
						}
					}
				}
			}
		}
	}
	if e == nil {
		if write {
			auditDetail = map[string]any{"request": auditDetail, "result": result}
		}
		e = issuing.Audit(ctx, tx, p.ID, customer, resource+"/"+id, r.Method+".issuing", auditDetail)
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		status, code := 503, "temporarily_unavailable"
		switch {
		case errors.Is(e, issuing.ErrConsent):
			status, code = 400, e.Error()
		case errors.Is(e, issuing.ErrTerms):
			status, code = 409, e.Error()
		case errors.Is(e, issuing.ErrInvalid):
			status, code = 400, e.Error()
		case errors.Is(e, issuing.ErrNotFound):
			status, code = 404, e.Error()
		case errors.Is(e, issuing.ErrConflict):
			status, code = 409, e.Error()
		case errors.Is(e, issuing.ErrBlocked):
			status, code = 409, e.Error()
		case errors.Is(e, issuing.ErrInsufficient):
			status, code = 409, e.Error()
		}
		var pg *pgconn.PgError
		if errors.As(e, &pg) && (pg.Code == "23505" || pg.Code == "23503" || pg.Code == "23514") {
			status, code = 409, "record_conflict"
		}
		fail(w, status, code)
		return
	}
	respond(w, 200, map[string]any{"data": result})
}

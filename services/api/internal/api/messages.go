package api

import (
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"io"
	"moventra.local/api/internal/messages"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

func (s *Server) messageRoutes(mux *http.ServeMux) {
	for _, surface := range []string{"client", "admin"} {
		base := "/client-api/v1/customers/{customerID}/messages"
		if surface == "admin" {
			base = "/admin-api/v1/message-campaigns"
		}
		for _, method := range []string{"GET", "POST"} {
			for _, suffix := range []string{"", "/{rest...}"} {
				mux.Handle(method+" "+base+suffix, s.authenticate(http.HandlerFunc(s.messageAPI)))
			}
		}
	}
}
func messageFail(w http.ResponseWriter, e error) {
	var f *messages.Fault
	if errors.As(e, &f) {
		fail(w, f.Status, f.Code)
	} else {
		fail(w, 503, "messages_unavailable")
	}
}
func (s *Server) messageAPI(w http.ResponseWriter, r *http.Request) {
	svc := s.Messages
	if svc == nil {
		fail(w, 503, "messages_disabled")
		return
	}
	p := r.Context().Value(principalKey{}).(principal)
	admin := strings.HasPrefix(r.URL.Path, "/admin-api/")
	write := r.Method == "POST"
	rest := r.PathValue("rest")
	customer := r.PathValue("customerID")
	if admin && !p.Identity.MFA {
		fail(w, 403, "mfa_required")
		return
	}
	if !admin {
		if _, e := uuid.Parse(customer); e != nil {
			fail(w, 400, "invalid_customer_id")
			return
		}
	}
	var in struct {
		messages.Draft
		Snapshot string `json:"snapshotToken"`
	}
	if write {
		if r.URL.RawQuery != "" {
			fail(w, 400, "invalid_query")
			return
		}
		if r.Header.Get("Content-Type") != "application/json" {
			fail(w, 415, "json_required")
			return
		}
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32768))
		d.DisallowUnknownFields()
		if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
			fail(w, 400, "invalid_body")
			return
		}
	}
	q := messages.Query{Limit: 20}
	page := 0
	for k, values := range r.URL.Query() {
		if len(values) != 1 {
			fail(w, 400, "invalid_query")
			return
		}
		v := values[0]
		if admin {
			if k != "page" || rest != "" && !strings.HasSuffix(rest, "/recipients") {
				fail(w, 400, "invalid_query")
				return
			}
			n, e := strconv.Atoi(v)
			if e != nil || n < 0 || n > 500 {
				fail(w, 400, "invalid_query")
				return
			}
			page = n
		} else {
			if rest != "" {
				fail(w, 400, "invalid_query")
				return
			}
			switch k {
			case "category":
				if v != "" && v != "otc" && v != "letter" && v != "system" {
					fail(w, 400, "invalid_query")
					return
				}
				q.Category = v
			case "status":
				if v != "" && v != "read" && v != "unread" {
					fail(w, 400, "invalid_query")
					return
				}
				q.Status = v
			case "q":
				if utf8.RuneCountInString(v) > 100 || strings.ContainsRune(v, 0) {
					fail(w, 400, "invalid_query")
					return
				}
				q.Q = v
			case "cursor":
				if len(v) > 2000 {
					fail(w, 400, "invalid_query")
					return
				}
				q.Cursor = v
			case "limit":
				n, e := strconv.Atoi(v)
				if e != nil || n < 1 || n > 100 {
					fail(w, 400, "invalid_query")
					return
				}
				q.Limit = n
			default:
				fail(w, 400, "invalid_query")
				return
			}
		}
	}
	opts := pgx.TxOptions{}
	if !write {
		opts.IsoLevel = pgx.RepeatableRead
		opts.AccessMode = pgx.ReadOnly
	}
	tx, e := s.DB.BeginTx(r.Context(), opts)
	if e != nil {
		messageFail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var out any
	if !admin {
		if e = svc.Owner(r.Context(), tx, customer, p.ID); e != nil {
			messageFail(w, e)
			return
		}
		if !write && rest == "" {
			out, e = svc.List(r.Context(), tx, customer, p.ID, q)
		} else if !write && rest == "summary" {
			out, e = svc.Summary(r.Context(), tx, customer, p.ID)
		} else if write && rest == "read-all" {
			out, e = svc.Read(r.Context(), tx, customer, p.ID, "", in.Snapshot)
		} else {
			id := rest
			if write {
				id = strings.TrimSuffix(rest, "/read")
				if id == rest {
					fail(w, 404, "not_found")
					return
				}
			}
			if _, err := uuid.Parse(id); err != nil {
				fail(w, 404, "not_found")
				return
			}
			if write {
				out, e = svc.Read(r.Context(), tx, customer, p.ID, id, "")
			} else {
				out, e = svc.Detail(r.Context(), tx, customer, p.ID, id)
			}
		}
	} else {
		if !write && strings.HasPrefix(rest, "requests/") {
			key := strings.TrimPrefix(rest, "requests/")
			if _, err := uuid.Parse(key); err != nil {
				fail(w, 404, "not_found")
				return
			}
			var id string
			e = tx.QueryRow(r.Context(), `SELECT id::text FROM message_campaigns WHERE namespace=$1 AND actor_id=$2 AND create_key=$3`, svc.Namespace, p.ID, key).Scan(&id)
			if errors.Is(e, pgx.ErrNoRows) {
				e = messages.Missing()
			}
			if e == nil {
				out, e = svc.Campaign(r.Context(), tx, p.ID, id, "compose", false)
			}
		} else if !write && rest == "scopes" {
			out, e = svc.Scopes(r.Context(), tx, p.ID)
		} else if !write && rest == "" {
			out, e = svc.Campaigns(r.Context(), tx, p.ID, page)
		} else if write && rest == "" {
			out, e = svc.Create(r.Context(), tx, p.ID, r.Header.Get("Idempotency-Key"), in.Draft)
		} else {
			parts := strings.Split(rest, "/")
			id := parts[0]
			if _, err := uuid.Parse(id); err != nil || len(parts) > 2 {
				fail(w, 404, "not_found")
				return
			}
			action := ""
			if len(parts) == 2 {
				action = parts[1]
			}
			switch {
			case !write && action == "":
				out, e = svc.Campaign(r.Context(), tx, p.ID, id, "read", false)
			case !write && action == "recipients":
				out, e = svc.Receipts(r.Context(), tx, p.ID, id, page)
			case write && action == "draft":
				out, e = svc.Update(r.Context(), tx, p.ID, id, in.Draft)
			case write && action == "publish":
				out, e = svc.Publish(r.Context(), tx, p.ID, id, r.Header.Get("Idempotency-Key"), in.Revision)
			case write && action == "retry-failed":
				out, e = svc.Retry(r.Context(), tx, p.ID, id)
			default:
				fail(w, 404, "not_found")
				return
			}
		}
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		messageFail(w, e)
		return
	}
	respond(w, 200, map[string]any{"data": out})
}

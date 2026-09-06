package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type upgrade struct {
	ID                 string    `json:"id"`
	PersonalCustomerID string    `json:"personalCustomerId"`
	LegalName          string    `json:"legalName"`
	Status             string    `json:"status"`
	BusinessCustomerID *string   `json:"businessCustomerId"`
	CreatedAt          time.Time `json:"createdAt"`
}

const upgradeColumns = `id::text,personal_customer_id::text,legal_name,status,business_customer_id::text,created_at`

func readUpgrade(row pgx.Row) (upgrade, error) {
	var u upgrade
	err := row.Scan(&u.ID, &u.PersonalCustomerID, &u.LegalName, &u.Status, &u.BusinessCustomerID, &u.CreatedAt)
	return u, err
}
func (s *Server) getUpgrade(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	id := r.PathValue("customerID")
	if _, err := uuid.Parse(id); err != nil {
		fail(w, 400, "invalid_customer_id")
		return
	}
	u, err := readUpgrade(s.DB.QueryRow(r.Context(), `SELECT `+upgradeColumns+` FROM business_upgrade_requests WHERE personal_customer_id=$1 AND requested_by=$2 ORDER BY created_at DESC,id DESC LIMIT 1`, id, p.ID))
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	respond(w, 200, map[string]any{"data": u})
}
func (s *Server) submitUpgrade(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	id := r.PathValue("customerID")
	if _, err := uuid.Parse(id); err != nil {
		fail(w, 400, "invalid_customer_id")
		return
	}
	key, err := uuid.Parse(r.Header.Get("Idempotency-Key"))
	if err != nil {
		fail(w, 400, "idempotency_key_required")
		return
	}
	if r.Header.Get("Content-Type") != "application/json" {
		fail(w, 415, "json_required")
		return
	}
	var input struct {
		LegalName string `json:"legalName"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&input); err != nil {
		fail(w, 400, "invalid_body")
		return
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		fail(w, 400, "invalid_body")
		return
	}
	input.LegalName = strings.TrimSpace(input.LegalName)
	if len([]rune(input.LegalName)) < 1 || len([]rune(input.LegalName)) > 200 {
		fail(w, 400, "invalid_legal_name")
		return
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	// Lock the owned personal subject so concurrent submissions serialize.
	var owned string
	err = tx.QueryRow(r.Context(), `SELECT id::text FROM customers WHERE id=$1 AND kind='personal' AND personal_owner_id=$2 FOR UPDATE`, id, p.ID).Scan(&owned)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	existing, err := readUpgrade(tx.QueryRow(r.Context(), `SELECT `+upgradeColumns+` FROM business_upgrade_requests WHERE requested_by=$1 AND idempotency_key=$2`, p.ID, key.String()))
	if err == nil {
		if existing.PersonalCustomerID != owned || existing.LegalName != input.LegalName {
			fail(w, 409, "idempotency_conflict")
			return
		}
		respond(w, 200, map[string]any{"data": existing})
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	u, err := readUpgrade(tx.QueryRow(r.Context(), `INSERT INTO business_upgrade_requests(id,personal_customer_id,requested_by,legal_name,idempotency_key) VALUES($1,$2,$3,$4,$5) RETURNING `+upgradeColumns, uuid.NewString(), owned, p.ID, input.LegalName, key.String()))
	var pgerr *pgconn.PgError
	if errors.As(err, &pgerr) && pgerr.Code == "23505" {
		fail(w, 409, "upgrade_already_exists")
		return
	}
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,'business_upgrade:submit')`, p.ID, owned); err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	respond(w, 201, map[string]any{"data": u})
}

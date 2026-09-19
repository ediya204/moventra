// Package manualfunds records human-reviewed funding. It never sends a payment
// to a bank or card provider. Ledger processing is separately activated.
package manualfunds

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/ledger"
)

type Fault struct {
	Code   string
	Status int
}

func (f *Fault) Error() string            { return f.Code }
func fault(code string, status int) error { return &Fault{code, status} }

type Service struct {
	ReadOnly bool
	DB       *pgxpool.Pool
	Ledger   *ledger.Service
}

func (s *Service) NS() string {
	if s.Ledger == nil {
		return "disabled"
	}
	return s.Ledger.Namespace
}
func (s *Service) Enabled() bool {
	return !s.ReadOnly && s.Ledger != nil && (!s.Ledger.IsLive() || os.Getenv("MANUAL_FUNDS_ENABLED") == "true")
}
func (s *Service) ReviewRequired() bool { return os.Getenv("MANUAL_FUNDS_REQUIRE_REVIEW") != "false" }

func (s *Service) Mode() string {
	if s.Ledger == nil {
		return "disabled"
	}
	if s.Ledger.IsLive() {
		return "live"
	}
	return "shadow"
}
func (s *Service) Lock(ctx context.Context, tx pgx.Tx, c string) error {
	_, e := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "manual:"+s.NS()+":"+c)
	return e
}
func (s *Service) Audit(ctx context.Context, tx pgx.Tx, c, id, actor, action string, data any) error {
	raw, e := json.Marshal(data)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO manual_funds_audit(namespace,customer_id,order_id,actor_id,action,data) VALUES($1,NULLIF($2,'')::uuid,NULLIF($3,'')::uuid,NULLIF($4,'')::uuid,$5,$6)`, s.NS(), c, id, actor, action, raw)
	return e
}
func Allowed(ctx context.Context, tx pgx.Tx, actor, customer, permission string) (bool, error) {
	var ok bool
	e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM effective_manual_funds_grants WHERE user_id=$1 AND (scope='*' OR scope=$2) AND permission=$3)`, actor, customer, permission).Scan(&ok)
	return ok, e
}
func (s *Service) Authorize(ctx context.Context, tx pgx.Tx, actor, customer, permission string, active bool) error {
	ok, e := Allowed(ctx, tx, actor, customer, permission)
	if e != nil {
		return e
	}
	if !ok {
		return fault("not_found", 404)
	}
	var enabled bool
	e = tx.QueryRow(ctx, `SELECT c.onboarding_status='approved' AND c.service_status='active' AND u.status='active' FROM customers c JOIN users u ON u.id=c.personal_owner_id WHERE c.id=$1 AND c.kind='personal' AND u.id<>$2 FOR SHARE OF c,u`, customer, actor).Scan(&enabled)
	if errors.Is(e, pgx.ErrNoRows) {
		return fault("not_found", 404)
	}
	if e != nil {
		return e
	}
	if active && !enabled {
		return fault("user_not_enabled", 403)
	}
	return nil
}

type Input struct {
	Action     string `json:"action,omitempty"`
	CustomerID string `json:"customerId,omitempty"`
	Source     string `json:"source,omitempty"`
	Currency   string `json:"currency,omitempty"`
	Amount     string `json:"amountMinor,omitempty"`
	Note       string `json:"note"`
	Evidence   string `json:"evidenceRef,omitempty"`
	OriginalID string `json:"originalId,omitempty"`
	Revision   int64  `json:"revision,omitempty"`
}
type Order struct {
	ID              string    `json:"id"`
	CustomerID      string    `json:"customerId"`
	ActorID         string    `json:"actorId"`
	ReviewerID      string    `json:"reviewerId"`
	Direction       string    `json:"direction"`
	Source          string    `json:"source"`
	Currency        string    `json:"currency"`
	Amount          string    `json:"amountMinor"`
	Note            string    `json:"note"`
	Evidence        string    `json:"evidenceRef"`
	OriginalID      string    `json:"originalId"`
	State           string    `json:"state"`
	Resolution      string    `json:"resolution"`
	Error           string    `json:"error"`
	Revision        int64     `json:"revision"`
	Before          *string   `json:"walletBeforeMinor"`
	After           *string   `json:"walletAfterMinor"`
	PaymentEvidence string    `json:"paymentEvidence"`
	Created         time.Time `json:"createdAt"`
	Updated         time.Time `json:"updatedAt"`
}

const columns = `id::text,customer_id::text,actor_id::text,COALESCE(reviewer_id::text,''),direction,source,currency,amount_minor::text,note,evidence_ref,COALESCE(original_id::text,''),state,resolution,error,revision,wallet_before_minor::text,wallet_after_minor::text,payment_evidence,created_at,updated_at`

func scan(row pgx.Row) (Order, error) {
	var o Order
	e := row.Scan(&o.ID, &o.CustomerID, &o.ActorID, &o.ReviewerID, &o.Direction, &o.Source, &o.Currency, &o.Amount, &o.Note, &o.Evidence, &o.OriginalID, &o.State, &o.Resolution, &o.Error, &o.Revision, &o.Before, &o.After, &o.PaymentEvidence, &o.Created, &o.Updated)
	if errors.Is(e, pgx.ErrNoRows) {
		e = fault("not_found", 404)
	}
	return o, e
}
func (s *Service) Get(ctx context.Context, tx pgx.Tx, c, id string) (Order, error) {
	return scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM manual_funds_orders WHERE namespace=$1 AND customer_id=$2 AND id=$3`, s.NS(), c, id))
}
func validText(v string, max int) bool {
	return strings.TrimSpace(v) == v && len(v) > 0 && len(v) <= max && !strings.ContainsAny(v, "\x00\r")
}

var amountPattern = regexp.MustCompile(`^[1-9][0-9]{0,37}$`)

func (s *Service) Execute(ctx context.Context, tx pgx.Tx, actor, c, id, key string, in Input) (Order, error) {
	var empty Order
	if !s.Enabled() {
		return empty, fault("manual_funds_disabled", 503)
	}
	if _, e := uuid.Parse(key); e != nil {
		return empty, fault("invalid_idempotency_key", 400)
	}
	if !validText(in.Note, 500) {
		return empty, fault("note_required", 400)
	}
	if e := s.Lock(ctx, tx, c); e != nil {
		return empty, e
	}
	// Serialize this actor/key even if a concurrent request targets another customer.
	if _, e := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "manual-command:"+s.NS()+":"+actor+":"+key); e != nil {
		return empty, e
	}
	raw, _ := json.Marshal([]any{c, id, in})
	hash := fmt.Sprintf("%x", sha256.Sum256(raw))
	var priorHash, priorID string
	e := tx.QueryRow(ctx, `SELECT request_hash,order_id::text FROM manual_funds_commands WHERE namespace=$1 AND actor_id=$2 AND request_id=$3`, s.NS(), actor, key).Scan(&priorHash, &priorID)
	if e == nil {
		if priorHash != hash {
			return empty, fault("idempotency_conflict", 409)
		}
		return s.Get(ctx, tx, c, priorID)
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return empty, e
	}
	var o Order
	if id == "" {
		if in.Action != "create" || in.CustomerID != c || in.Currency != "USD" || !amountPattern.MatchString(in.Amount) || !validText(in.Evidence, 180) || in.Revision != 0 {
			return empty, fault("invalid_manual_order", 400)
		}
		direction, state := "credit", "pending_review"
		if !s.ReviewRequired() {
			state = "processing"
		}
		switch in.Source {
		case "platform_advance", "offline_receipt":
			if in.OriginalID != "" {
				return empty, fault("invalid_original", 400)
			}
		case "advance_recovery":
			direction, state = "debit", "reserving"
		case "offline_payout":
			direction, state = "debit", "reserving"
			if in.OriginalID != "" {
				return empty, fault("invalid_original", 400)
			}
		case "reversal":
		default:
			return empty, fault("invalid_source", 400)
		}
		if in.Source == "advance_recovery" || in.Source == "reversal" {
			if _, e = uuid.Parse(in.OriginalID); e != nil {
				return empty, fault("invalid_original", 400)
			}
			original, err := s.Get(ctx, tx, c, in.OriginalID)
			if err != nil {
				return empty, err
			}
			if original.State != "completed" || original.Currency != in.Currency || original.Source == "reversal" {
				return empty, fault("original_not_recoverable", 409)
			}
			if in.Source == "reversal" {
				if original.Source == "offline_payout" || original.Source == "offline_receipt" {
					return empty, fault("external_payment_requires_separate_evidence", 409)
				}
				if in.Amount != original.Amount {
					return empty, fault("full_reversal_required", 400)
				}
				if original.Direction == "credit" {
					direction, state = "debit", "reserving"
				}
			}
			if in.Source == "advance_recovery" && original.Source != "platform_advance" {
				return empty, fault("invalid_original", 400)
			}
			var used string
			if e = tx.QueryRow(ctx, `SELECT COALESCE(sum(amount_minor),0)::text FROM manual_funds_orders WHERE namespace=$1 AND original_id=$2 AND state NOT IN ('failed','rejected','cancelled')`, s.NS(), in.OriginalID).Scan(&used); e != nil {
				return empty, e
			}
			a, _ := new(big.Int).SetString(used, 10)
			b, _ := new(big.Int).SetString(in.Amount, 10)
			cap, _ := new(big.Int).SetString(original.Amount, 10)
			if a.Add(a, b).Cmp(cap) > 0 {
				return empty, fault("recovery_exceeds_original", 409)
			}
		}
		var exists bool
		if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM manual_funds_orders WHERE namespace=$1 AND evidence_ref=$2)`, s.NS(), in.Evidence).Scan(&exists); e != nil {
			return empty, e
		}
		if exists {
			return empty, fault("evidence_already_recorded", 409)
		}
		// Namespace-wide evidence lock makes concurrent cross-customer copies deterministic.
		if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "manual-evidence:"+s.NS()+":"+in.Evidence); e != nil {
			return empty, e
		}
		id = uuid.NewString()
		tag, err := tx.Exec(ctx, `INSERT INTO manual_funds_orders(id,namespace,customer_id,actor_id,direction,source,currency,amount_minor,note,evidence_ref,original_id,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULLIF($11,'')::uuid,$12) ON CONFLICT(namespace,evidence_ref) DO NOTHING`, id, s.NS(), c, actor, direction, in.Source, in.Currency, in.Amount, in.Note, in.Evidence, in.OriginalID, state)
		if err != nil {
			return empty, err
		}
		if tag.RowsAffected() != 1 {
			return empty, fault("evidence_already_recorded", 409)
		}
		o, e = s.Get(ctx, tx, c, id)
	} else {
		if in.Source != "" || in.Currency != "" || in.Amount != "" || in.CustomerID != "" || in.OriginalID != "" {
			return empty, fault("unexpected_fields", 400)
		}
		o, e = s.Get(ctx, tx, c, id)
		if e != nil {
			return empty, e
		}
		if o.Revision != in.Revision {
			return empty, fault("order_changed", 409)
		}
		next, resolution, reviewer, payment := o.State, o.Resolution, o.ReviewerID, o.PaymentEvidence
		switch in.Action {
		case "approve", "reject":
			if o.State != "pending_review" {
				return empty, fault("order_changed", 409)
			}
			reviewer = actor
			if in.Action == "approve" {
				next = "processing"
				if o.Source == "offline_payout" {
					next = "awaiting_payment"
				}
			} else {
				next = "rejected"
				if o.Direction == "debit" {
					next = "releasing"
					resolution = "rejected"
				}
			}
		case "cancel":
			if actor != o.ActorID {
				return empty, fault("not_found", 404)
			}
			if o.State != "pending_review" {
				return empty, fault("order_changed", 409)
			}
			next = "cancelled"
			if o.Direction == "debit" {
				next = "releasing"
				resolution = "cancelled"
			}
		case "confirm_payment":
			if o.State != "awaiting_payment" || o.Source != "offline_payout" || !validText(in.Evidence, 180) {
				return empty, fault("payment_evidence_required", 409)
			}
			next = "processing"
			payment = in.Evidence
		case "payment_failed":
			if o.State != "awaiting_payment" || o.Source != "offline_payout" || !validText(in.Evidence, 180) {
				return empty, fault("payment_evidence_required", 409)
			}
			next = "releasing"
			resolution = "failed"
			payment = in.Evidence
		case "reconcile":
			if o.State == "pending_review" && !s.ReviewRequired() {
				next = "processing"
				if o.Source == "offline_payout" {
					next = "awaiting_payment"
				}
				break
			}
			if o.State != "reserving" && o.State != "processing" && o.State != "releasing" {
				return empty, fault("order_changed", 409)
			}
		default:
			return empty, fault("invalid_action", 400)
		}
		if in.Evidence != "" && in.Action != "confirm_payment" && in.Action != "payment_failed" {
			return empty, fault("unexpected_evidence", 400)
		}
		_, e = tx.Exec(ctx, `UPDATE manual_funds_orders SET state=$1,resolution=$2,reviewer_id=NULLIF($3,'')::uuid,payment_evidence=$4,revision=revision+1,updated_at=now() WHERE id=$5`, next, resolution, reviewer, payment, id)
		if e == nil {
			o, e = s.Get(ctx, tx, c, id)
		}
	}
	if e != nil {
		return empty, e
	}
	if e = s.Audit(ctx, tx, c, id, actor, in.Action, map[string]any{"note": in.Note, "evidenceRef": in.Evidence, "revision": o.Revision, "approvalRequired": s.ReviewRequired()}); e != nil {
		return empty, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO manual_funds_commands(namespace,actor_id,request_id,request_hash,order_id) VALUES($1,$2,$3,$4,$5)`, s.NS(), actor, key, hash, id)
	return o, e
}
func (s *Service) List(ctx context.Context, tx pgx.Tx, c string, page int) ([]Order, int, error) {
	var total int
	e := tx.QueryRow(ctx, `SELECT count(*) FROM manual_funds_orders WHERE namespace=$1 AND customer_id=$2`, s.NS(), c).Scan(&total)
	if e != nil {
		return nil, 0, e
	}
	rows, e := tx.Query(ctx, `SELECT `+columns+` FROM manual_funds_orders WHERE namespace=$1 AND customer_id=$2 ORDER BY created_at DESC,id LIMIT 20 OFFSET $3`, s.NS(), c, page*20)
	if e != nil {
		return nil, 0, e
	}
	defer rows.Close()
	out := []Order{}
	for rows.Next() {
		o, e := scan(rows)
		if e != nil {
			return nil, 0, e
		}
		out = append(out, o)
	}
	return out, total, rows.Err()
}

// Package ledger coordinates durable Moventra shadow accounting. Only this
// service writes its Blnk balances; provider facts and spending limits stay separate.
package ledger

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/blnk"
)

var ErrInvalid = errors.New("invalid_ledger_command")
var ErrConflict = errors.New("ledger_conflict")
var ErrNotFound = errors.New("ledger_not_found")
var namespacePattern = regexp.MustCompile(`^shadow_[a-z0-9_]{1,48}$`)
var amountPattern = regexp.MustCompile(`^[1-9][0-9]{0,37}$`)

type Service struct {
	DB                  *pgxpool.Pool
	Blnk                *blnk.Client
	Namespace, LedgerID string
}
type AccountSpec struct {
	CustomerID     string `json:"customerId"`
	Key            string `json:"key"`
	Kind           string `json:"kind"`
	Currency       string `json:"currency"`
	ConnectionID   string `json:"connectionId"`
	ExternalCardID string `json:"externalCardId"`
}
type Account struct {
	ID             string `json:"id"`
	CustomerID     string `json:"customerId"`
	Key            string `json:"key"`
	Kind           string `json:"kind"`
	Currency       string `json:"currency"`
	Scale          int    `json:"scale"`
	ConnectionID   string `json:"-"`
	ExternalCardID string `json:"-"`
	BalanceID      string `json:"-"`
}
type Command struct {
	CustomerID    string `json:"customerId"`
	EffectKey     string `json:"effectKey"`
	Kind          string `json:"kind"`
	SourceID      string `json:"sourceId"`
	DestinationID string `json:"destinationId"`
	TransitID     string `json:"transitId,omitempty"`
	AmountMinor   string `json:"amountMinor"`
	EvidenceRef   string `json:"evidenceRef"`
}
type Operation struct {
	ID string `json:"id"`
	Command
	Currency    string `json:"currency"`
	Scale       int    `json:"scale"`
	State       string `json:"state"`
	DecisionRef string `json:"decisionRef,omitempty"`
	LastError   string `json:"lastError,omitempty"`
}

func New(db *pgxpool.Pool, c *blnk.Client, namespace, ledgerID string) (*Service, error) {
	if db == nil || c == nil || !namespacePattern.MatchString(namespace) || ledgerID != "general_ledger_id" {
		return nil, ErrInvalid
	}
	return &Service{db, c, namespace, ledgerID}, nil
}
func scale(currency string) (int, int64, error) {
	switch currency {
	case "USD":
		return 2, 100, nil
	case "USDT":
		return 6, 1000000, nil
	}
	return 0, 0, ErrInvalid
}
func validID(s string) bool {
	_, err := uuid.Parse(s)
	return err == nil && s != "00000000-0000-0000-0000-000000000000"
}
func validText(s string, max int) bool {
	return len(s) > 0 && len(s) <= max && strings.TrimSpace(s) == s && !strings.ContainsAny(s, "\r\n\x00")
}
func hash(parts ...string) string {
	b, _ := json.Marshal(parts)
	v := sha256.Sum256(b)
	return hex.EncodeToString(v[:])
}
func (s *Service) lock(ctx context.Context, tx pgx.Tx, customer string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, s.Namespace+":"+customer)
	return err
}

const accountColumns = `id::text,customer_id::text,account_key,kind,currency,scale,connection_id,external_card_id,COALESCE(blnk_balance_id,'')`

func scanAccount(row pgx.Row) (Account, error) {
	var a Account
	err := row.Scan(&a.ID, &a.CustomerID, &a.Key, &a.Kind, &a.Currency, &a.Scale, &a.ConnectionID, &a.ExternalCardID, &a.BalanceID)
	return a, err
}
func (s *Service) account(ctx context.Context, tx pgx.Tx, customer, id string) (Account, error) {
	a, err := scanAccount(tx.QueryRow(ctx, `SELECT `+accountColumns+` FROM ledger_accounts WHERE namespace=$1 AND customer_id=$2 AND id=$3`, s.Namespace, customer, id))
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return a, err
}

// Provision is a trusted server/CLI operation, never a browser-supplied binding.
// Deterministic Blnk indicators recover creation across a local commit failure.
func (s *Service) Provision(ctx context.Context, r AccountSpec) (Account, error) {
	var a Account
	sc, precision, err := scale(r.Currency)
	if err != nil || !validID(r.CustomerID) || !validText(r.Key, 180) {
		return a, ErrInvalid
	}
	switch r.Kind {
	case "wallet", "clearing":
		if r.ConnectionID != "" || r.ExternalCardID != "" {
			return a, ErrInvalid
		}
	case "card", "transit":
		if r.Currency != "USD" || !validText(r.ConnectionID, 180) || !validText(r.ExternalCardID, 180) {
			return a, ErrInvalid
		}
	default:
		return a, ErrInvalid
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return a, err
	}
	defer tx.Rollback(ctx)
	if err = s.lock(ctx, tx, r.CustomerID); err != nil {
		return a, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO ledger_accounts(id,namespace,customer_id,account_key,kind,currency,scale,connection_id,external_card_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(namespace,customer_id,account_key) DO NOTHING`, uuid.NewString(), s.Namespace, r.CustomerID, r.Key, r.Kind, r.Currency, sc, r.ConnectionID, r.ExternalCardID)
	if err != nil {
		return a, err
	}
	a, err = scanAccount(tx.QueryRow(ctx, `SELECT `+accountColumns+` FROM ledger_accounts WHERE namespace=$1 AND customer_id=$2 AND account_key=$3`, s.Namespace, r.CustomerID, r.Key))
	if err != nil {
		return a, err
	}
	if a.Kind != r.Kind || a.Currency != r.Currency || a.ConnectionID != r.ConnectionID || a.ExternalCardID != r.ExternalCardID {
		return a, ErrConflict
	}
	b, err := s.Blnk.EnsureBalance(ctx, s.LedgerID, "mv_"+hash(s.Namespace, r.CustomerID, r.Key), r.Currency, precision)
	if err != nil {
		return a, err
	}
	if a.BalanceID != "" && a.BalanceID != b.ID {
		return a, ErrConflict
	}
	a.BalanceID = b.ID
	_, err = tx.Exec(ctx, `UPDATE ledger_accounts SET blnk_balance_id=$1 WHERE id=$2`, b.ID, a.ID)
	if err != nil {
		return a, err
	}
	return a, tx.Commit(ctx)
}

const operationColumns = `id::text,customer_id::text,effect_key,kind,source_id::text,destination_id::text,COALESCE(transit_id::text,''),amount_minor::text,evidence_ref,currency,scale,state,decision_ref,last_error`

func scanOperation(row pgx.Row) (Operation, error) {
	var o Operation
	err := row.Scan(&o.ID, &o.CustomerID, &o.EffectKey, &o.Kind, &o.SourceID, &o.DestinationID, &o.TransitID, &o.AmountMinor, &o.EvidenceRef, &o.Currency, &o.Scale, &o.State, &o.DecisionRef, &o.LastError)
	return o, err
}
func (s *Service) Submit(ctx context.Context, c Command) (Operation, error) {
	var o Operation
	if !validID(c.CustomerID) || !validID(c.SourceID) || !validID(c.DestinationID) || c.SourceID == c.DestinationID || !validText(c.EffectKey, 300) || !validText(c.EvidenceRef, 300) || !amountPattern.MatchString(c.AmountMinor) {
		return o, ErrInvalid
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return o, err
	}
	defer tx.Rollback(ctx)
	if err = s.lock(ctx, tx, c.CustomerID); err != nil {
		return o, err
	}
	a, err := s.account(ctx, tx, c.CustomerID, c.SourceID)
	if err != nil {
		return o, err
	}
	b, err := s.account(ctx, tx, c.CustomerID, c.DestinationID)
	if err != nil {
		return o, err
	}
	if a.Currency != b.Currency || a.Scale != b.Scale || a.BalanceID == "" || b.BalanceID == "" {
		return o, ErrInvalid
	}
	switch c.Kind {
	case "wallet_credit":
		if a.Kind != "clearing" || b.Kind != "wallet" || c.TransitID != "" {
			return o, ErrInvalid
		}
	case "card_settlement":
		if a.Kind != "card" || b.Kind != "clearing" || c.TransitID != "" {
			return o, ErrInvalid
		}
	case "card_refund":
		if a.Kind != "clearing" || b.Kind != "card" || c.TransitID != "" {
			return o, ErrInvalid
		}
	case "wallet_to_card":
		if a.Kind != "wallet" || b.Kind != "card" || !validID(c.TransitID) {
			return o, ErrInvalid
		}
		hold, e := s.account(ctx, tx, c.CustomerID, c.TransitID)
		if e != nil {
			return o, e
		}
		if hold.Kind != "transit" || hold.Currency != a.Currency || hold.BalanceID == "" || hold.ConnectionID != b.ConnectionID || hold.ExternalCardID != b.ExternalCardID {
			return o, ErrInvalid
		}
	default:
		return o, ErrInvalid
	}
	_, err = tx.Exec(ctx, `INSERT INTO ledger_operations(id,namespace,customer_id,effect_key,kind,source_id,destination_id,transit_id,amount_minor,currency,scale,evidence_ref) VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,'')::uuid,$9::numeric,$10,$11,$12) ON CONFLICT(namespace,effect_key) DO NOTHING`, uuid.NewString(), s.Namespace, c.CustomerID, c.EffectKey, c.Kind, c.SourceID, c.DestinationID, c.TransitID, c.AmountMinor, a.Currency, a.Scale, c.EvidenceRef)
	if err != nil {
		return o, err
	}
	o, err = scanOperation(tx.QueryRow(ctx, `SELECT `+operationColumns+` FROM ledger_operations WHERE namespace=$1 AND effect_key=$2`, s.Namespace, c.EffectKey))
	if err != nil {
		return o, err
	}
	if o.CustomerID != c.CustomerID || o.Kind != c.Kind || o.SourceID != c.SourceID || o.DestinationID != c.DestinationID || o.TransitID != c.TransitID || o.AmountMinor != c.AmountMinor {
		return Operation{}, ErrConflict
	}
	_, err = tx.Exec(ctx, `INSERT INTO ledger_evidence(operation_id,evidence_ref) VALUES($1,$2) ON CONFLICT DO NOTHING`, o.ID, c.EvidenceRef)
	if err != nil {
		return o, err
	}
	return o, tx.Commit(ctx)
}

// Resolve accepts a verified provider outcome. Unknown preserves the reservation.
// This is a trusted internal boundary: no unsigned public callback exposes it.
func (s *Service) Resolve(ctx context.Context, customer, id, outcome, evidence string) (Operation, error) {
	var o Operation
	if !validID(customer) || !validID(id) || !validText(evidence, 300) {
		return o, ErrInvalid
	}
	next := map[string]string{"confirmed": "commit_pending", "rejected": "release_pending", "unknown": "provider_unknown"}[outcome]
	if next == "" {
		return o, ErrInvalid
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return o, err
	}
	defer tx.Rollback(ctx)
	if err = s.lock(ctx, tx, customer); err != nil {
		return o, err
	}
	o, err = scanOperation(tx.QueryRow(ctx, `SELECT `+operationColumns+` FROM ledger_operations WHERE namespace=$1 AND customer_id=$2 AND id=$3 FOR UPDATE`, s.Namespace, customer, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return o, ErrNotFound
	}
	if err != nil {
		return o, err
	}
	if o.Kind != "wallet_to_card" {
		return o, ErrInvalid
	}
	if o.State != next && !(outcome == "confirmed" && o.State == "applied") && !(outcome == "rejected" && o.State == "released") {
		if o.State != "awaiting_provider" && o.State != "provider_unknown" {
			return o, ErrConflict
		}
		o.State = next
		o.DecisionRef = evidence
		_, err = tx.Exec(ctx, `UPDATE ledger_operations SET state=$1,decision_ref=$2,updated_at=now(),next_attempt_at=now() WHERE id=$3`, next, evidence, id)
		if err != nil {
			return o, err
		}
		_, err = tx.Exec(ctx, `INSERT INTO ledger_audit(operation_id,state,evidence_ref) VALUES($1,$2,$3)`, id, next, evidence)
		if err != nil {
			return o, err
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO ledger_evidence(operation_id,evidence_ref) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, evidence)
	if err != nil {
		return o, err
	}
	return o, tx.Commit(ctx)
}

// Process serializes local writes for a customer while the bounded HTTP request
// runs. A DB rollback after Blnk applies is recovered by the same reference.
func (s *Service) Process(ctx context.Context, customer, id string) (Operation, error) {
	var o Operation
	if !validID(customer) || !validID(id) {
		return o, ErrInvalid
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return o, err
	}
	defer tx.Rollback(ctx)
	if err = s.lock(ctx, tx, customer); err != nil {
		return o, err
	}
	o, err = scanOperation(tx.QueryRow(ctx, `SELECT `+operationColumns+` FROM ledger_operations WHERE namespace=$1 AND customer_id=$2 AND id=$3 FOR UPDATE`, s.Namespace, customer, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return o, ErrNotFound
	}
	if err != nil {
		return o, err
	}
	phase, src, dst, next := "post", o.SourceID, o.DestinationID, "applied"
	switch o.State {
	case "pending":
		if o.Kind == "wallet_to_card" {
			phase, dst, next = "reserve", o.TransitID, "awaiting_provider"
		}
	case "commit_pending":
		phase, src, next = "commit", o.TransitID, "applied"
	case "release_pending":
		phase, src, dst, next = "release", o.TransitID, o.SourceID, "released"
	default:
		return o, nil
	}
	a, err := s.account(ctx, tx, customer, src)
	if err != nil {
		return o, err
	}
	b, err := s.account(ctx, tx, customer, dst)
	if err != nil {
		return o, err
	}
	_, precision, _ := scale(o.Currency)
	amount, _ := new(big.Int).SetString(o.AmountMinor, 10)
	ref := "mv_" + hash(s.Namespace, o.EffectKey, phase)
	// Confirmed external settlement is a fact, even when it exposes a deficit.
	// Customer-initiated wallet transfers can never overdraw.
	result, postErr := s.Blnk.Apply(ctx, blnk.Transfer{Reference: ref, Source: a.BalanceID, Destination: b.BalanceID, Currency: o.Currency, Amount: amount, Precision: precision, AllowOverdraft: a.Kind == "clearing" || o.Kind == "card_settlement"})
	lastError := ""
	if postErr != nil {
		next = o.State
		lastError = "blnk_outcome_unknown"
		if errors.Is(postErr, blnk.ErrConflict) {
			next = "review_required"
			lastError = "blnk_payload_conflict"
		}
		if errors.Is(postErr, blnk.ErrRejected) {
			next = "review_required"
			lastError = "blnk_rejected"
			if phase == "reserve" {
				next = "rejected"
			}
		}
	} else {
		_, err = tx.Exec(ctx, `INSERT INTO ledger_journal(operation_id,phase,blnk_reference,blnk_transaction_id,source_id,destination_id,amount_minor) VALUES($1,$2,$3,$4,$5,$6,$7::numeric) ON CONFLICT(operation_id,phase) DO NOTHING`, o.ID, phase, ref, result.ID, src, dst, o.AmountMinor)
		if err != nil {
			return o, err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE ledger_operations SET state=$1,last_error=$2,attempts=attempts+1,next_attempt_at=now()+interval '30 seconds',updated_at=now() WHERE id=$3`, next, lastError, o.ID)
	if err != nil {
		return o, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO ledger_audit(operation_id,state,evidence_ref) VALUES($1,$2,$3)`, o.ID, next, o.EvidenceRef)
	if err != nil {
		return o, err
	}
	if err = tx.Commit(ctx); err != nil {
		return o, err
	}
	o.State, o.LastError = next, lastError
	return o, postErr
}
func (s *Service) Drain(ctx context.Context, limit int) (int, error) {
	if limit < 1 || limit > 100 {
		return 0, ErrInvalid
	}
	rows, err := s.DB.Query(ctx, `SELECT customer_id::text,id::text FROM ledger_operations WHERE namespace=$1 AND state IN ('pending','commit_pending','release_pending') AND next_attempt_at<=now() ORDER BY created_at,id LIMIT $2`, s.Namespace, limit)
	if err != nil {
		return 0, err
	}
	var work [][2]string
	for rows.Next() {
		var r [2]string
		if err = rows.Scan(&r[0], &r[1]); err != nil {
			rows.Close()
			return 0, err
		}
		work = append(work, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	var first error
	for _, r := range work {
		_, e := s.Process(ctx, r[0], r[1])
		if first == nil {
			first = e
		}
	}
	return len(work), first
}

type BalanceView struct {
	Account
	PostedMinor    string `json:"postedMinor"`
	HeldMinor      string `json:"heldMinor"`
	AvailableMinor string `json:"ledgerAvailableMinor"`
}
type Snapshot struct {
	ReconciliationScope    string            `json:"reconciliationScope"`
	ExternalReconciliation string            `json:"externalReconciliation"`
	AuthorizationCoverage  string            `json:"authorizationCoverage"`
	ExecutionEligible      bool              `json:"executionEligible"`
	Mode                   string            `json:"mode"`
	ObservedAt             time.Time         `json:"observedAt"`
	Accounts               []BalanceView     `json:"accounts"`
	Totals                 map[string]string `json:"totalsMinor"`
	Reconciliation         string            `json:"reconciliation"`
	PendingOperations      int               `json:"pendingOperations"`
}

// Snapshot compares every mapped Blnk balance with the local applied journal.
// A pending write may explain a mismatch, but never turns it into "matched".
func (s *Service) Snapshot(ctx context.Context, customer string) (Snapshot, error) {
	var out Snapshot
	if !validID(customer) {
		return out, ErrInvalid
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	return s.snapshotAndCommit(ctx, tx, customer)
}

func (s *Service) snapshotAndCommit(ctx context.Context, tx pgx.Tx, customer string) (Snapshot, error) {
	out, err := s.SnapshotTx(ctx, tx, customer)
	if err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}

// SnapshotTx shares the caller transaction so API authorization and audit do not
// consume a second pool connection. The caller commits after recording the audit.
func (s *Service) SnapshotTx(ctx context.Context, tx pgx.Tx, customer string) (Snapshot, error) {
	out := Snapshot{Mode: "shadow", ReconciliationScope: "local_journal_vs_blnk", ExternalReconciliation: "not_checked", AuthorizationCoverage: "not_integrated", Accounts: []BalanceView{}, Totals: map[string]string{}, Reconciliation: "matched"}
	var err error
	if err = s.lock(ctx, tx, customer); err != nil {
		return out, err
	}
	rows, err := tx.Query(ctx, `SELECT `+accountColumns+` FROM ledger_accounts WHERE namespace=$1 AND customer_id=$2 ORDER BY kind,account_key LIMIT 1001`, s.Namespace, customer)
	if err != nil {
		return out, err
	}
	var accounts []Account
	for rows.Next() {
		a, e := scanAccount(rows)
		if e != nil {
			rows.Close()
			return out, e
		}
		accounts = append(accounts, a)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	if len(accounts) > 1000 {
		return out, errors.New("ledger_snapshot_capacity_exceeded")
	}
	if len(accounts) == 0 {
		out.Reconciliation = "insufficient_data"
	}
	for _, a := range accounts {
		b, e := s.Blnk.Balance(ctx, a.BalanceID)
		if e != nil {
			return out, e
		}
		if b.Currency != a.Currency || b.LedgerID != s.LedgerID {
			return out, ErrConflict
		}
		var expected string
		err = tx.QueryRow(ctx, `SELECT COALESCE(sum(CASE WHEN destination_id=$1 THEN amount_minor ELSE -amount_minor END),0)::text FROM ledger_journal WHERE source_id=$1 OR destination_id=$1`, a.ID).Scan(&expected)
		if err != nil {
			return out, err
		}
		if b.Amount.String() != expected || b.InflightDebit.Sign() != 0 {
			out.Reconciliation = "mismatch"
		}
		held := new(big.Int).Set(b.InflightDebit)
		if a.Kind == "transit" {
			held.Set(b.Amount)
		}
		available := new(big.Int).Sub(b.Amount, held)
		if a.Kind != "clearing" {
			out.Accounts = append(out.Accounts, BalanceView{a, b.Amount.String(), held.String(), available.String()})
			sum := new(big.Int)
			if v, ok := out.Totals[a.Currency]; ok {
				sum.SetString(v, 10)
			}
			sum.Add(sum, b.Amount)
			out.Totals[a.Currency] = sum.String()
		}
	}
	err = tx.QueryRow(ctx, `SELECT count(*) FROM ledger_operations WHERE namespace=$1 AND customer_id=$2 AND state NOT IN ('applied','released','rejected')`, s.Namespace, customer).Scan(&out.PendingOperations)
	if err != nil {
		return out, err
	}
	out.ObservedAt = time.Now().UTC()
	return out, nil
}

// Get retrieves durable processing state without resending any operation.
func (s *Service) Get(ctx context.Context, customer, id string) (Operation, error) {
	if !validID(customer) || !validID(id) {
		return Operation{}, ErrInvalid
	}
	o, err := scanOperation(s.DB.QueryRow(ctx, `SELECT `+operationColumns+` FROM ledger_operations WHERE namespace=$1 AND customer_id=$2 AND id=$3`, s.Namespace, customer, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Operation{}, ErrNotFound
	}
	return o, err
}

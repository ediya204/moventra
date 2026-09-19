package issuing

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// PilotAuthorization is an authorization to attempt ONE real issuance, not a
// certification that the supplier has passed live acceptance. No secrets here.
type PilotAuthorization struct {
	CustomerID     string    `json:"customerId"`
	ProductID      string    `json:"productId"`
	SupplierID     string    `json:"supplierId"`
	OrderID        string    `json:"orderId"`
	BIN            string    `json:"bin"`
	FundsNamespace string    `json:"fundsNamespace"`
	FeeCapMinor    string    `json:"feeCapMinor"`
	FundingMinor   string    `json:"fundingMinor"`
	TotalCapMinor  string    `json:"totalCapMinor"`
	ExpiresAt      time.Time `json:"expiresAt"`
	EvidenceRef    string    `json:"evidenceRef"`
	KeyEnv         string    `json:"keyEnv"`
	Entity         string    `json:"entity"`
	Account        string    `json:"account"`
}

func parsePilot(raw string) (*PilotAuthorization, error) {
	var p PilotAuthorization
	d := json.NewDecoder(strings.NewReader(raw))
	d.DisallowUnknownFields()
	if len(raw) > 8192 || d.Decode(&p) != nil || d.Decode(new(any)) != io.EOF ||
		!ValidID(p.CustomerID) || !ValidID(p.ProductID) || !ValidID(p.SupplierID) || !ValidID(p.OrderID) ||
		!binRE.MatchString(p.BIN) || !strings.HasPrefix(p.FundsNamespace, "live_") || !textOK(p.FundsNamespace, 64) ||
		!textOK(p.EvidenceRef, 300) || p.ExpiresAt.IsZero() ||
		p.FeeCapMinor != "1000" || p.FundingMinor != "2000" || p.TotalCapMinor != "3000" ||
		!strings.HasPrefix(p.KeyEnv, "ISSUING_SLASH_KEY_") || !sourceID.MatchString(p.KeyEnv) ||
		!sourceID.MatchString(p.Entity) || !sourceID.MatchString(p.Account) {
		return nil, errors.New("invalid_issuing_pilot_authorization")
	}
	return &p, nil
}

func (s *Service) pilotFromEnv() (*Service, error) {
	p, err := parsePilot(os.Getenv("ISSUING_PILOT_CONFIG"))
	if err != nil {
		return nil, err
	}
	if s.Funds == nil || s.Funds.Namespace != p.FundsNamespace || os.Getenv(p.KeyEnv) == "" || os.Getenv("ISSUING_CERTIFICATION_FILE") != "" {
		return nil, errors.New("issuing_pilot_configuration_required")
	}
	s.Pilot = p
	s.Providers[p.SupplierID] = NewSlash(os.Getenv(p.KeyEnv), p.Entity, p.Account)
	s.Mode, s.Enabled = "pilot", true
	return s, nil
}

func (p *PilotAuthorization) matches(customer string, v Snapshot) bool {
	return customer == p.CustomerID && v.Product.ID == p.ProductID && v.Product.BIN == p.BIN &&
		v.Product.SupplierID == p.SupplierID && v.Supplier.ID == p.SupplierID &&
		v.Supplier.Adapter == "slash" && v.Supplier.AccountRef == p.Account && v.Supplier.EntityRef == p.Entity &&
		v.FundsNamespace == p.FundsNamespace && ValidID(v.FundsWalletID) && v.ConnectionID != "" && v.VirtualAccountID != ""
}
func (p *PilotAuthorization) amountAllowed(fee, funding string) bool {
	return Money(fee, false) && funding == p.FundingMinor && number(fee).Cmp(number(p.FeeCapMinor)) <= 0 && number(add(fee, funding)).Cmp(number(p.TotalCapMinor)) <= 0
}
func (s *Service) pilotAuthorized(ctx context.Context, tx pgx.Tx) (bool, error) {
	p := s.Pilot
	var ok bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_audit WHERE customer_id=$1 AND resource_id=$2 AND action='pilot.authorize' AND detail->>'configHash'=$3)`, p.CustomerID, p.OrderID, hash(p)).Scan(&ok)
	return ok, err
}
func (s *Service) pilotAvailability(ctx context.Context, tx pgx.Tx, customer string, v Snapshot) (string, error) {
	p := s.Pilot
	if p == nil {
		return "", nil
	}
	if !p.matches(customer, v) {
		return "pilot_scope_required", nil
	}
	if !time.Now().Before(p.ExpiresAt) {
		return "pilot_expired", nil
	}
	if !p.amountAllowed(v.FeeMinor, p.FundingMinor) || !Money(v.Product.MinimumMinor, true) || number(v.Product.MinimumMinor).Cmp(number(p.FundingMinor)) > 0 {
		return "pilot_amount_limit", nil
	}
	ok, err := s.pilotAuthorized(ctx, tx)
	if err != nil {
		return "", err
	}
	if !ok {
		return "pilot_not_authorized", nil
	}
	var used bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_orders WHERE customer_id=$1 OR id=$2)`, p.CustomerID, p.OrderID).Scan(&used)
	if err != nil {
		return "", err
	}
	if used {
		return "pilot_already_used", nil
	}
	return "", nil
}
func (s *Service) pilotOrderAllowed(ctx context.Context, tx pgx.Tx, o Order) error {
	p := s.Pilot
	if p == nil {
		return nil
	}
	if o.ID != p.OrderID || o.ProductID != p.ProductID || o.ParentID != "" || !p.matches(o.CustomerID, o.Snapshot) || o.Snapshot.PilotAuthorization != hash(p) || !p.amountAllowed(o.FeeMinor, o.FundingMinor) || o.Snapshot.FeeMinor != o.FeeMinor {
		return ErrBlocked
	}
	ok, err := s.pilotAuthorized(ctx, tx)
	if err != nil {
		return err
	}
	if !ok {
		return ErrBlocked
	}
	// Expiry stops NEW submissions, never recovery of an accepted order.
	return nil
}

// ConfigurePilot is a trusted CLI operation, never an HTTP granting endpoint.
// The immutable audit row binds both API and worker to the reviewed authority.
func (s *Service) ConfigurePilot(ctx context.Context, tx pgx.Tx, actor string) error {
	p := s.Pilot
	if p == nil || !ValidID(actor) || !time.Now().Before(p.ExpiresAt) {
		return ErrBlocked
	}
	if err := Lock(ctx, tx, "catalog"); err != nil {
		return err
	}
	if err := Lock(ctx, tx, p.CustomerID); err != nil {
		return err
	}
	var admin bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND role='admin' AND status='active')`, actor).Scan(&admin); err != nil {
		return err
	}
	if !admin {
		return ErrForbidden
	}
	var priorHash, priorID string
	err := tx.QueryRow(ctx, `SELECT detail->>'configHash',resource_id FROM issuing_audit WHERE customer_id=$1 AND action='pilot.authorize' ORDER BY id LIMIT 1`, p.CustomerID).Scan(&priorHash, &priorID)
	if err == nil {
		if priorHash == hash(p) && priorID == p.OrderID {
			return nil
		}
		return ErrConflict
	}
	if err != pgx.ErrNoRows {
		return err
	}
	var used bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_orders WHERE customer_id=$1 OR id=$2)`, p.CustomerID, p.OrderID).Scan(&used); err != nil {
		return err
	}
	if used {
		return ErrBlocked
	}
	v, _, err := s.snapshot(ctx, tx, p.CustomerID, p.ProductID)
	if err != nil {
		return err
	}
	// The reviewed CLI authority may fill a previously unbound entity only
	// before any supplier order exists. Never replace an existing binding.
	previousEntity := v.Supplier.EntityRef
	if previousEntity == "" {
		var supplierUsed bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_orders WHERE supplier_id=$1)`, p.SupplierID).Scan(&supplierUsed); err != nil {
			return err
		}
		if supplierUsed {
			return ErrBlocked
		}
		v.Supplier.EntityRef = p.Entity
	}
	if !p.matches(p.CustomerID, v) || !p.amountAllowed(v.FeeMinor, p.FundingMinor) || v.Product.Status != "active" || !Money(v.Product.MinimumMinor, true) || number(v.Product.MinimumMinor).Cmp(number(p.FundingMinor)) > 0 {
		return ErrBlocked
	}
	sp := v.Supplier
	sp.Status = "active"
	if _, err = SaveSupplier(ctx, tx, sp); err != nil {
		return err
	}
	var revision int64
	err = tx.QueryRow(ctx, `SELECT revision FROM issuing_customers WHERE customer_id=$1`, p.CustomerID).Scan(&revision)
	if err != nil && err != pgx.ErrNoRows {
		return err
	}
	// Preserve any group pricing on an existing enrollment.
	var group string
	if err = tx.QueryRow(ctx, `SELECT COALESCE((SELECT group_id::text FROM issuing_customers WHERE customer_id=$1),'')`, p.CustomerID).Scan(&group); err != nil {
		return err
	}
	if err = SaveEnrollment(ctx, tx, Enrollment{CustomerID: p.CustomerID, GroupID: group, Enabled: true, Revision: revision}); err != nil {
		return err
	}
	if err = Audit(ctx, tx, actor, p.CustomerID, p.OrderID, "pilot.authorize", map[string]any{"configHash": hash(p), "authorization": p, "supplierPreviously": v.Supplier.Status, "entityPreviously": previousEntity, "customerRevisionBefore": revision}); err != nil {
		return err
	}
	_, blocked, err := s.snapshot(ctx, tx, p.CustomerID, p.ProductID)
	if err != nil {
		return err
	}
	if blocked != "" {
		return ErrBlocked
	}
	return nil
}

func (s *Service) PilotView(customer string) any {
	if s.Pilot == nil || s.Pilot.CustomerID != customer {
		return nil
	}
	p := s.Pilot
	return map[string]any{"bin": p.BIN, "maxCards": 1, "fundingMinor": p.FundingMinor, "feeCapMinor": p.FeeCapMinor, "totalCapMinor": p.TotalCapMinor, "expiresAt": p.ExpiresAt}
}
func (s *Service) ExecutionFor(customer string) bool {
	return s.Enabled && (s.Pilot == nil || s.Pilot.CustomerID == customer)
}

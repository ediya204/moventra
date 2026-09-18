package cryptofunds

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"moventra.local/api/internal/cregis"
	"moventra.local/api/internal/ethereum"
	"moventra.local/api/internal/tron"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

func validNetwork(n string) bool { return n == "TRC20" || n == "ERC20" }
func fixtureNetwork(n string) string {
	if n == "ERC20" {
		return "ethereum-fixture"
	}
	return "tron-fixture"
}
func validNetworkAddress(n, a string) bool {
	if n == "ERC20" {
		return ethereum.ValidAddress(a)
	}
	if n == "TRC20" || n == "" {
		return validRecipient(a)
	}
	return false
}

type ChainVerifier interface {
	Verify(context.Context, string, string, string, string) (tron.Proof, error)
}
type FundingProvider interface {
	CreateAddress(context.Context, string, string, string) (string, error)
	Payout(context.Context, cregis.PayoutRequest) (string, error)
}
type FundingReader interface {
	Coins(context.Context) (cregis.Coins, error)
	QueryPayout(context.Context, string) (cregis.PayoutInfo, error)
	ValidateAddress(context.Context, string, string) (bool, error)
}
type NetworkConfig struct {
	Network    string        `json:"network"`
	ChainID    string        `json:"chainId"`
	TokenID    string        `json:"tokenId"`
	Contract   string        `json:"contract"`
	NodeURLEnv string        `json:"nodeUrlEnv"`
	Deposit    bool          `json:"deposit"`
	Withdraw   bool          `json:"withdraw"`
	Verifier   ChainVerifier `json:"-"`
}
type LiveRuntime struct {
	Writer                           FundingProvider
	Reader                           FundingReader
	Connection, Project, CallbackURL string
	Networks                         map[string]NetworkConfig
	Cards                            CardProvider
}

// Activation requires an evidence manifest. Merely deploying this code never enables live funds.
func LiveFromEnv() (*LiveRuntime, error) {
	if os.Getenv("FUNDS_LIVE_ACTIVATION") != "approved" {
		return nil, errors.New("funds_activation_required")
	}
	raw, e := os.ReadFile(os.Getenv("FUNDS_CERTIFICATION_FILE"))
	if e != nil {
		return nil, errors.New("funds_certification_required")
	}
	var cfg struct {
		EvidenceRef                                                               string `json:"evidenceRef"`
		ZeroOpening, AccountingAccepted, RecoveryVerified, ReconciliationVerified bool
		Networks                                                                  []NetworkConfig `json:"networks"`
	}
	if json.Unmarshal(raw, &cfg) != nil || cfg.EvidenceRef == "" || !cfg.ZeroOpening || !cfg.AccountingAccepted || !cfg.RecoveryVerified || !cfg.ReconciliationVerified {
		return nil, errors.New("funds_certification_invalid")
	}
	callback, e := url.Parse(os.Getenv("FUNDS_CALLBACK_ORIGIN"))
	if e != nil || callback.Scheme != "https" || callback.Hostname() == "" || callback.User != nil || callback.RawQuery != "" || callback.Fragment != "" || callback.Path != "" {
		return nil, errors.New("funds_callback_origin_required")
	}
	c, e := cregis.FromEnv()
	if e != nil {
		return nil, e
	}
	w, e := cregis.NewLiveWriter(c, true)
	if e != nil {
		return nil, e
	}
	live := &LiveRuntime{Writer: w, Reader: c, Connection: "cregis-waas", Project: os.Getenv("CREGIS_PROJECT_ID"), CallbackURL: callback.String(), Networks: map[string]NetworkConfig{}}
	for _, n := range cfg.Networks {
		if !validNetwork(n.Network) || n.TokenID == "" || !validNetworkAddress(n.Network, n.Contract) || live.Networks[n.Network].Network != "" || !strings.HasPrefix(n.NodeURLEnv, "FUNDS_") {
			return nil, errors.New("invalid_funds_network")
		}
		if n.Network == "TRC20" {
			if n.ChainID != "195" {
				return nil, errors.New("invalid_tron_chain")
			}
			n.Verifier, e = tron.New(os.Getenv(n.NodeURLEnv), os.Getenv("TRON_NODE_KEY"))
		} else {
			if n.ChainID != "1" {
				return nil, errors.New("invalid_ethereum_chain")
			}
			n.Contract = strings.ToLower(n.Contract)
			n.Verifier, e = ethereum.New(os.Getenv(n.NodeURLEnv))
		}
		if e != nil {
			return nil, e
		}
		live.Networks[n.Network] = n
	}
	if len(live.Networks) != 2 {
		return nil, errors.New("both_networks_required")
	}
	if os.Getenv("FUNDS_SLASH_CERTIFICATION_FILE") != "" {
		live.Cards, e = CardProviderFromEnv()
		if e != nil {
			return nil, e
		}
	}
	return live, nil
}
func (s *Service) Mode() string {
	if s.Ledger.IsLive() {
		return "live"
	}
	return "shadow"
}
func (s *Service) Capabilities(config Settings) []map[string]any {
	out := []map[string]any{}
	for _, n := range []string{"TRC20", "ERC20"} {
		dep, withdraw := false, false
		if s.Live != nil {
			v := s.Live.Networks[n]
			dep = v.Deposit
			withdraw = v.Withdraw && config.WithdrawEnabled && config.NetworkFees[n] != nil
		}
		out = append(out, map[string]any{"network": n, "depositEnabled": dep, "withdrawEnabled": withdraw})
	}
	return out
}
func (s *Service) requestAddress(ctx context.Context, tx pgx.Tx, customer, network string) (any, error) {
	if !validNetwork(network) || s.Live == nil || !s.Live.Networks[network].Deposit {
		return nil, conflict("network_not_enabled")
	}
	_, e := tx.Exec(ctx, `INSERT INTO funds_address_jobs(namespace,customer_id,network,id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, s.NS(), customer, network, uuid.NewString())
	if e != nil {
		return nil, e
	}
	var state string
	e = tx.QueryRow(ctx, `SELECT state FROM funds_address_jobs WHERE namespace=$1 AND customer_id=$2 AND network=$3`, s.NS(), customer, network).Scan(&state)
	return map[string]string{"network": network, "state": state}, e
}
func (l *LiveRuntime) coin(ctx context.Context, n NetworkConfig, payout bool) error {
	coins, e := l.Reader.Coins(ctx)
	if e != nil {
		return e
	}
	list := coins.Address
	if payout {
		list = coins.Payout
	}
	for _, c := range list {
		if c.ChainID == n.ChainID && c.TokenID == n.TokenID && c.Decimals == "6" {
			return nil
		}
	}
	return conflict("provider_coin_not_enabled")
}
func (s *Service) CreateAddresses(ctx context.Context) error {
	if s.Live == nil || s.Live.Writer == nil {
		return nil
	}
	rows, e := s.Ledger.DB.Query(ctx, `SELECT j.customer_id::text,j.network,j.id::text FROM funds_address_jobs j JOIN customers c ON c.id=j.customer_id WHERE j.namespace=$1 AND j.state='queued' AND c.onboarding_status='approved' AND c.service_status='active' ORDER BY j.updated_at LIMIT 10`, s.NS())
	if e != nil {
		return e
	}
	var jobs [][3]string
	for rows.Next() {
		var v [3]string
		if e = rows.Scan(&v[0], &v[1], &v[2]); e != nil {
			break
		}
		jobs = append(jobs, v)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return e
	}
	for _, j := range jobs {
		n := s.Live.Networks[j[1]]
		if !n.Deposit {
			continue
		}
		if e = s.Live.coin(ctx, n, false); e != nil {
			return e
		}
		// Commit the claim before the channel request. Unknown creation is never blindly repeated.
		tag, e := s.Ledger.DB.Exec(ctx, `UPDATE funds_address_jobs SET state='submitting',updated_at=now() WHERE namespace=$1 AND id=$2 AND state='queued'`, s.NS(), j[2])
		if e != nil {
			return e
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		address, callErr := s.Live.Writer.CreateAddress(ctx, n.ChainID, "mv_"+j[2], s.Live.CallbackURL+"/webhooks/cregis/deposit")
		if callErr != nil || !validNetworkAddress(j[1], address) {
			_, e = s.Ledger.DB.Exec(ctx, `UPDATE funds_address_jobs SET state='unknown',error='address_outcome_unknown',updated_at=now() WHERE namespace=$1 AND id=$2`, s.NS(), j[2])
			if e != nil {
				return e
			}
			continue
		}
		if j[1] == "ERC20" {
			address = strings.ToLower(address)
		}
		tx, e := s.Ledger.DB.Begin(ctx)
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, `INSERT INTO crypto_addresses(namespace,connection_id,project_id,network,customer_id,address,chain_address,mode) VALUES($1,$2,$3,$4,$5,$6,$6,'live')`, s.NS(), s.Live.Connection, s.Live.Project, j[1], j[0], address)
		if e == nil {
			_, e = tx.Exec(ctx, `UPDATE funds_address_jobs SET state='completed',address=$1,updated_at=now() WHERE namespace=$2 AND id=$3`, address, s.NS(), j[2])
		}
		if e == nil {
			e = s.Audit(ctx, tx, j[0], "", "", "address_created", map[string]string{"network": j[1], "requestId": j[2]})
		}
		if e == nil {
			e = tx.Commit(ctx)
		} else {
			tx.Rollback(ctx)
		}
		if e != nil {
			return e
		}
	}
	return nil
}
func decimalUSDT(minor string) string {
	for len(minor) < 7 {
		minor = "0" + minor
	}
	return minor[:len(minor)-6] + "." + minor[len(minor)-6:]
}

// payout returns confirmed or failed only from matching authenticated evidence.
func (s *Service) payout(ctx context.Context, o Order) (string, string, error) {
	n := s.Live.Networks[o.Network]
	var state string
	var cid *string
	e := s.Ledger.DB.QueryRow(ctx, `SELECT state,provider_id FROM funds_provider_requests WHERE namespace=$1 AND order_id=$2 AND kind='payout'`, s.NS(), o.ID).Scan(&state, &cid)
	if errors.Is(e, pgx.ErrNoRows) {
		if !n.Withdraw {
			return "", "", conflict("network_not_enabled")
		}
		if e = s.Live.coin(ctx, n, true); e != nil {
			return "", "", e
		}
		ok, e := s.Live.Reader.ValidateAddress(ctx, n.ChainID, o.Address)
		if e != nil || !ok {
			return "", "", conflict("address_validation_failed")
		}
		request := cregis.PayoutRequest{Currency: n.ChainID + "@" + n.TokenID, Address: o.Address, Amount: decimalUSDT(o.Amount), BusinessID: o.ID, CallbackURL: s.Live.CallbackURL + "/webhooks/cregis/payout"}
		raw, _ := json.Marshal(request)
		tag, e := s.Ledger.DB.Exec(ctx, `INSERT INTO funds_provider_requests(namespace,order_id,kind,state,request) VALUES($1,$2,'payout','submitting',$3) ON CONFLICT DO NOTHING`, s.NS(), o.ID, raw)
		if e != nil {
			return "", "", e
		}
		if tag.RowsAffected() == 0 {
			return "", "", errors.New("payout_pending")
		}
		id, err := s.Live.Writer.Payout(ctx, request)
		if err != nil {
			_, e = s.Ledger.DB.Exec(ctx, `UPDATE funds_provider_requests SET state='unknown',updated_at=now() WHERE namespace=$1 AND order_id=$2 AND kind='payout'`, s.NS(), o.ID)
			return "unknown", "", e
		}
		_, e = s.Ledger.DB.Exec(ctx, `UPDATE funds_provider_requests SET state='submitted',provider_id=$3,updated_at=now() WHERE namespace=$1 AND order_id=$2 AND kind='payout'`, s.NS(), o.ID, id)
		if e != nil {
			return "unknown", "", e
		}
		cid = &id
	} else if e != nil {
		return "", "", e
	}
	if cid == nil || *cid == "" {
		return "unknown", "", nil
	}
	p, e := s.Live.Reader.QueryPayout(ctx, *cid)
	if e != nil {
		return "unknown", "", e
	}
	amount, e := DecimalMinor(p.Amount, 6)
	if e != nil || p.BusinessID != o.ID || p.ChainID != n.ChainID || p.TokenID != n.TokenID || !sameAddress(o.Network, p.Address, o.Address) || amount != o.Amount || p.ProjectID.String() != s.Live.Project || p.Status == nil {
		return "unknown", "", conflict("payout_evidence_mismatch")
	}
	if *p.Status == 2 || *p.Status == 4 || *p.Status == 7 {
		return "failed", "", nil
	}
	if *p.Status != 6 || p.TransactionID == nil {
		return "unknown", "", nil
	}
	proof, e := n.Verifier.Verify(ctx, *p.TransactionID, n.Contract, o.Address, o.Amount)
	if e != nil {
		return "unknown", "", e
	}
	return "confirmed", proof.TransactionHash, nil
}
func sameAddress(network, a, b string) bool {
	if network == "ERC20" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

var safeRef = regexp.MustCompile(`^[A-Za-z0-9_-]{1,180}$`)

// Source callbacks are persisted before this worker resolves customer ownership.
func (s *Service) ProcessLiveEvents(ctx context.Context) error {
	if s.Live == nil {
		return nil
	}
	rows, e := s.Ledger.DB.Query(ctx, `SELECT id::text,kind,external_id,payload FROM crypto_events WHERE namespace=$1 AND connection_id=$2 AND project_id=$3 AND kind IN ('deposit','payout') AND state='received' AND ($4='' OR (kind='deposit' AND payload->>'address'=$4 AND payload->>'chain_id'='195' AND payload->>'token_id'=$5)) ORDER BY updated_at,id LIMIT 20`, s.NS(), s.Live.Connection, s.Live.Project, s.pilotAddress(), pilotToken)
	if e != nil {
		return e
	}
	type event struct {
		id, kind, cid string
		raw           []byte
	}
	list := []event{}
	for rows.Next() {
		var v event
		if e = rows.Scan(&v.id, &v.kind, &v.cid, &v.raw); e != nil {
			break
		}
		list = append(list, v)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return e
	}
	for _, ev := range list {
		if e = s.liveEvent(ctx, ev.id, ev.kind, ev.cid, ev.raw); e != nil {
			// Rotate unresolved evidence instead of starving later final transfers.
			code := "verification_pending"
			if s.Pilot != nil && e.Error() == "deposit_pilot_cap_reached" {
				code = "deposit_pilot_cap_reached"
			}
			if _, err := s.Ledger.DB.Exec(ctx, `UPDATE crypto_events SET updated_at=now(),error=$2 WHERE id=$1 AND state='received'`, ev.id, code); err != nil {
				return err
			}
			continue
		}
	}
	return nil
}
func (s *Service) liveEvent(ctx context.Context, eventID, kind, cid string, raw []byte) error {
	if s.Pilot != nil && kind != "deposit" {
		return errors.New("deposit_pilot_scope_rejected")
	}
	var f map[string]json.RawMessage
	if json.Unmarshal(raw, &f) != nil {
		return invalid("invalid_event")
	}
	str := func(k string) string { var v string; json.Unmarshal(f[k], &v); return v }
	var network string
	var n NetworkConfig
	for _, v := range s.Live.Networks {
		if str("chain_id") == v.ChainID && str("token_id") == v.TokenID {
			network = v.Network
			n = v
		}
	}
	if network == "" {
		return invalid("unsupported_asset")
	}
	amount, e := DecimalMinor(str("amount"), 6)
	if e != nil {
		return e
	}
	address := str("address")
	if network == "ERC20" {
		address = strings.ToLower(address)
	}
	if kind == "payout" {
		var o Order
		var body []byte
		e = s.Ledger.DB.QueryRow(ctx, `SELECT data FROM crypto_orders WHERE namespace=$1 AND id::text=$2 AND kind='withdrawal'`, s.NS(), str("third_party_id")).Scan(&body)
		if e != nil {
			return e
		}
		if json.Unmarshal(body, &o) != nil || o.Network != network || o.Amount != amount || !sameAddress(network, o.Address, address) {
			return conflict("payout_evidence_mismatch")
		}
		_, e = s.Ledger.DB.Exec(ctx, `UPDATE funds_provider_requests SET provider_id=$3,state='submitted',updated_at=now() WHERE namespace=$1 AND order_id=$2 AND kind='payout' AND (provider_id IS NULL OR provider_id=$3)`, s.NS(), o.ID, cid)
		if e != nil {
			return e
		}
		_, e = s.Ledger.DB.Exec(ctx, `UPDATE crypto_events SET state='linked',order_id=$2,updated_at=now() WHERE id=$1`, eventID, o.ID)
		return e
	}
	if str("status") != "1" {
		_, e = s.Ledger.DB.Exec(ctx, `UPDATE crypto_events SET state='non_posting',updated_at=now() WHERE id=$1`, eventID)
		return e
	}
	var customer string
	var effective time.Time
	e = s.Ledger.DB.QueryRow(ctx, `SELECT customer_id::text,effective_at FROM crypto_addresses WHERE namespace=$1 AND connection_id=$2 AND project_id=$3 AND network=$4 AND address=$5 AND mode='live'`, s.NS(), s.Live.Connection, s.Live.Project, network, address).Scan(&customer, &effective)
	if e != nil {
		return e
	}
	if s.Pilot != nil && (customer != s.Pilot.Customer || address != s.Pilot.Address || network != "TRC20") {
		return errors.New("deposit_pilot_scope_rejected")
	}
	proof, e := n.Verifier.Verify(ctx, str("txid"), n.Contract, address, amount)
	if e != nil {
		return e
	}
	tx, e := s.Ledger.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if e = s.Lock(ctx, tx, customer); e != nil {
		return e
	}
	economic := digest([]string{network, n.Contract, proof.TransactionHash, proof.TransferIndex})
	_, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, s.NS()+":deposit:"+economic)
	if e != nil {
		return e
	}
	var id, owner string
	e = tx.QueryRow(ctx, `SELECT p.order_id::text,o.customer_id::text FROM crypto_postings p JOIN crypto_orders o ON o.id=p.order_id WHERE p.namespace=$1 AND p.economic_key=$2`, s.NS(), economic).Scan(&id, &owner)
	if errors.Is(e, pgx.ErrNoRows) {
		if s.Pilot != nil {
			if e = s.pilotCapacity(ctx, tx, amount); e != nil {
				return e
			}
		}
		o := Order{Network: network, CustomerID: customer, Kind: "deposit", State: "processing", Currency: "USDT", ToCurrency: "USDT", Amount: amount, Receive: amount, Fee: "0", Address: address, Approval: "not_required", Provider: "confirmed", Chain: "finalized", Posting: "pending", Proof: &proof, Contract: n.Contract, TransactionHash: proof.TransactionHash, Evidence: proof.EvidenceRef}
		if e = s.Insert(ctx, tx, &o); e != nil {
			return e
		}
		id = o.ID
		_, e = tx.Exec(ctx, `INSERT INTO crypto_postings(namespace,economic_key,order_id) VALUES($1,$2,$3)`, s.NS(), economic, id)
	} else if e == nil && owner != customer {
		return conflict("deposit_owner_conflict")
	}
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `UPDATE crypto_events SET state='verified',order_id=$2,error='',updated_at=now() WHERE id=$1`, eventID, id)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}

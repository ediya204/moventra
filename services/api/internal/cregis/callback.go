package cregis

import (
	"encoding/json"
	"regexp"
)

type CallbackKind string

const (
	Deposit CallbackKind = "deposit"
	Payout  CallbackKind = "payout"
)

// Observation is authenticated provider evidence, not a ledger command. There
// is intentionally no balance, customer ID, transfer index or finality flag.
type Observation struct {
	Kind                       CallbackKind
	ProjectID, EventID, Status string
	Fields                     map[string]any
}

var positiveID = regexp.MustCompile(`^[1-9][0-9]*$`)
var decimalAmount = regexp.MustCompile(`^(0|[1-9][0-9]*)(\.[0-9]+)?$`)
var callbackNonce = regexp.MustCompile(`^[a-zA-Z0-9]{6}$`)

// VerifyCallback validates the documented type-specific envelope. Callers must
// additionally persist/deduplicate by connection, project, kind and event ID,
// and resolve customer ownership before exposing or processing observations.
// Delayed retries are allowed: timestamp is validated, not a replay defense.
func VerifyCallback(key, projectID string, kind CallbackKind, raw []byte) (Observation, error) {
	f, err := VerifyWaaS(key, projectID, raw)
	if err != nil {
		return Observation{}, err
	}
	id := func(k string) string {
		n, ok := f[k].(json.Number)
		if !ok {
			return ""
		}
		v, e := n.Int64()
		if e != nil || v <= 0 || !positiveID.MatchString(n.String()) {
			return ""
		}
		return n.String()
	}
	str := func(k string) string { v, _ := f[k].(string); return v }
	if id("pid") == "" || id("cid") == "" || id("timestamp") == "" || !callbackNonce.MatchString(str("nonce")) {
		return Observation{}, ErrInvalid
	}
	for _, k := range []string{"chain_id", "token_id", "currency", "address"} {
		if str(k) == "" {
			return Observation{}, ErrInvalid
		}
	}
	if !decimalAmount.MatchString(str("amount")) {
		return Observation{}, ErrInvalid
	}
	var status string
	switch kind {
	case Deposit:
		status = str("status")
		if status != "1" && status != "2" {
			return Observation{}, ErrInvalid
		}
	case Payout:
		n, ok := f["status"].(json.Number)
		if !ok || str("third_party_id") == "" {
			return Observation{}, ErrInvalid
		}
		status = n.String()
		if status != "2" && status != "4" && status != "6" && status != "7" {
			return Observation{}, ErrInvalid
		}
	default:
		return Observation{}, ErrInvalid
	}
	if (kind == Deposit && status == "1" || kind == Payout && status == "6") && str("txid") == "" {
		return Observation{}, ErrInvalid
	}
	return Observation{Kind: kind, ProjectID: projectID, EventID: id("cid"), Status: status, Fields: f}, nil
}

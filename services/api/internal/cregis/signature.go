// Package cregis contains provider protocol adapters. Verified provider messages
// are observations, not authority to alter customer balances or approve payouts.
package cregis

import (
	"bytes"
	"crypto/hmac"
	"crypto/md5" // Required by Cregis WaaS; not used for Team API.
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strings"
)

var ErrInvalid = errors.New("invalid_cregis_message")
var ErrSignature = errors.New("invalid_cregis_signature")

// TeamSignature signs the exact bytes sent over HTTP, not a re-encoded object.
func TeamSignature(secret, path, timestamp, nonce string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(path + "\n" + timestamp + "\n" + nonce + "\n"))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// ParseFields accepts flat WaaS objects only. Reject duplicate keys rather than
// letting a parser silently choose which value is authenticated.
func ParseFields(raw []byte) (map[string]any, error) {
	if len(raw) > 65536 {
		return nil, ErrInvalid
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	start, e := d.Token()
	if e != nil || start != json.Delim('{') {
		return nil, ErrInvalid
	}
	fields := map[string]any{}
	for d.More() {
		key, e := d.Token()
		if e != nil {
			return nil, ErrInvalid
		}
		k, ok := key.(string)
		if !ok || k == "" {
			return nil, ErrInvalid
		}
		if _, exists := fields[k]; exists {
			return nil, ErrInvalid
		}
		var v any
		if d.Decode(&v) != nil {
			return nil, ErrInvalid
		}
		switch v.(type) {
		case nil, string, json.Number:
		default:
			return nil, ErrInvalid
		}
		fields[k] = v
	}
	if end, e := d.Token(); e != nil || end != json.Delim('}') {
		return nil, ErrInvalid
	}
	if d.Decode(new(any)) != io.EOF {
		return nil, ErrInvalid
	}
	return fields, nil
}

func scalar(v any) (string, error) {
	switch n := v.(type) {
	case nil:
		return "", nil
	case string:
		return n, nil
	case json.Number:
		// WaaS numeric protocol fields are integers. Never round through float64.
		if _, e := n.Int64(); e != nil {
			return "", ErrInvalid
		}
		return n.String(), nil
	default:
		return "", ErrInvalid
	}
}
func WaaSSignature(key string, fields map[string]any) (string, error) {
	if key == "" {
		return "", ErrInvalid
	}
	keys := make([]string, 0, len(fields))
	for k := range fields {
		if k != "sign" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteString(key)
	for _, k := range keys {
		v, e := scalar(fields[k])
		if e != nil {
			return "", e
		}
		if v != "" {
			b.WriteString(k)
			b.WriteString(v)
		}
	}
	sum := md5.Sum([]byte(b.String()))
	return hex.EncodeToString(sum[:]), nil
}
func VerifyWaaS(key, projectID string, raw []byte) (map[string]any, error) {
	fields, e := ParseFields(raw)
	if e != nil {
		return nil, e
	}
	pid, ok := fields["pid"].(json.Number)
	if !ok || pid.String() != projectID {
		return nil, ErrSignature
	}
	sig, ok := fields["sign"].(string)
	if !ok || len(sig) != 32 {
		return nil, ErrSignature
	}
	expected, e := WaaSSignature(key, fields)
	if e != nil || subtle.ConstantTimeCompare([]byte(expected), []byte(sig)) != 1 {
		return nil, ErrSignature
	}
	return fields, nil
}

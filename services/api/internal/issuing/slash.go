package issuing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"time"
)

// No browser-controlled origins or arbitrary provider methods are accepted.
type Slash struct {
	key, entity, account string
	http                 *http.Client
	base                 string
}

var sourceID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,180}$`)
var last4RE = regexp.MustCompile(`^[0-9]{4}$`)

type slashConstraint struct {
	SpendingRule *struct {
		UtilizationLimit *struct {
			LimitAmount struct {
				Amount json.Number `json:"amountCents"`
			} `json:"limitAmount"`
			Preset string `json:"preset"`
		} `json:"utilizationLimit"`
		TransactionSizeLimit *struct {
			Maximum *struct {
				Amount json.Number `json:"amountCents"`
			} `json:"maximum"`
		} `json:"transactionSizeLimit"`
	} `json:"spendingRule"`
}
type slashCard struct {
	ID        string `json:"id"`
	AccountID string `json:"accountId"`
	ProductID string `json:"cardProductId"`
	Last4     string `json:"last4"`
	Status    string `json:"status"`
	UserData  struct {
		OrderID string `json:"moventraOrderId"`
	} `json:"userData"`
	Constraint slashConstraint `json:"spendingConstraint"`
}

func constraint(amount string) map[string]any {
	return map[string]any{"spendingRule": map[string]any{"utilizationLimit": map[string]any{"limitAmount": map[string]any{"amountCents": json.Number(amount)}, "preset": "collective"}, "transactionSizeLimit": map[string]any{"maximum": map[string]any{"amountCents": json.Number(amount)}}}}
}
func (c slashCard) matches(v Snapshot, order string) bool {
	return sourceID.MatchString(c.ID) && c.AccountID == v.Supplier.AccountRef && c.ProductID == v.Product.UpstreamID && last4RE.MatchString(c.Last4) && (order == "" || c.UserData.OrderID == order)
}
func (c slashCard) limit(amount string) bool {
	r := c.Constraint.SpendingRule
	return r != nil && r.UtilizationLimit != nil && r.UtilizationLimit.Preset == "collective" && r.UtilizationLimit.LimitAmount.Amount.String() == amount && r.TransactionSizeLimit != nil && r.TransactionSizeLimit.Maximum != nil && r.TransactionSizeLimit.Maximum.Amount.String() == amount
}
func (s *Slash) call(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, e := json.Marshal(in)
		if e != nil {
			return ErrInvalid
		}
		body = bytes.NewReader(b)
	}
	r, e := http.NewRequestWithContext(ctx, method, s.base+path, body)
	if e != nil {
		return ErrUnknown
	}
	r.Header.Set("X-API-Key", s.key)
	r.Header.Set("x-legal-entity", s.entity)
	r.Header.Set("Content-Type", "application/json")
	resp, e := s.http.Do(r)
	if e != nil {
		return ErrUnknown
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return ErrAccess
	}
	if resp.StatusCode == 400 || resp.StatusCode == 422 {
		return ErrRejected
	}
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return ErrUnknown
	}
	raw, e := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if e != nil || len(raw) > 1<<20 {
		return ErrUnknown
	}
	if json.Unmarshal(raw, out) != nil {
		return ErrUnknown
	}
	return nil
}
func (s *Slash) scoped(v Snapshot) bool {
	return v.Supplier.Adapter == "slash" && v.Supplier.AccountRef == s.account && v.Supplier.EntityRef == s.entity && sourceID.MatchString(v.Product.UpstreamID) && (v.CardholderRef == "" || sourceID.MatchString(v.CardholderRef))
}
func (s *Slash) Create(ctx context.Context, order string, v Snapshot) (Card, error) {
	if !s.scoped(v) {
		return Card{}, ErrRejected
	}
	var c slashCard
	name := v.CardName
	if name == "" {
		name = "Moventra " + order
	} // Preserve historical order behavior.
	body := map[string]any{"type": "virtual", "name": name, "accountId": s.account, "cardProductId": v.Product.UpstreamID, "spendingConstraint": constraint("0"), "userData": map[string]string{"moventraOrderId": order}}
	// New snapshots omit the holder and use Slash defaults; historical orders retain their frozen assignment.
	if v.CardholderRef != "" {
		body["cardholderId"] = v.CardholderRef
	}
	e := s.call(ctx, "POST", "/card", body, &c)
	if e != nil {
		return Card{}, e
	}
	if !c.matches(v, order) {
		return Card{}, ErrUnknown
	}
	return Card{c.ID, c.Last4, c.limit("0")}, nil
}
func (s *Slash) Find(ctx context.Context, order string, v Snapshot) (Card, error) {
	if !s.scoped(v) {
		return Card{}, ErrUnknown
	}
	cursor := ""
	var found *slashCard
	for page := 0; page < 10; page++ {
		path := "/card"
		if cursor != "" {
			path += "?cursor=" + url.QueryEscape(cursor)
		}
		var list struct {
			Items    []slashCard `json:"items"`
			Metadata struct {
				NextCursor string `json:"nextCursor"`
			} `json:"metadata"`
		}
		if e := s.call(ctx, "GET", path, nil, &list); e != nil {
			return Card{}, e
		}
		for _, c := range list.Items {
			if c.UserData.OrderID == order {
				if !c.matches(v, order) || found != nil {
					return Card{}, ErrUnknown
				}
				copy := c
				found = &copy
			}
		}
		if list.Metadata.NextCursor == "" {
			if found == nil {
				return Card{}, ErrUnknown
			}
			return Card{found.ID, found.Last4, found.limit("0")}, nil
		}
		if cursor == list.Metadata.NextCursor {
			return Card{}, ErrUnknown
		}
		cursor = list.Metadata.NextCursor
	}
	return Card{}, ErrUnknown
}
func (s *Slash) Enable(ctx context.Context, c Card, v Snapshot, amount string) error {
	if !s.scoped(v) || !sourceID.MatchString(c.ID) || !Money(amount, true) {
		return ErrUnknown
	}
	get := func() (slashCard, error) {
		var actual slashCard
		e := s.call(ctx, "GET", "/card/"+c.ID, nil, &actual)
		if e == nil && (!actual.matches(v, "") || actual.ID != c.ID) {
			e = ErrUnknown
		}
		return actual, e
	}
	before, e := get()
	if e != nil {
		return e
	}
	if before.limit(amount) && before.Status == "active" {
		return nil
	}
	if !before.limit("0") || before.Status != "active" {
		return ErrUnknown
	}
	var updated slashConstraint
	e = s.call(ctx, "PUT", "/card/"+c.ID+"/spending-constraint", constraint(amount), &updated)
	after, check := get()
	if check != nil {
		return check
	}
	if errors.Is(e, ErrAccess) {
		return ErrAccess
	}
	if after.limit(amount) && after.Status == "active" {
		return nil
	}
	if errors.Is(e, ErrRejected) && after.limit("0") {
		return ErrRejected
	}
	return ErrUnknown
}
func NewSlash(key, entity, account string) *Slash {
	return &Slash{key: key, entity: entity, account: account, base: "https://api.slash.com", http: &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

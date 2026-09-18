package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
)

// This command verifies the selected virtual account with one GET; it never opens
// a card, changes the provider wallet, or creates a financial balance.
func projectWalletCommand(ctx context.Context, pool *pgxpool.Pool, auth *firebaseauth.Client, apply bool) error {
	var in struct {
		TargetEmail  string                    `json:"targetEmail"`
		Assignment   database.WalletAssignment `json:"assignment"`
		ExpectedPlan string                    `json:"expectedPlan"`
	}
	d := json.NewDecoder(io.LimitReader(os.Stdin, 1<<20))
	d.DisallowUnknownFields()
	if e := d.Decode(&in); e != nil {
		return errors.New("invalid wallet assignment manifest")
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("unexpected trailing input")
	}
	target, e := auth.GetUserByEmail(ctx, strings.TrimSpace(in.TargetEmail))
	if e != nil || target.Disabled || !target.EmailVerified || !strings.EqualFold(target.Email, in.TargetEmail) {
		return errors.New("verified enabled target email required")
	}
	operatorUID := os.Getenv("PROJECTION_OPERATOR_UID")
	operator, e := auth.GetUser(ctx, operatorUID)
	if e != nil || operator.Disabled || !operator.EmailVerified {
		return errors.New("verified operator required")
	}
	key := os.Getenv("SLASH_API_KEY")
	if key == "" {
		return errors.New("server-side Slash credential required for wallet verification")
	}
	req, e := http.NewRequestWithContext(ctx, "GET", "https://api.slash.com/virtual-account/"+url.PathEscape(in.Assignment.VirtualAccountID), nil)
	if e != nil {
		return errors.New("invalid wallet identity")
	}
	req.Header.Set("X-API-Key", key)
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, e := client.Do(req)
	if e != nil {
		return errors.New("wallet verification unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return errors.New("wallet verification rejected; no bindings changed")
	}
	var fact struct {
		VirtualAccount struct {
			ID          string  `json:"id"`
			AccountID   string  `json:"accountId"`
			Name        string  `json:"name"`
			AccountType string  `json:"accountType"`
			ClosedAt    *string `json:"closedAt"`
		} `json:"virtualAccount"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&fact) != nil || fact.VirtualAccount.ID != in.Assignment.VirtualAccountID || fact.VirtualAccount.AccountID != in.Assignment.AccountID || fact.VirtualAccount.Name != in.Assignment.Label || fact.VirtualAccount.AccountType != "default" || fact.VirtualAccount.ClosedAt != nil {
		return errors.New("verified virtual account does not match requested open wallet")
	}
	plan, e := database.AssignProjectWalletCards(ctx, pool, operatorUID, target.UID, in.Assignment, in.ExpectedPlan, apply)
	if e != nil {
		return e
	}
	return json.NewEncoder(os.Stdout).Encode(plan)
}

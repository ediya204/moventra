package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"

	"firebase.google.com/go/v4/auth"
)

type Identity struct {
	UID string
	MFA bool
}
type Verifier interface {
	Verify(context.Context, string) (Identity, error)
}
type FirebaseVerifier struct{ Client *auth.Client }

func (v FirebaseVerifier) Verify(ctx context.Context, raw string) (Identity, error) {
	token, err := v.Client.VerifyIDTokenAndCheckRevoked(ctx, raw)
	if err != nil {
		return Identity{}, err
	}
	verified, _ := token.Claims["email_verified"].(bool)
	if !verified {
		return Identity{}, errors.New("verified email required")
	}
	// The Go SDK's typed FirebaseInfo omits the MFA field. Read it only AFTER
	// signature, audience, issuer, expiry and revocation verification succeeded.
	var claims struct {
		Firebase struct {
			SecondFactor string `json:"sign_in_second_factor"`
		} `json:"firebase"`
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return Identity{}, errors.New("invalid token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Identity{}, err
	}
	if err = json.Unmarshal(payload, &claims); err != nil {
		return Identity{}, err
	}
	// Only supported Firebase second factors count. A custom claim named "mfa"
	// or an unknown factor must never confer operator access.
	factor := claims.Firebase.SecondFactor
	return Identity{UID: token.UID, MFA: factor == "totp" || factor == "phone"}, nil
}

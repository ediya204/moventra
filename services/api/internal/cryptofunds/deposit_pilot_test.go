package cryptofunds

import (
	"github.com/google/uuid"
	"moventra.local/api/internal/tron"
	"testing"
)

func TestDepositPilotAuthorizationLimit(t *testing.T) {
	for _, cap := range []string{"0", "-1", "1.1", "1000001", "10000000000000000000000000000000", "01", ""} {
		p := DepositPilot{Customer: uuid.NewString(), Address: tron.FixtureAddress("test"), Cap: cap, Evidence: "synthetic:authorization"}
		if p.valid() {
			t.Fatal("invalid cap accepted", cap)
		}
	}
	p := DepositPilot{Customer: uuid.NewString(), Address: tron.FixtureAddress("test"), Cap: "1000000", Evidence: "synthetic:authorization"}
	if !p.valid() {
		t.Fatal("valid cap rejected")
	}
	p.Evidence = ""
	if p.valid() {
		t.Fatal("authorization missing")
	}
}

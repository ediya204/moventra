package issuing

import (
	"moventra.local/api/internal/ledger"
	"testing"
)

func TestOrderKeepsOriginalLedger(t *testing.T) {
	shared := &ledger.Service{Namespace: "live_fixture"}
	s := &Service{Funds: shared}
	old, err := s.forSnapshot(Snapshot{})
	if err != nil || old.Funds != nil || s.Funds != shared {
		t.Fatal("historical order rerouted or service mutated")
	}
	frozen := Snapshot{FundsNamespace: "live_fixture", FundsWalletID: "10000000-0000-4000-8000-000000000001"}
	current, err := s.forSnapshot(frozen)
	if err != nil || current.Funds != shared || current.ScopedWalletID != frozen.FundsWalletID {
		t.Fatal("frozen wallet missing")
	}
	frozen.FundsNamespace = "live_other"
	if _, err = s.forSnapshot(frozen); err == nil {
		t.Fatal("namespace change rerouted an existing order")
	}
	frozen.FundsNamespace = "live_fixture"
	frozen.FundsWalletID = ""
	if _, err = s.forSnapshot(frozen); err == nil {
		t.Fatal("missing original account accepted")
	}
}

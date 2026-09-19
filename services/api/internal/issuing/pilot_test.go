package issuing

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"testing"
	"time"
)

func TestPilotConfigFailsClosed(t *testing.T) {
	p := PilotAuthorization{CustomerID: "10000000-0000-4000-8000-000000000001", ProductID: "10000000-0000-4000-8000-000000000002", SupplierID: "10000000-0000-4000-8000-000000000003", OrderID: "10000000-0000-4000-8000-000000000004", BIN: "43612080", FundsNamespace: "live_fixture", FeeCapMinor: "1000", FundingMinor: "2000", TotalCapMinor: "3000", ExpiresAt: time.Now().Add(time.Hour), EvidenceRef: "synthetic", KeyEnv: "ISSUING_SLASH_KEY_TEST", Entity: "entity", Account: "account"}
	raw, _ := json.Marshal(p)
	if _, err := parsePilot(string(raw)); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*PilotAuthorization){"unbounded": func(p *PilotAuthorization) { p.TotalCapMinor = "3001" }, "funding": func(p *PilotAuthorization) { p.FundingMinor = "2001" }, "fee": func(p *PilotAuthorization) { p.FeeCapMinor = "1001" }, "customer": func(p *PilotAuthorization) { p.CustomerID = "" }, "order": func(p *PilotAuthorization) { p.OrderID = "" }, "namespace": func(p *PilotAuthorization) { p.FundsNamespace = "shadow_fixture" }, "evidence": func(p *PilotAuthorization) { p.EvidenceRef = "" }, "expiry": func(p *PilotAuthorization) { p.ExpiresAt = time.Time{} }, "key": func(p *PilotAuthorization) { p.KeyEnv = "SLASH_API_KEY" }} {
		t.Run(name, func(t *testing.T) {
			v := p
			change(&v)
			b, _ := json.Marshal(v)
			if _, err := parsePilot(string(b)); err == nil {
				t.Fatal("unsafe config accepted")
			}
		})
	}
	if _, err := parsePilot(string(raw) + " {}"); err == nil {
		t.Fatal("multiple documents")
	}
	if _, err := parsePilot(`{"unknown":true}`); err == nil {
		t.Fatal("unknown field")
	}
	for _, v := range []struct {
		fee, fund string
		want      bool
	}{{"1000", "2000", true}, {"0", "2000", true}, {"1001", "2000", false}, {"1000", "2001", false}, {"-1", "2000", false}} {
		if p.amountAllowed(v.fee, v.fund) != v.want {
			t.Fatal(v)
		}
	}
	t.Setenv("ISSUING_MODE", "pilot")
	t.Setenv("ISSUING_PILOT_CONFIG", string(raw))
	t.Setenv("ISSUING_BLNK_URL", "https://fixture:5443")
	t.Setenv("ISSUING_BLNK_KEY", "synthetic")
	t.Setenv("ISSUING_FUNDING_SOURCE", "")
	t.Setenv("BLNK_URL", "")
	t.Setenv("LEDGER_MODE", "")
	t.Setenv("ISSUING_BLNK_CA_PEM", "")
	db, err := pgxpool.New(context.Background(), "postgresql:///moventra?host=/tmp")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = FromEnv(db); err == nil {
		t.Fatal("pilot accepted dedicated wallet")
	}
	t.Setenv("ISSUING_FUNDING_SOURCE", "funds_wallet")
	t.Setenv("FUNDS_PRODUCTION_MODE", "enabled")
	t.Setenv("FUNDS_PRODUCTION_EVIDENCE", "synthetic")
	t.Setenv("DEPOSIT_PILOT_BLNK_URL", "https://fixture:5443")
	t.Setenv("DEPOSIT_PILOT_BLNK_KEY", "synthetic")
	t.Setenv("DEPOSIT_PILOT_BLNK_CA_PEM", "")
	t.Setenv("DEPOSIT_ADDRESS_NAMESPACE", "live_fixture")
	t.Setenv("ISSUING_CERTIFICATION_FILE", "")
	t.Setenv(p.KeyEnv, "")
	if _, err = FromEnv(db); err == nil {
		t.Fatal("missing supplier credential accepted")
	}
	t.Setenv(p.KeyEnv, "synthetic")
	svc, err := FromEnv(db)
	if err != nil {
		t.Fatal(err)
	}
	if svc.Mode != "pilot" || svc.Pilot == nil || !svc.Enabled || len(svc.Providers) != 1 || svc.PilotView("other") != nil || svc.ExecutionFor("other") {
		t.Fatal("incorrect capability scope")
	}
	t.Setenv("ISSUING_CERTIFICATION_FILE", "/nonexistent")
	if _, err = FromEnv(db); err == nil {
		t.Fatal("ambiguous certification accepted")
	}
	t.Setenv("ISSUING_MODE", "live")
	if _, err = FromEnv(db); err == nil {
		t.Fatal("pilot authorization bypassed live certification")
	}
}

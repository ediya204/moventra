package projection

import (
	"encoding/json"
	"testing"
)

func TestWhitelist(t *testing.T) {
	base := `{"connectionId":"conn","accountId":"acct","label":"Synthetic","sourceAt":"2026-09-07T00:00:00Z","records":[{"kind":"transaction","data":{"id":"tx","accountId":"acct","cardId":"card","amountCents":"-9007199254740993","merchantData":{"description":"Synthetic","location":{"city":"Town","zip":"001"}}}}]}`
	parse := func() Bundle {
		var b Bundle
		if e := json.Unmarshal([]byte(base), &b); e != nil {
			t.Fatal(e)
		}
		return b
	}
	if e := Validate(parse()); e != nil {
		t.Fatal(e)
	}
	for _, field := range []string{"pan", "cvv", "otp", "internal", "customerId"} {
		b := parse()
		b.Records[0].Data[field] = "not permitted"
		if Validate(b) == nil {
			t.Fatal(field)
		}
	}
	for _, value := range []any{float64(1), "1.2", "1e2", "-0"} {
		b := parse()
		b.Records[0].Data["amountCents"] = value
		if Validate(b) == nil {
			t.Fatal(value)
		}
	}
	b := parse()
	b.Records[0].Data["accountId"] = "other"
	if Validate(b) == nil {
		t.Fatal("scope")
	}
	b = parse()
	b.Records = append(b.Records, b.Records[0])
	if Validate(b) == nil {
		t.Fatal("duplicate")
	}
	b = parse()
	b.Records[0].Data["merchantData"].(map[string]any)["secret"] = "no"
	if Validate(b) == nil {
		t.Fatal("nested secret")
	}
}

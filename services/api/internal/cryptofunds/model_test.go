package cryptofunds

import "testing"

func TestExactQuotes(t *testing.T) {
	for _, c := range []struct{ amount, currency, rate, want string }{{"1000000", "USDT", "0.987", "98"}, {"100", "USD", "1.02", "1020000"}, {"9007199254740993", "USDT", "1", "900719925474"}, {"1234567", "USDT", "0.9999", "123"}} {
		v, e := Convert(c.amount, c.currency, c.rate)
		if e != nil || v != c.want {
			t.Fatalf("%+v: %s %v", c, v, e)
		}
	}
	for _, c := range []struct{ a, c, r string }{{"1", "USDT", "0.01"}, {"0", "USD", "1"}, {"01", "USD", "1"}, {"100", "BTC", "1"}, {"100", "USD", "1e9"}, {"100", "USD", "-1"}, {"100", "USD", "0"}} {
		if _, e := Convert(c.a, c.c, c.r); e == nil {
			t.Fatalf("accepted %+v", c)
		}
	}
}
func TestDecimalMinor(t *testing.T) {
	for _, v := range []string{"-1", "1e6", "1.0000001", "1..2", "+1", ""} {
		if _, e := DecimalMinor(v, 6); e == nil {
			t.Fatalf("accepted %q", v)
		}
	}
	v, e := DecimalMinor("9007199254.740993", 6)
	if e != nil || v != "9007199254740993" {
		t.Fatal(v, e)
	}
}

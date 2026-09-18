package messages

import (
	"strings"
	"testing"
	"time"
)

func TestSnapshotScopeAndExpiration(t *testing.T) {
	s := &Service{Namespace: "shadow_messages", Key: []byte(strings.Repeat("x", 32))}
	value := s.newToken("u", "c", "snapshot", "", 42)
	if n, e := s.parse(value, "u", "c", "snapshot", ""); e != nil || n != 42 {
		t.Fatal(n, e)
	}
	for _, scope := range [][4]string{{"other", "c", "snapshot", ""}, {"u", "other", "snapshot", ""}, {"u", "c", "cursor", ""}, {"u", "c", "snapshot", "changed"}} {
		if _, e := s.parse(value, scope[0], scope[1], scope[2], scope[3]); e == nil {
			t.Fatal("scope not checked")
		}
	}
	expired := s.sign(token{s.Namespace, "u", "c", "snapshot", 42, time.Now().Add(-time.Second).Unix(), ""})
	if _, e := s.parse(expired, "u", "c", "snapshot", ""); e == nil {
		t.Fatal("expired token")
	}
	s.Namespace = "other"
	if _, e := s.parse(value, "u", "c", "snapshot", ""); e == nil {
		t.Fatal("namespace not checked")
	}
}
func TestConfigurationFailsClosed(t *testing.T) {
	t.Setenv("MESSAGES_ENABLED", "")
	if svc, e := FromEnv(nil); svc != nil || e != nil {
		t.Fatal("enabled by default")
	}
	t.Setenv("MESSAGES_ENABLED", "true")
	t.Setenv("MESSAGES_NAMESPACE", "shadow_messages")
	t.Setenv("MESSAGES_TOKEN_KEY", "short")
	if _, e := FromEnv(nil); e == nil {
		t.Fatal("short secret accepted")
	}
	t.Setenv("MESSAGES_TOKEN_KEY", strings.Repeat("x", 32))
	t.Setenv("FUNDS_DISPLAY_MODE", "production")
	t.Setenv("DEPOSIT_ADDRESS_NAMESPACE", "live_funds")
	if _, e := FromEnv(nil); e == nil {
		t.Fatal("mixed production namespace")
	}
	t.Setenv("MESSAGES_NAMESPACE", "live_funds")
	if svc, e := FromEnv(nil); e != nil || svc == nil {
		t.Fatal("valid config", e)
	}
}

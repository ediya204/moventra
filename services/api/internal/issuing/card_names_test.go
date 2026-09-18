package issuing

import "testing"

func TestCardNamePool(t *testing.T) {
	if len(cardNames) != 100 {
		t.Fatalf("expected 100 names, got %d", len(cardNames))
	}
	seen := map[string]bool{}
	for _, name := range cardNames {
		if seen[name] || !textOK(name, 120) {
			t.Fatalf("invalid/duplicate name %q", name)
		}
		seen[name] = true
	}
	for i := 0; i < 300; i++ {
		name, err := randomCardName()
		if err != nil || !seen[name] {
			t.Fatalf("name outside pool: %q %v", name, err)
		}
	}
}

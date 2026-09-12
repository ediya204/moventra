package api

import (
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Registration creates only a login user, never business subjects or grants.
// UID comes exclusively from the verified token; passwords stay in Firebase.
func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		fail(w, 401, "unauthenticated")
		return
	}
	identity, err := s.Verifier.Verify(r.Context(), parts[1])
	if err != nil || identity.UID == "" {
		fail(w, 401, "unauthenticated")
		return
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		fail(w, 415, "invalid_content_type")
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil {
		fail(w, 400, "invalid_registration")
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		fail(w, 400, "invalid_registration")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if !utf8.ValidString(input.Name) || utf8.RuneCountInString(input.Name) < 1 || utf8.RuneCountInString(input.Name) > 80 {
		fail(w, 400, "invalid_registration")
		return
	}
	// The unique Firebase UID makes retries/concurrent submissions idempotent.
	// DO NOTHING preserves disabled users and all existing profile/authorization data.
	_, err = s.DB.Exec(r.Context(), `INSERT INTO users(id,firebase_uid,display_name,status) VALUES($1,$2,$3,'active') ON CONFLICT(firebase_uid) DO NOTHING`, uuid.NewString(), identity.UID, input.Name)
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	var id, status, role string
	err = s.DB.QueryRow(r.Context(), `SELECT id::text,status,role FROM users WHERE firebase_uid=$1`, identity.UID).Scan(&id, &status, &role)
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if status != "active" {
		fail(w, 403, "user_disabled")
		return
	}
	if role != "customer" {
		fail(w, 403, "customer_required")
		return
	}
	respond(w, 200, map[string]any{"data": map[string]string{"id": id}})
}

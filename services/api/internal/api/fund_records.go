package api

import (
	"encoding/json"
	"moventra.local/api/internal/fundrecords"
	"moventra.local/api/internal/issuing"
	"net/http"
	"os"
	"strings"
)

func (s *Server) fundRecordRoutes(mux *http.ServeMux) {
	for _, surface := range []string{"client", "admin"} {
		for _, suffix := range []string{"", "/{recordID}"} {
			mux.Handle("GET /"+surface+"-api/v1/fund-records"+suffix, s.authenticate(http.HandlerFunc(s.fundRecordAPI)))
		}
	}
}
func (s *Server) fundRecordAPI(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	admin := strings.HasPrefix(r.URL.Path, "/admin-api/")
	if admin && !p.Identity.MFA {
		fail(w, 403, "mfa_required")
		return
	}
	q, err := fundrecords.Parse(r.URL.Query(), r.PathValue("recordID"))
	if err != nil {
		fail(w, 400, "invalid_query")
		return
	}
	svc, err := s.fundsReadService()
	if err != nil || svc == nil || svc.Ledger == nil {
		fail(w, 503, "fund_records_unavailable")
		return
	}
	if os.Getenv("FUNDS_DISPLAY_MODE") == "production" && !svc.Ledger.IsLive() {
		fail(w, 503, "fund_records_unavailable")
		return
	}
	dedicated := s.Issuing != nil && ((svc.Ledger.IsLive() && (s.Issuing.Mode == "live" || s.Issuing.Mode == "prepare" || s.Issuing.Mode == "pilot")) || (!svc.Ledger.IsLive() && s.Issuing.Mode == "isolated"))
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "fund_records_unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	raw, err := fundrecords.Query(r.Context(), tx, p.ID, admin, svc.NS(), dedicated, q)
	if err != nil {
		fail(w, 503, "fund_records_unavailable")
		return
	}
	var page struct {
		Total   int               `json:"total"`
		Records []json.RawMessage `json:"records"`
	}
	if json.Unmarshal(raw, &page) != nil {
		fail(w, 503, "fund_records_unavailable")
		return
	}
	out := map[string]any{"records": page.Records, "total": page.Total, "mode": svc.Mode(), "pageSize": 20, "coverage": "当前服务已保存且有权访问的非消费业务记录"}
	resource := "list"
	if q["id"] != "" {
		if len(page.Records) != 1 {
			fail(w, 404, "not_found")
			return
		}
		var record struct {
			CustomerID    string `json:"customerId"`
			Source        string `json:"source"`
			OrderID       string `json:"orderId"`
			FundingSource string `json:"fundingSource"`
		}
		if json.Unmarshal(page.Records[0], &record) != nil {
			fail(w, 503, "fund_records_unavailable")
			return
		}
		evidence, e := fundrecords.Evidence(r.Context(), tx, svc.NS(), record.CustomerID, record.Source, record.OrderID, record.FundingSource == "issuing_wallet")
		if e != nil {
			fail(w, 503, "fund_records_unavailable")
			return
		}
		var rows []json.RawMessage
		if json.Unmarshal(evidence, &rows) != nil || len(rows) > 100 {
			fail(w, 503, "evidence_capacity_exceeded")
			return
		}
		out["record"], out["evidence"] = page.Records[0], rows
		resource = q["id"]
	}
	// Audit must commit before returning any customer data. Do not log search text,
	// addresses or arbitrary source payloads.
	err = issuing.Audit(r.Context(), tx, p.ID, "", resource, "fund-records.read", map[string]any{"admin": admin, "count": len(page.Records), "namespace": svc.NS()})
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		fail(w, 503, "fund_records_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	respond(w, 200, map[string]any{"data": out})
}

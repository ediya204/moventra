package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"strings"
	"testing"
)

func TestTLSProxyPreservesAuthenticationAndUsesLoopback(t *testing.T) {
	fixture := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer fixture.Close()
	certificate := fixture.TLS.Certificates[0]
	cert := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate.Certificate[0]})
	key, err := marshalKey(certificate)
	if err != nil {
		t.Fatal(err)
	}
	server, err := tlsServer(string(cert), string(key))
	if err != nil {
		t.Fatal(err)
	}
	if server.TLSConfig.MinVersion != tls.VersionTLS12 || server.TLSConfig.InsecureSkipVerify {
		t.Fatal("invalid TLS policy")
	}
	// A real local HTTP backend exercises request authentication and forwarding.
	backend := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-blnk-key") != "fixture" {
			w.WriteHeader(401)
			return
		}
		if r.URL.Path != "/ledgers/general_ledger_id" || r.Method != "GET" {
			t.Error("request changed")
		}
		_, _ = w.Write([]byte(`{"ledger_id":"general_ledger_id"}`))
	}))
	// Use a dynamic loopback port in tests; the production constructor remains fixed.
	backend.Start()
	defer backend.Close()
	proxy := server.Handler.(*httputil.ReverseProxy)
	original := proxy.Director
	proxy.Director = func(r *http.Request) {
		original(r)
		if r.URL.Host != "127.0.0.1:5001" {
			t.Error("nonloopback upstream")
		}
		r.URL.Host = strings.TrimPrefix(backend.URL, "http://")
	}
	front := httptest.NewUnstartedServer(server.Handler)
	front.TLS = server.TLSConfig
	front.StartTLS()
	defer front.Close()
	for _, key := range []string{"", "fixture"} {
		req, _ := http.NewRequest("GET", front.URL+"/ledgers/general_ledger_id", nil)
		req.Header.Set("X-blnk-key", key)
		resp, e := front.Client().Do(req)
		if e != nil {
			t.Fatal(e)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		want := 401
		if key != "" {
			want = 200
		}
		if resp.StatusCode != want {
			t.Fatalf("status %d", resp.StatusCode)
		}
		if key != "" && !strings.Contains(string(body), "general_ledger_id") {
			t.Fatal("body changed")
		}
	}
	if _, err = tlsServer("bad", "bad"); err == nil {
		t.Fatal("bad certificate accepted")
	}
}

func marshalKey(c tls.Certificate) ([]byte, error) {
	der, err := x509.MarshalPKCS8PrivateKey(c.PrivateKey)
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), nil
}

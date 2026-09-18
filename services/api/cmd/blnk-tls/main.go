// blnk-tls supervises the pinned Blnk process and terminates TLS in the same
// container. Plaintext proxy traffic never leaves loopback.
package main

import (
	"context"
	"crypto/tls"
	"errors"
	"io"
	"log"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"
)

func tlsServer(certPEM, keyPEM string) (*http.Server, error) {
	cert, err := tls.X509KeyPair([]byte(certPEM), []byte(keyPEM))
	if err != nil {
		return nil, errors.New("invalid_ledger_tls_certificate")
	}
	upstream, _ := url.Parse("http://127.0.0.1:5001")
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.ResponseHeaderTimeout = 15 * time.Second
	proxy.Transport = transport
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(w, "ledger_unavailable", http.StatusBadGateway)
	}
	return &http.Server{
		Addr: ":5443", Handler: proxy,
		TLSConfig:         &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{cert}},
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second,
		WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384,
		ErrorLog: log.New(io.Discard, "", 0),
	}, nil
}

func run() error {
	if os.Getenv("BLNK_SERVER_SECURE") != "true" || os.Getenv("BLNK_SERVER_SECRET_KEY") == "" || os.Getenv("BLNK_SERVER_PORT") != "5001" || os.Getenv("BLNK_SERVER_SSL") == "true" {
		return errors.New("invalid_ledger_backend_configuration")
	}
	server, err := tlsServer(os.Getenv("BLNK_TLS_CERT_PEM"), os.Getenv("BLNK_TLS_KEY_PEM"))
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	child := exec.Command("/usr/local/bin/blnk", "start")
	// Existing Blnk logs stay on the platform; the proxy never logs request bodies.
	child.Stdout, child.Stderr = os.Stdout, os.Stderr
	if err = child.Start(); err != nil {
		return errors.New("ledger_start_failed")
	}
	childDone := make(chan error, 1)
	go func() { childDone <- child.Wait() }()
	serverDone := make(chan error, 1)
	go func() { serverDone <- server.ListenAndServeTLS("", "") }()
	slog.Info("private ledger TLS listener starting", "port", 5443)
	childExited := false
	select {
	case <-ctx.Done():
	case <-childDone:
		childExited = true
		err = errors.New("ledger_process_stopped")
	case <-serverDone:
		err = errors.New("ledger_tls_listener_stopped")
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
	if !childExited {
		_ = child.Process.Signal(syscall.SIGTERM)
		select {
		case <-childDone:
		case <-time.After(15 * time.Second):
			_ = child.Process.Kill()
			<-childDone
		}
	}
	return err
}

func main() {
	if run() != nil {
		slog.Error("private ledger TLS process stopped; inspect configuration and backend health")
		os.Exit(1)
	}
}

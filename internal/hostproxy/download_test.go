package hostproxy

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHostDownloadRedirectProgressAndAccept(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") != "application/octet-stream" {
			t.Error("GitHub asset Accept header lost")
		}
		if r.URL.Path == "/release" {
			http.Redirect(w, r, "/asset", http.StatusFound)
			return
		}
		io.WriteString(w, "verified by caller")
	}))
	defer server.Close()
	file := filepath.Join(t.TempDir(), "archive")
	var output bytes.Buffer
	if err := downloadOnce(t.Context(), server.Client(), server.URL+"/release", file, "macos-cli-uv.tar.gz", "application/octet-stream", &output, time.Second); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(file)
	if string(got) != "verified by caller" || !strings.Contains(output.String(), "CAGE_HOST_BYTES macos-cli-uv.tar.gz 18 18") {
		t.Fatalf("body=%q progress=%s", got, &output)
	}
}

func TestHostDownloadStallAndCancellation(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	start := time.Now()
	err := downloadOnce(ctx, server.Client(), server.URL, filepath.Join(t.TempDir(), "archive"), "chrome.dmg", "", io.Discard, 30*time.Millisecond)
	if err == nil || time.Since(start) >= time.Second {
		t.Fatalf("stalled body did not stop promptly: %v", err)
	}
	cancel()
	if err := Download(ctx, server.URL, filepath.Join(t.TempDir(), "archive"), "chrome.dmg", "", io.Discard); err != context.Canceled {
		t.Fatalf("cancellation was not preserved: %v", err)
	}
}

func TestHostDownloadRejectsPlainHTTP(t *testing.T) {
	if err := downloadOnce(t.Context(), http.DefaultClient, "http://example.invalid/archive", filepath.Join(t.TempDir(), "archive"), "chrome.dmg", "", io.Discard, time.Second); err == nil {
		t.Fatal("unencrypted host download accepted")
	}
}

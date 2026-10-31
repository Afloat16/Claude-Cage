package managedproxy

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"
)

const testNodes = `mixed-port: 7890
external-controller: 0.0.0.0:9090
tun: {enable: true}
rules: [MATCH,DIRECT]
proxies:
  - {name: edge, type: socks5, server: 127.0.0.1, port: 1080, password: private-secret}
  - {name: chained, type: http, server: 127.0.0.1, port: 8080, dialer-proxy: edge}
`

func TestImportCompilesOnlyOwnedNetworkBoundary(t *testing.T) {
	s, err := Load(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Import("test", "", []byte(testNodes), "source", 0, ""); err != nil {
		t.Fatal(err)
	}
	s.Selected = s.Sources[0].Nodes[1].ID
	b, err := s.Runtime("/tmp/qa")
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if yaml.Unmarshal(b, &config) != nil {
		t.Fatal("invalid runtime")
	}
	if config["mixed-port"] != 17896 || config["allow-lan"] != false || config["ipv6"] != false || config["external-controller"] != nil {
		t.Fatalf("import changed boundary: %v", config)
	}
	if !strings.Contains(string(b), "MATCH,CAGE") || strings.Contains(string(b), "DIRECT") || strings.Contains(string(b), "enable: true\nproxies:") {
		t.Fatal("unsafe imported routing")
	}
	if config["tun"].(map[string]any)["enable"] != false {
		t.Fatal("TUN enabled")
	}
	if s.Sources[0].Nodes[1].Config["dialer-proxy"] != s.Sources[0].Nodes[0].ID {
		t.Fatal("chain not namespaced")
	}
	profile := t.TempDir()
	if err = s.Save(profile); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(filepath.Join(Dir(profile), "sources.json"))
	if info.Mode().Perm() != 0600 {
		t.Fatal("source credentials not private")
	}
	loaded, err := Load(profile)
	if err != nil || loaded.Endpoint() != s.Endpoint() {
		t.Fatal("credentials not stable")
	}
}
func TestImportRejectsFilesDirectAndCycles(t *testing.T) {
	for _, nodes := range []string{
		`proxies: [{name: test, type: http, server: example.com, port: 80, interface-name: en0}]`,
		`proxies: [{name: test, type: socks5, server: example.com, port: 80, dialer-proxy: DIRECT}]`,
		`proxies: [{name: test, type: socks5, server: example.com, port: 80, dialer-proxy: test}]`,
		`proxies: [{name: test, type: http, server: example.com, port: 80, ws-opts: {private-key: /etc/passwd}}]`,
		`proxies: [{name: duplicate, type: http, server: a, port: 80}, {name: duplicate, type: http, server: b, port: 80}]`,
	} {
		if _, err := Parse([]byte(nodes), "test"); err == nil {
			t.Fatal("unsafe import accepted")
		}
	}
}

func TestAnyTLSIdleSessionOptionsRemainCompatible(t *testing.T) {
	_, err := Parse([]byte(`proxies: [{name: qa, type: anytls, server: example.com, port: 443, password: secret, idle-session-check-interval: 30, idle-session-timeout: 30, min-idle-session: 0}]`), "source")
	if err != nil {
		t.Fatal(err)
	}
}
func TestRefreshIdentityAndInvalidUpdatePreserveNodes(t *testing.T) {
	s, _ := Load(t.TempDir())
	if err := s.Import("test", "https://example.com/sub?secret=x", []byte(testNodes), "source", 24, ""); err != nil {
		t.Fatal(err)
	}
	id := s.Sources[0].Nodes[0].ID
	if err := s.Import("test", "", []byte("not: a subscription"), "source", 24, ""); err == nil {
		t.Fatal("bad source accepted")
	}
	if s.Sources[0].Nodes[0].ID != id {
		t.Fatal("failed update lost nodes")
	}
	if err := s.Import("test", "", []byte(testNodes), "source", 24, ""); err != nil || s.Sources[0].Nodes[0].ID != id {
		t.Fatal("refresh changed node identity")
	}
	other, _ := Parse([]byte(testNodes), "other")
	if other[0].ID == id {
		t.Fatal("sources collide")
	}
}
func TestSubscriptionFetchAndMetadata(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.UserAgent() != "clash.meta/Cage" {
			t.Error("incorrect subscription user agent")
		}
		w.Header().Set("Subscription-Userinfo", "upload=2; download=3; total=100; expire=123; secret=credential")
		io.WriteString(w, testNodes)
	}))
	defer server.Close()
	data, usage, err := Fetch(context.Background(), server.Client(), server.URL)
	if err != nil || string(data) != testNodes || usage != "upload=2; download=3; total=100; expire=123" {
		t.Fatalf("fetch: %s %v", usage, err)
	}
	if _, _, err = Fetch(context.Background(), server.Client(), "http://example.com"); err == nil {
		t.Fatal("insecure subscription accepted")
	}
}
func TestBootstrapDoesNotAllowPrivateDestinations(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "::1"} {
		if publicIP(netip.MustParseAddr(ip)) {
			t.Fatal("infrastructure private destination allowed")
		}
	}
}

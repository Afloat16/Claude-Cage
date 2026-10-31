package workbench

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sylvinus/agent-vm/internal/managedproxy"
)

func TestFailedSubscriptionRefreshKeepsWorkingNodesAndSecretsPrivate(t *testing.T) {
	s := testServer(t)
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(502) }))
	defer proxy.Close()
	cfg, err := loadConfig(s.configPath)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ProxyURL = proxy.URL
	if err = writePrivate(s.configPath, cfg); err != nil {
		t.Fatal(err)
	}
	p, _ := managedproxy.Load(s.profile)
	if err = p.Import("source", "https://example.com/sub?token=private-subscription", []byte(`proxies: [{name: qa, type: socks5, server: 127.0.0.1, port: 1080, password: private-node-password}]`), "source", 24, ""); err != nil {
		t.Fatal(err)
	}
	p.Selected = p.Sources[0].Nodes[0].ID
	if err = p.Save(s.profile); err != nil {
		t.Fatal(err)
	}
	before := p.Sources[0]
	if err = s.changeProxy("refresh", proxyInput{ID: "source"}); err == nil {
		t.Fatal("broken subscription accepted")
	}
	after, err := managedproxy.Load(s.profile)
	if err != nil {
		t.Fatal(err)
	}
	if after.Sources[0].Nodes[0].ID != before.Nodes[0].ID || after.Selected != p.Selected || !after.Sources[0].Updated.Equal(before.Updated) || after.Sources[0].Error == "" {
		t.Fatal("failed refresh replaced last good data")
	}
	w := request(s, "GET", "/api/proxy", s.origin, "", true)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, secret := range []string{"private-subscription", "private-node-password", p.Auth} {
		if strings.Contains(w.Body.String(), secret) {
			t.Fatal("status leaked proxy credentials")
		}
	}
	if w = request(s, "POST", "/api/proxy/stop", s.origin, `{}`, false); w.Code != 401 {
		t.Fatal("proxy mutation accepted without authentication")
	}
}

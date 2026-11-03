package workbench

import "testing"

func TestClaudeDesktopControlBoundary(t *testing.T) {
	s := testServer(t)
	for _, path := range []string{"/api/claude-desktop/install", "/api/claude-desktop/start", "/api/claude-desktop/stop"} {
		if w := request(s, "POST", path, s.origin, "{}", false); w.Code != 401 {
			t.Fatalf("%s without session: %d", path, w.Code)
		}
		if w := request(s, "POST", path, "https://claude.ai", "{}", true); w.Code != 403 {
			t.Fatalf("%s cross-origin: %d", path, w.Code)
		}
		if w := request(s, "POST", path, s.origin, `{"command":"touch /tmp/untrusted"}`, true); w.Code != 400 {
			t.Fatalf("%s accepted arbitrary command: %d", path, w.Code)
		}
		if w := request(s, "POST", path, s.origin, "{}", true); w.Code != 409 {
			t.Fatalf("%s must require running VM: %d", path, w.Code)
		}
	}
	for _, body := range []string{`{"width":1,"height":1000}`, `{"width":8193,"height":1000}`, `{"width":1000,"height":8193}`, `{"width":"1024;command","height":768}`} {
		if w := request(s, "POST", "/api/claude-desktop/resize", s.origin, body, true); w.Code != 400 {
			t.Fatalf("invalid geometry: %d", w.Code)
		}
	}
}

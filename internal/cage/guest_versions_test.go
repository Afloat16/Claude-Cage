package cage

import (
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
)

func TestGuestManifestIsPublishedOnlyAfterSuccessfulServiceStart(t *testing.T) {
	for _, body := range []string{"printf started; exit 0", "printf broken; exit 7"} {
		t.Run(body, func(t *testing.T) {
			dir := t.TempDir()
			marker := filepath.Join(dir, "published")
			// Observe privileged actions without touching the host's /etc or running services.
			sudo := `#!/bin/sh
case "$1" in
 rm) rm -f "$AUDIT_MARKER";;
 python3) cat >/dev/null; printf published > "$AUDIT_MARKER";;
 *) exit 91;;
esac
`
			if err := os.WriteFile(filepath.Join(dir, "sudo"), []byte(sudo), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(marker, []byte("old"), 0600); err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command("bash", "-c", markGuestStart(body))
			cmd.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"), "AUDIT_MARKER="+marker)
			_, err := cmd.CombinedOutput()
			data, readErr := os.ReadFile(marker)
			if strings.Contains(body, "exit 0") {
				if err != nil || readErr != nil || string(data) != "published" {
					t.Fatal("successful startup did not publish manifest", err, readErr)
				}
			} else if err == nil || !os.IsNotExist(readErr) {
				t.Fatal("failed startup retained or published a manifest", err, readErr)
			}
		})
	}
}

func TestToolDownloadWithRealCurlAndTLS(t *testing.T) {
	if _, err := exec.LookPath("curl"); err != nil {
		t.Skip("curl unavailable")
	}
	dir := t.TempDir()
	if _, err := exec.LookPath("sha256sum"); err != nil || runtime.GOOS == "darwin" {
		if _, err := exec.LookPath("shasum"); err != nil {
			t.Skip("SHA-256 tool unavailable")
		}
		if err := os.WriteFile(filepath.Join(dir, "sha256sum"), []byte("#!/bin/sh\nexec shasum -a 256 \"$@\"\n"), 0755); err != nil {
			t.Fatal(err)
		}
	}
	data := "complete download bytes"
	var calls atomic.Int32
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Content-Length", fmt.Sprint(len(data)))
			fmt.Fprint(w, data[:5])
			return
		}
		if r.Header.Get("Range") != "bytes=5-" {
			t.Errorf("range: %q", r.Header.Get("Range"))
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 5-%d/%d", len(data)-1, len(data)))
		w.WriteHeader(206)
		fmt.Fprint(w, data[5:])
	}))
	defer s.Close()
	ca := filepath.Join(dir, "ca.pem")
	if err := os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: s.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(data))
	cmd := exec.Command("bash", "-c", "set -euo pipefail\n"+ToolInstallPrelude()+`cage_download_tool "$DOWNLOAD_URL" "$DOWNLOAD_HASH" "$HOME/package"
cage_download_tool "$DOWNLOAD_URL" "$DOWNLOAD_HASH" "$HOME/package"`)
	cmd.Env = append(os.Environ(), "HOME="+dir, "PATH="+dir+":"+os.Getenv("PATH"), "CURL_CA_BUNDLE="+ca, "DOWNLOAD_URL="+s.URL, fmt.Sprintf("DOWNLOAD_HASH=%x", hash), "NO_PROXY=127.0.0.1", "no_proxy=127.0.0.1")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v %s", err, out)
	}
	got, err := os.ReadFile(filepath.Join(dir, "package"))
	if err != nil || string(got) != data || calls.Load() != 2 {
		t.Fatalf("%q %v calls=%d", got, err, calls.Load())
	}
}

func TestClaudeNativeCacheUsesGuestArchitectureAndIntegrity(t *testing.T) {
	if _, err := exec.LookPath("jq"); err != nil {
		t.Skip("jq unavailable")
	}
	for _, arch := range []string{"arm64", "amd64"} {
		t.Run(arch, func(t *testing.T) {
			dir := t.TempDir()
			hash := sha512.Sum512([]byte("native-package"))
			packageName := "claude-code-linux-arm64"
			if arch == "amd64" {
				packageName = "claude-code-linux-x64"
			}
			commands := map[string]string{
				"dpkg":   "#!/bin/sh\nif [ \"$1\" = --print-architecture ]; then echo \"$TEST_ARCH\"; else exit 1; fi\n",
				"claude": "#!/bin/sh\necho 1.0.0\n",
				"flock":  "#!/bin/sh\nexit 0\n",
				"curl":   "#!/bin/sh\nwhile [ \"$#\" -gt 0 ]; do if [ \"$1\" = -o ]; then shift; printf native-package > \"$1\"; printf 200; exit; fi; shift; done\nexit 1\n",
				"npm": `#!/bin/sh
case "$1" in
view)
  test "$3" = "@anthropic-ai/$TEST_PACKAGE@2.1.314" || exit 91
  printf '{"integrity":"sha512-%s","tarball":"https://registry.npmjs.org/%s.tgz"}' "$TEST_INTEGRITY" "$TEST_PACKAGE";;
cache)
  test "$2 $3 $4" = 'add --offline --ignore-scripts' || exit 92
  test "$(cat "$5")" = native-package || exit 93
  printf cached > "$HOME/cached";;
install)
  test -f "$HOME/cached" || exit 94
  printf installed > "$HOME/installed";;
*) exit 95;;
esac
`,
			}
			if _, err := exec.LookPath("sha512sum"); err != nil || runtime.GOOS == "darwin" {
				if _, err := exec.LookPath("shasum"); err != nil {
					t.Skip("SHA-512 tool unavailable")
				}
				commands["sha512sum"] = "#!/bin/sh\nexec shasum -a 512 \"$@\"\n"
			}
			for name, body := range commands {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0755); err != nil {
					t.Fatal(err)
				}
			}
			cmd := exec.Command("bash", "-c", ToolInstallPrelude()+"cage_install_tool claude")
			cmd.Env = append(os.Environ(), "HOME="+dir, "PATH="+dir+":"+os.Getenv("PATH"), "TEST_ARCH="+arch, "TEST_PACKAGE="+packageName, "TEST_INTEGRITY="+base64.StdEncoding.EncodeToString(hash[:]))
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("%v %s", err, out)
			}
			if _, err := os.Stat(filepath.Join(dir, "installed")); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestGeneratedGuestScriptsParseAsBash(t *testing.T) {
	for name, script := range map[string]string{"start": DefaultConfig().StartScript(), "tools": ToolsUpdateScript(), "first-install-functions": ToolInstallPrelude()} {
		t.Run(name, func(t *testing.T) {
			cmd := exec.Command("bash", "-n")
			cmd.Stdin = strings.NewReader(script)
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("%v: %s", err, out)
			}
		})
	}
}

func TestPinnedToolInstallerRejectsWrongHashBeforeInstalling(t *testing.T) {
	dir := t.TempDir()
	commands := map[string]string{
		"flock":       "#!/bin/sh\nexit 0\n",
		"dpkg":        "#!/bin/sh\nif [ \"$1\" = --print-architecture ]; then echo arm64; else exit 1; fi\n",
		"code-server": "#!/bin/sh\necho 1.0.0\n",
		"curl":        "#!/bin/sh\nwhile [ \"$#\" -gt 0 ]; do if [ \"$1\" = -o ]; then shift; printf altered-package > \"$1\"; exit; fi; shift; done\nexit 1\n",
		"sha256sum":   "#!/bin/sh\ncat >/dev/null\nexit 1\n",
		"sudo":        "#!/bin/sh\nprintf attempted > \"$AUDIT_INSTALL\"\nexit 0\n",
	}
	for name, content := range commands {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0755); err != nil {
			t.Fatal(err)
		}
	}
	installed := filepath.Join(dir, "installed")
	cmd := exec.Command("bash", "-c", ToolInstallPrelude()+"\ncage_install_tool code-server")
	cmd.Env = append(os.Environ(), "HOME="+dir, "PATH="+dir+":"+os.Getenv("PATH"), "AUDIT_INSTALL="+installed)
	out, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "checksum mismatch") {
		t.Fatalf("changed download accepted: %v %s", err, out)
	}
	if _, err := os.Stat(installed); !os.IsNotExist(err) {
		t.Fatal("installer ran before verifying the artifact")
	}
}

func TestPinnedToolVersionIgnoresFirstRunNotices(t *testing.T) {
	for _, version := range []string{"4.144.0", "v4.144.1", "4.144.0-rc.1"} {
		t.Run(version, func(t *testing.T) {
			dir := t.TempDir()
			commands := map[string]string{
				"code-server": "#!/bin/sh\nprintf '%s\\n' '[2026-11-05T14:58:49.600Z] info Wrote default config file' '" + version + " commit with Code 1.144.0'\n",
				"dpkg":        "#!/bin/sh\nif [ \"$1\" = --print-architecture ]; then echo arm64; else test \"$2\" = \"${EXPECTED_VERSION#v}\"; fi\n",
				"curl":        "#!/bin/sh\necho unexpected-download >&2\nexit 90\n",
			}
			for name, body := range commands {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0755); err != nil {
					t.Fatal(err)
				}
			}
			cmd := exec.Command("bash", "-c", ToolInstallPrelude()+"\ncage_install_tool code-server")
			cmd.Env = append(os.Environ(), "HOME="+dir, "PATH="+dir+":"+os.Getenv("PATH"), "EXPECTED_VERSION="+version)
			out, err := cmd.CombinedOutput()
			if err != nil || !strings.Contains(string(out), "already meets") {
				t.Fatalf("%v: %s", err, out)
			}
		})
	}
}

func TestToolDownloadKeepsPartialAndResumes(t *testing.T) {
	dir := t.TempDir()
	commands := map[string]string{
		"sleep": "#!/bin/sh\nexit 0\n",
		"curl": `#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in -o) shift; artifact="$1";; --continue-at) shift; test "$1" = - || exit 99;; esac
  shift
done
if [ ! -f "$HOME/recover" ]; then
  printf partial > "$artifact"
  exit 56
fi
test "$(cat "$artifact")" = partial || exit 98
printf complete > "$artifact"
printf 206
`,
		"sha256sum": "#!/bin/sh\nread checksum artifact\ntest \"$(cat \"$artifact\")\" = complete\n",
	}
	for name, body := range commands {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0755); err != nil {
			t.Fatal(err)
		}
	}
	run := func() ([]byte, error) {
		cmd := exec.Command("bash", "-c", ToolInstallPrelude()+`cage_download_tool https://example.invalid/tool pinned "$HOME/package"`)
		cmd.Env = append(os.Environ(), "HOME="+dir, "PATH="+dir+":"+os.Getenv("PATH"))
		return cmd.CombinedOutput()
	}
	if out, err := run(); err == nil || !strings.Contains(string(out), "partial data is saved") {
		t.Fatalf("%v %s", err, out)
	}
	if data, err := os.ReadFile(filepath.Join(dir, "package.part")); err != nil || string(data) != "partial" {
		t.Fatal("partial lost", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "recover"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	if out, err := run(); err != nil {
		t.Fatalf("%v %s", err, out)
	}
	if data, err := os.ReadFile(filepath.Join(dir, "package")); err != nil || string(data) != "complete" {
		t.Fatal("not published", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "package.part")); !os.IsNotExist(err) {
		t.Fatal("partial left after success")
	}
}

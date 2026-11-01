package cage

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
	cmd.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"), "AUDIT_INSTALL="+installed)
	out, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "checksum mismatch") {
		t.Fatalf("changed download accepted: %v %s", err, out)
	}
	if _, err := os.Stat(installed); !os.IsNotExist(err) {
		t.Fatal("installer ran before verifying the artifact")
	}
}

package guestos

import (
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Run both real shell entry points, including concurrent CLI downloads and the
// GitHub asset fallback. A host helper path with spaces must remain one command.
func TestMacMediaUsesHostDownloaderForEveryPackage(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("bash unavailable")
	}
	dir := t.TempDir()
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte("fixture")))
	for _, name := range []string{"prepare-macos-media.sh", "prepare-macos-cli-kit.sh"} {
		data, err := os.ReadFile(filepath.Join("..", "..", "scripts", "guest-os", name))
		if err != nil {
			t.Fatal(err)
		}
		data = regexp.MustCompile(`[a-f0-9]{64}`).ReplaceAll(data, []byte(digest))
		if err := os.WriteFile(filepath.Join(dir, name), data, 0700); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"macos-cli.py", "install-macos-cli.sh", "claude-account.py", "cli_channel.py", "cli_channel.resume.md", "claude_account_resume.md"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	helper := filepath.Join(dir, "Cage helper")
	body := `#!/bin/sh
set -eu
test "$1" = host-download
printf '%s %s %s\n' "$2" "$4" "${5:-}" >> "$FIXTURE_DOWNLOADS"
case "$2" in https://github.com/*) exit 1;; esac
case "$2" in https://api.github.com/*) test "$5" = application/octet-stream;; esac
printf fixture > "$3"
printf 'CAGE_HOST_BYTES %s 7 7\n' "$4"
`
	if err := os.WriteFile(helper, []byte(body), 0700); err != nil {
		t.Fatal(err)
	}
	media := filepath.Join(dir, "media")
	cmd := exec.CommandContext(t.Context(), "bash", filepath.Join(dir, "prepare-macos-media.sh"), media)
	cmd.Env = append(os.Environ(), "CAGE_HOST_DOWNLOADER="+helper, "CAGE_REFRESH_TOOLS=1", "FIXTURE_DOWNLOADS="+filepath.Join(dir, "requests"))
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%v\n%s", err, output)
	}
	requests, _ := os.ReadFile(filepath.Join(dir, "requests"))
	for _, name := range []string{"editor.tgz", "playwright.tgz", "node.tgz", "chrome.dmg", "macos-cli-claude", "macos-cli-uv.tar.gz", "macos-cli-python.tar.gz", "macos-cli-git.tar.gz"} {
		if !strings.Contains(string(requests), " "+name+" ") || !strings.Contains(string(output), "CAGE_HOST_BYTES "+name+" 7 7") {
			t.Fatalf("component bypassed host download helper: %s\n%s", name, requests)
		}
	}
	for _, name := range []string{"claude", "uv.tar.gz", "python.tar.gz", "git.tar.gz"} {
		data, err := os.ReadFile(filepath.Join(media, "cli", name))
		if err != nil || string(data) != "fixture" {
			t.Fatalf("CLI kit not published: %s %v", name, err)
		}
	}
}

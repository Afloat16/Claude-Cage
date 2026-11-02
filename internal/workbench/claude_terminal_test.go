package workbench

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/sylvinus/agent-vm/internal/cage"
)

func TestClaudeTerminalRunsSavedCommandOnceAndReturnsToShell(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("guest Bash integration runs on Unix")
	}
	dir := filepath.Join(t.TempDir(), "project with ' quotes")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	command := `printf '%s\n' 'argument with spaces; $(not-executed)' >> command-result`
	cmd := exec.Command("bash", "-c", terminalScript(dir, "claude", command))
	cmd.Env = append(os.Environ(), "HOME="+t.TempDir())
	cmd.Stdin = strings.NewReader("printf shell-returned > shell-result\nexit\n")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	b, err := os.ReadFile(filepath.Join(dir, "command-result"))
	if err != nil || string(b) != "argument with spaces; $(not-executed)\n" {
		t.Fatalf("startup command quoting/repetition: %q, %v", b, err)
	}
	b, err = os.ReadFile(filepath.Join(dir, "shell-result"))
	if err != nil || string(b) != "shell-returned" {
		t.Fatalf("terminal did not return to shell: %q, %v", b, err)
	}
}

func TestClaudeTerminalPreferenceValidationAndPersistence(t *testing.T) {
	s := testServer(t)
	cfg, _ := cage.Load(s.configPath)
	if settingsView(cfg, s.preferences).ClaudeTerminalCommand != "claude" {
		t.Fatal("missing default")
	}
	input := settingsView(cfg, s.preferences)
	input.ClaudeTerminalCommand = "claude --continue --model sonnet"
	_, p, err := proposedSettings(input, cfg, s.profile)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.apply(savedProfile{cfg, p}, true); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(s.profile, "workbench.json"))
	if err != nil || !strings.Contains(string(data), input.ClaudeTerminalCommand) {
		t.Fatalf("command not saved: %v", err)
	}
	after, _ := cage.Load(s.configPath)
	if after != cfg {
		t.Fatal("terminal preference modified environment configuration")
	}
	for _, bad := range []string{"claude\nexit", "claude\r", "claude\x00", strings.Repeat("x", 4097)} {
		input.ClaudeTerminalCommand = bad
		if _, _, err := proposedSettings(input, cfg, s.profile); err == nil {
			t.Fatal("invalid command accepted")
		}
	}
}

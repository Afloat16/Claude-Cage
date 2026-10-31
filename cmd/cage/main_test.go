package main

import (
	"os"
	"testing"
)

func TestEntryDropsInheritedUnsafeSwitchesBeforeDispatch(t *testing.T) {
	// A benign early-return command exercises the entry boundary without a VM,
	// Git configuration changes, or access to the user's Cage profile.
	unsafe := []string{
		"AGENT_VM_UNSAFE_OPEN_NETWORK",
		"AGENT_VM_UNSAFE_WRITABLE_GIT",
		"AGENT_VM_UNSAFE_DISABLE_SECURITY_PROMPTS",
	}
	for _, name := range unsafe {
		t.Setenv(name, "1")
	}
	t.Setenv("CLAUDE_CAGE_CONFIG", "/not-accessed-by-help/config.json")
	previous := os.Args
	os.Args = []string{"cage", "help"}
	t.Cleanup(func() { os.Args = previous })
	if code := run(); code != 0 {
		t.Fatalf("help returned %d", code)
	}
	for _, name := range unsafe {
		if _, exists := os.LookupEnv(name); exists {
			t.Errorf("%s survived the Cage entry point", name)
		}
	}
	if got := os.Getenv("CLAUDE_CAGE_CONFIG"); got != "/not-accessed-by-help/config.json" {
		t.Errorf("profile selection changed: %q", got)
	}
}

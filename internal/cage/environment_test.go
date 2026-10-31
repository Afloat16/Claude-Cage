package cage

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/sylvinus/agent-vm/internal/vmname"
)

func TestEnvironmentIdentitySurvivesProjectSelectionAndLegacyUpgrade(t *testing.T) {
	profile := t.TempDir()
	legacy, _ := filepath.EvalSymlinks(t.TempDir())
	if err := os.WriteFile(filepath.Join(profile, "workbench.json"), []byte(`{"workspace":"`+legacy+`"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if EnvironmentDir(profile) == legacy {
		t.Fatal("selected project without an existing VM became the environment")
	}
	vmDir := filepath.Join(profile, "state", "lima", vmname.Name(legacy))
	if err := os.MkdirAll(vmDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(vmDir, "lima.yaml"), []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if EnvironmentDir(profile) != legacy {
		t.Fatal("existing VM disk was not retained during upgrade")
	}
	if err := os.WriteFile(filepath.Join(profile, "environment.json"), []byte(`{"directory":"`+legacy+`"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(profile, "workbench.json"), []byte(`{"workspace":"/different-project"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if EnvironmentDir(profile) != legacy {
		t.Fatal("changing project changed the environment VM")
	}
}

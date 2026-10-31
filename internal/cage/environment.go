package cage

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/sylvinus/agent-vm/internal/vmname"
)

// EnvironmentDir is the stable VM anchor for this profile, independent of projects.
func EnvironmentDir(profile string) string {
	var saved struct {
		Directory string `json:"directory"`
	}
	if b, err := os.ReadFile(filepath.Join(profile, "environment.json")); err == nil && json.Unmarshal(b, &saved) == nil && filepath.IsAbs(saved.Directory) {
		return saved.Directory
	}
	// CLI and desktop upgrades must retain the same existing virtual disk.
	var legacy struct {
		Workspace string `json:"workspace"`
	}
	if b, err := os.ReadFile(filepath.Join(profile, "workbench.json")); err == nil && json.Unmarshal(b, &legacy) == nil && filepath.IsAbs(legacy.Workspace) {
		if _, err := os.Stat(filepath.Join(profile, "state", "lima", vmname.Name(legacy.Workspace), "lima.yaml")); err == nil {
			return legacy.Workspace
		}
	}
	path := filepath.Clean(profile) + "-workspace"
	if real, err := filepath.EvalSymlinks(path); err == nil {
		return real
	}
	return path
}

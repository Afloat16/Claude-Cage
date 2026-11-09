//go:build windows

package guestos

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"golang.org/x/sys/windows"
)

func WindowsMaintenanceCommand(ctx context.Context, profile, kit, manifest string, tools bool) (*exec.Cmd, error) {
	binding, err := LoadWindowsProfile(profile)
	if err != nil {
		return nil, err
	}
	if binding == nil {
		return nil, errors.New("此配置尚未绑定 Windows 客机")
	}
	system, err := windows.GetSystemDirectory()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(manifest)
	if err != nil {
		return nil, err
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(data))
	args := []string{"-NoLogo", "-NoProfile", "-ExecutionPolicy", "RemoteSigned", "-File", filepath.Join(kit, "maintain-windows-workbench.ps1"), "-Profile", profile, "-ManifestPath", manifest, "-ManifestSHA256", hash}
	if tools {
		args = append(args, "-Tools")
	}
	return exec.CommandContext(ctx, filepath.Join(system, "WindowsPowerShell", "v1.0", "powershell.exe"), args...), nil
}

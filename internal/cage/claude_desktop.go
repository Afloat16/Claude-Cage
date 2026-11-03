package cage

import _ "embed"

//go:embed claude-desktop-install.sh
var claudeDesktopInstall string

//go:embed claude-desktop-session.sh
var claudeDesktopSession string

//go:embed claude-desktop-open.sh
var claudeDesktopOpen string

//go:embed claude-desktop-start.sh
var claudeDesktopStart string

//go:embed guest-open.sh
var guestOpen string

func guestOpenScript() string {
	return "sudo tee /usr/local/bin/cage-open >/dev/null <<'CAGE_OPEN_URL'\n" + guestOpen + "\nCAGE_OPEN_URL\nsudo chmod 0755 /usr/local/bin/cage-open\nsudo ln -sf /usr/local/bin/cage-open /usr/local/bin/xdg-open\n"
}

func ClaudeDesktopInstallScript() string {
	return claudeDesktopInstall + "\n" + ClaudeDesktopProvisionScript()
}

// Provisioning is independent of the browser and never restarts it. Desktop
// services are deliberately not enabled at boot: the user opens the app.
func ClaudeDesktopProvisionScript() string {
	return "set -euo pipefail\n" + fileInputScript() +
		"sudo install -d -m 0755 /etc/claude-cage\n" +
		"sudo tee /usr/local/bin/cage-claude-session >/dev/null <<'CAGE_CLAUDE_SESSION'\n" + claudeDesktopSession + "\nCAGE_CLAUDE_SESSION\n" +
		"sudo tee /usr/local/bin/cage-claude-open >/dev/null <<'CAGE_CLAUDE_OPEN'\n" + claudeDesktopOpen + "\nCAGE_CLAUDE_OPEN\n" +
		"sudo tee /usr/local/bin/cage-claude-start >/dev/null <<'CAGE_CLAUDE_START'\n" + claudeDesktopStart + "\nCAGE_CLAUDE_START\n" +
		"sudo chmod 0755 /usr/local/bin/cage-claude-session /usr/local/bin/cage-claude-open /usr/local/bin/cage-claude-start\n" + guestOpenScript() + `
printf 'cage-browser ALL=(cage) NOPASSWD: /usr/local/bin/cage-claude-open *\n' | sudo tee /etc/sudoers.d/cage-claude-desktop >/dev/null
sudo chmod 0440 /etc/sudoers.d/cage-claude-desktop
sudo tee /etc/claude-cage/desktop-openbox.xml >/dev/null <<'CAGE_CLAUDE_WINDOWS'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
<focus><focusNew>yes</focusNew><followMouse>no</followMouse></focus>
<desktops><number>1</number></desktops>
<applications><application type="normal"><decor>no</decor><maximized>yes</maximized></application></applications>
</openbox_config>
CAGE_CLAUDE_WINDOWS
sudo tee /etc/systemd/system/cage-claude-desktop.service >/dev/null <<'CAGE_CLAUDE_UNIT'
[Unit]
Description=Claude Desktop in Cage
[Service]
Type=notify
NotifyAccess=all
User=cage
WorkingDirectory=/home/cage
Environment=HOME=/home/cage
EnvironmentFile=/etc/claude-cage/environment
RuntimeDirectory=cage-desktop
RuntimeDirectoryMode=0700
ExecStart=/usr/local/bin/cage-claude-session
KillMode=control-group
TimeoutStartSec=45
TimeoutStopSec=20
CAGE_CLAUDE_UNIT
sudo systemctl daemon-reload
`
}

package cage

import (
	"al.essio.dev/pkg/shellescape"
	_ "embed"
	"fmt"
)

//go:embed guest-setup.sh
var guestDependencies string

//go:embed guest-services.sh
var guestServices string

//go:embed novnc-patch.py
var novncPatch string

//go:embed clipboard.js
var clipboardJS string

//go:embed browser-agent.mjs
var browserAgent string

//go:embed save-download.py
var saveDownload string

func browserServices() string {
	return guestServices + "\nsudo tee /usr/local/lib/cage-browser-agent.mjs >/dev/null <<'CAGE_BROWSER_AGENT'\n" + browserAgent + "\nCAGE_BROWSER_AGENT\n" + "sudo tee /usr/local/bin/cage-save-download >/dev/null <<'CAGE_DOWNLOAD_HELPER'\n" + saveDownload + "\nCAGE_DOWNLOAD_HELPER\nsudo chmod 0755 /usr/local/bin/cage-save-download\nprintf 'cage-browser ALL=(root) NOPASSWD: /usr/local/bin/cage-save-download *\\n' | sudo tee /etc/sudoers.d/cage-download >/dev/null\nsudo chmod 0440 /etc/sudoers.d/cage-download\n" + "\nsudo python3 - <<'CAGE_NOVNC_PATCH'\n" + novncPatch + "\nCAGE_NOVNC_PATCH\n" + "\nsudo tee /usr/share/novnc/cage-clipboard.js >/dev/null <<'CAGE_CLIPBOARD_JS'\n" + clipboardJS + "\nCAGE_CLIPBOARD_JS\n" + `sudo python3 - <<'PYCODE'
from pathlib import Path
import re
p = Path("/usr/share/novnc/vnc.html")
s = p.read_text()
tag = '<script type="module" src="cage-clipboard.js?cage=8"></script>'
pattern = r'<script type="module" src="cage-clipboard\.js(?:\?cage=\d+)?"></script>'
if re.search(pattern, s):
    s = re.sub(pattern, lambda _: tag, s)
else:
    s = s.replace("</body>", tag + "\n</body>")
p.write_text(s)
PYCODE
`
}

var GuestSetup = guestDependencies + "\n" + browserServices()

//go:embed editor-theme.json
var editorTheme string

//go:embed guest-start.sh
var guestStart string

//go:embed guest-env.sh
var guestEnv string

func (c Config) EnvironmentScript() string {
	return fmt.Sprintf("export CAGE_TZ=%s\nexport CAGE_LOCALE=%s\nexport CAGE_LANGUAGE=%s\n", shellescape.Quote(c.Timezone), shellescape.Quote(c.Locale), shellescape.Quote(c.BrowserLanguage)) + guestEnv
}

func (c Config) StartScript() string {
	return c.EnvironmentScript() + "\n" + browserServices() + "\nsudo tee /etc/claude-cage/editor-theme.json >/dev/null <<'CAGE_EDITOR_THEME'\n" + editorTheme + "\nCAGE_EDITOR_THEME\n" + guestStart
}

# Patch noVNC's RFB transport so a paste finishes before the next one starts.
# The resulting rfb.js retains noVNC's MPL-2.0 license header.
from pathlib import Path
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/usr/share/novnc')
path = root / 'core/rfb.js'
source = path.read_text()
original = path.with_name('rfb.cage-original.js')
if 'cagePasteText(text)' in source:
    if not original.exists():
        raise SystemExit('Restore the package rfb.js before applying a new clipboard patch')
    source = original.read_text()
else:
    original.write_text(source)
ui = root / 'app/ui.js'
u = ui.read_text() if ui.exists() else ''
u = u.replace('cage=2', 'cage=3')
u = u.replace('"../core/rfb.js"', '"../core/rfb.js?cage=3"')
page = root / 'vnc.html'
h = (page.read_text() if page.exists() else '').replace('cage=2', 'cage=3').replace('"./app/ui.js"', '"./app/ui.js?cage=3"')
h = h.replace('src="cage-clipboard.js"', 'src="cage-clipboard.js?cage=3"')

def replace_once(old, new):
    global source
    if source.count(old) != 1:
        raise SystemExit('Unsupported noVNC version: clipboard transport patch did not apply')
    source = source.replace(old, new)

replace_once('    clipboardPasteFrom(text) {', '''    // Cage: serialize the clipboard notification, data transfer and paste.
    // A server fence confirms it has processed the provided clipboard data.
    cagePasteText(text) {
        const previous = this._cagePasteChain || Promise.resolve();
        const result = previous.then(() => new Promise((resolve, reject) => {
            if (this._rfbConnectionState !== 'connected' || this._viewOnly ||
                !this._supportsFence ||
                !this._clipboardServerCapabilitiesActions[extendedClipboardActionNotify] ||
                !this._clipboardServerCapabilitiesActions[extendedClipboardActionProvide]) {
                reject(new Error('Clipboard transport is not ready'));
                return;
            }
            const id = 'cage-paste-' + (this._cagePasteSequence = (this._cagePasteSequence || 0) + 1);
            const timer = setTimeout(() => {
                if (this._cagePasteJob?.id === id) this._cagePasteJob = null;
                reject(new Error('Remote application did not accept the paste'));
            }, 4000);
            this._cagePasteJob = {id, timer, resolve, phase: 'data'};
            this.clipboardPasteFrom(text);
        }));
        this._cagePasteChain = result.catch(() => {});
        return result;
    }

    clipboardPasteFrom(text) {''')
provide = 'RFB.messages.extendedClipboardProvide(this._sock, [extendedClipboardFormatText], [this._clipboardText]);'
replace_once(provide, provide + '''
                        if (this._cagePasteJob?.phase === 'data') {
                            this._cagePasteJob.phase = 'fence';
                            RFB.messages.clientFence(this._sock, (1 << 31) | 1, this._cagePasteJob.id);
                        }''')
replace_once('''        if (!(flags & (1<<31))) {
            return this._fail("Unexpected fence response");
        }''', '''        if (!(flags & (1<<31))) {
            const job = this._cagePasteJob;
            if (job && job.phase === 'fence' && payload === job.id) {
                this.sendKey(0xffe3, 'ControlLeft', true);
                this.sendKey(0x76, 'KeyV', true);
                this.sendKey(0x76, 'KeyV', false);
                this.sendKey(0xffe3, 'ControlLeft', false);
                job.phase = 'keys';
                RFB.messages.clientFence(this._sock, (1 << 31) | 1, job.id + '-keys');
                return true;
            }
            if (job && job.phase === 'keys' && payload === job.id + '-keys') {
                clearTimeout(job.timer);
                this._cagePasteJob = null;
                job.resolve();
                return true;
            }
            // A late acknowledgement after a timeout must not disconnect.
            if (payload.startsWith('cage-paste-')) return true;
            return this._fail("Unexpected fence response");
        }''')
path.write_text(source)
if ui.exists(): ui.write_text(u)
if page.exists(): page.write_text(h)

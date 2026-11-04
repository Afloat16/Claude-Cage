#!/bin/sh
set -eu
case "${1:-}" in
  claude://*)
    sudo -u cage /usr/local/bin/cage-claude-open "$1"
    # Publish focus only after the running application accepted the handoff.
    # The browser service never receives the login URL or its credentials.
    set -- /desktop-focus
    ;;
  http://*|https://*|about:blank) set -- /new "$1" ;;
  *) echo 'Only HTTP(S) browser URLs and Claude desktop callbacks are accepted.' >&2; exit 2;;
esac
exec sudo -u cage-browser /usr/bin/node --input-type=module - "$@" <<'NODE'
import {readFileSync} from 'node:fs';
const {token}=JSON.parse(readFileSync('/etc/claude-cage/browser-control.json','utf8'));
const response=await fetch('http://127.0.0.1:18500'+process.argv[2],{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(process.argv[2]==='/new'?{url:process.argv[3]}:{})});
if(!response.ok)process.exit(1);
NODE

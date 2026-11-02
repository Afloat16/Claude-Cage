#!/bin/sh
set -eu
case "${1:-}" in
  claude://*) exec sudo -u cage /usr/local/bin/cage-claude-open "$1" ;;
  http://*|https://*|about:blank) ;;
  *) echo 'Only HTTP(S) browser URLs and Claude desktop callbacks are accepted.' >&2; exit 2;;
esac
exec sudo -u cage-browser /usr/bin/node --input-type=module - "$1" <<'NODE'
import {readFileSync} from 'node:fs';
const {token}=JSON.parse(readFileSync('/etc/claude-cage/browser-control.json','utf8'));
const response=await fetch('http://127.0.0.1:18500/new',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({url:process.argv[2]})});
if(!response.ok)process.exit(1);
NODE

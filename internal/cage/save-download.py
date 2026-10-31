#!/usr/bin/python3
"""Copy a completed browser download into the selected shared project's Downloads."""
import json
import os
import pwd
import re
import shutil
import stat
import sys

source_name = sys.argv[1] if len(sys.argv) == 3 else ''
name = sys.argv[2] if len(sys.argv) == 3 else ''
if not re.fullmatch(r'[a-fA-F0-9-]{36}', source_name):
    raise SystemExit(2)
if not name or name != os.path.basename(name) or name in ('.', '..'):
    raise SystemExit(2)
with open('/etc/claude-cage/browser-control.json') as f:
    workspace = json.load(f)['workspace']
source = os.open('/home/cage-browser/Downloads/' + source_name, os.O_RDONLY | os.O_NOFOLLOW)
if not stat.S_ISREG(os.fstat(source).st_mode):
    raise SystemExit(2)
user = pwd.getpwnam('cage')
# Work as the coding user while writing into the share, not as root.
os.setgroups([user.pw_gid])
os.setgid(user.pw_gid)
os.setuid(user.pw_uid)
parent = os.open(workspace, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    os.mkdir('Downloads', mode=0o755, dir_fd=parent)
except FileExistsError:
    pass
destination = os.open('Downloads', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
root, extension = os.path.splitext(name)
for number in range(1000):
    candidate = name if number == 0 else f'{root} ({number}){extension}'
    try:
        output = os.open(candidate, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=destination)
        break
    except FileExistsError:
        continue
else:
    raise SystemExit(1)
with os.fdopen(source, 'rb') as src, os.fdopen(output, 'wb') as dst:
    shutil.copyfileobj(src, dst)

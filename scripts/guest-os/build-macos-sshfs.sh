#!/bin/bash
# Build the FSKit-compatible SSHFS against the SDK from the signed macFUSE
# installer. Pass its extracted usr/local directory; no host driver is installed.
set -euo pipefail
[[ $# == 2 && $(uname -sm) == 'Darwin arm64' ]] || { echo 'Usage: build-macos-sshfs.sh /absolute/macfuse-sdk/usr/local /absolute/cage-sshfs' >&2; exit 2; }
sdk=$1
output=$2
[[ $sdk == /* && $output == /* && -f $sdk/include/fuse3/fuse.h && ! -e $output ]]
src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
commit=9b68e5f1b978c1d3c6ef7632b68d580a52ec0232
curl -fLsS --retry 2 "https://codeload.github.com/libfuse/sshfs/tar.gz/$commit" -o "$src/sshfs.tgz"
cd "$src"
echo '9be20256ac841c6e5b4cd8aefbf57c325f93e9ff01f7c7691edfe9f02700338b  sshfs.tgz' | shasum -a 256 -c - >/dev/null
tar xzf sshfs.tgz --strip-components 1
cat > config.h <<'HEADER'
#define PACKAGE_VERSION "3.7.6"
#define IDMAP_DEFAULT "user"
HEADER
glib=$(brew --prefix glib)
intl=$(brew --prefix gettext)
pcre=$(brew --prefix pcre2)
clang -arch arm64 -O2 -D_REENTRANT -DHAVE_CONFIG_H -DFUSE_DARWIN_ENABLE_EXTENSIONS=0 -DFUSE_USE_VERSION=31 \
  -I. -Icompat -I"$sdk/include/fuse3" -I"$glib/include/glib-2.0" -I"$glib/lib/glib-2.0/include" -I"$intl/include" \
  sshfs.c cache.c compat/darwin_compat.c "$glib/lib/libgthread-2.0.a" "$glib/lib/libglib-2.0.a" "$intl/lib/libintl.a" "$pcre/lib/libpcre2-8.a" \
  -L"$sdk/lib" -lfuse3 -liconv -framework Foundation -framework CoreFoundation -framework AppKit -framework Carbon -o cage-sshfs
codesign -s - --force cage-sshfs
install -m 755 cage-sshfs "$output"

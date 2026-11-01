#!/usr/bin/env bash
# Validate the actual downloaded distribution without installing or launching it.
set -euo pipefail
directory="${1:?Usage: scripts/verify-macos-release.sh <release-directory>}"
shopt -s nullglob
archives=("$directory"/Cage-*-macos-arm64.dmg)
if [[ ${#archives[@]} != 1 ]]; then echo 'Expected exactly one Cage DMG.' >&2; exit 1; fi
archive="${archives[0]}"
version="${archive##*/Cage-}"
version="${version%-macos-arm64.dmg}"
(cd "$directory" && shasum -a 256 --check SHA256SUMS)
codesign --verify --strict --verbose=2 "$archive"
xcrun stapler validate "$archive"
spctl --assess --type open --context context:primary-signature --verbose=2 "$archive"
mount="$(mktemp -d)"
cleanup() { hdiutil detach "$mount" >/dev/null 2>&1 || true; rmdir "$mount" 2>/dev/null || true; }
trap cleanup EXIT
hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$archive" >/dev/null
bundle="$mount/Cage.app"
test "$(/usr/libexec/PlistBuddy -c 'Print :CageVersion' "$bundle/Contents/Info.plist")" = "$version"
codesign --verify --deep --strict --verbose=2 \
  -R='anchor apple generic and identifier "io.github.lee-xeo.claude-cage" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists' "$bundle"
xcrun stapler validate "$bundle"
spctl --assess --type execute --verbose=2 "$bundle"
echo "Verified Developer ID, notarization, Gatekeeper, and version: Cage $version"

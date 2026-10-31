#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then echo 'Cage.app must be built on macOS.' >&2; exit 1; fi
case "${1:-}" in ''|--install) ;; *) echo 'Usage: scripts/build-app.sh [--install]' >&2; exit 2 ;; esac
version="$(tr -d '\n\r' < VERSION)"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then echo 'Invalid VERSION.' >&2; exit 1; fi
short_version="${version%%-*}"
build_version="${CAGE_BUILD_NUMBER:-1}"
if [[ ! "$build_version" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]]; then echo 'Invalid CAGE_BUILD_NUMBER.' >&2; exit 1; fi
identity="${CAGE_SIGNING_IDENTITY:--}"
# The host SDK may default to the developer's newer macOS version. Set the
# deployment target for the Go/cgo helper as well as the Swift launcher.
export MACOSX_DEPLOYMENT_TARGET=14.0
export CGO_CFLAGS="${CGO_CFLAGS:-} -mmacosx-version-min=14.0"
export CGO_LDFLAGS="${CGO_LDFLAGS:-} -mmacosx-version-min=14.0"
bash scripts/fetch-proxy-core.sh
make cage VERSION="$version"
bundle="$PWD/_output/Cage.app"
# Do not leave stale signed resources from a previous build in the bundle.
rm -rf "$bundle"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
swiftc -O -target "$(uname -m)-apple-macosx14.0" -parse-as-library -framework Cocoa -framework WebKit desktop/Cage.swift -o "$bundle/Contents/MacOS/Cage"
cp _output/bin/cage "$bundle/Contents/Resources/cage"
cp _output/proxy-core/mihomo "$bundle/Contents/Resources/mihomo"
for executable in "$bundle/Contents/MacOS/Cage" "$bundle/Contents/Resources/cage" "$bundle/Contents/Resources/mihomo"; do
  minimum="$(otool -l "$executable" | awk '$1 == "minos" {print $2}')"
  if [[ -z "$minimum" ]] || ! awk -v version="$minimum" 'BEGIN {split(version,v,"."); exit !(v[1] < 14 || (v[1] == 14 && v[2] == 0 && v[3]+0 == 0))}'; then
    printf 'Unsupported deployment target %s in %s (expected macOS 14.0 or earlier).\n' "$minimum" "$executable" >&2
    exit 1
  fi
done
mkdir -p "$bundle/Contents/Resources/licenses/mihomo"
cp _output/proxy-core/LICENSE _output/proxy-core/NOTICE "$bundle/Contents/Resources/licenses/mihomo/"
node scripts/collect-app-licenses.mjs "$bundle/Contents/Resources/licenses"
swift desktop/Icon.swift logo.png _output/Cage.iconset
iconutil -c icns _output/Cage.iconset -o "$bundle/Contents/Resources/Cage.icns"
cat > "$bundle/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Cage</string>
<key>CFBundleDisplayName</key><string>Cage</string>
<key>CFBundleIdentifier</key><string>io.github.lee-xeo.claude-cage</string>
<key>CFBundleVersion</key><string>$build_version</string>
<key>CFBundleShortVersionString</key><string>$short_version</string>
<key>CageVersion</key><string>$version</string>
<key>CFBundleExecutable</key><string>Cage</string>
<key>CFBundleIconFile</key><string>Cage</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
sign=(codesign --force --sign "$identity")
if [[ "$identity" != - ]]; then sign+=(--timestamp --options runtime); fi
"${sign[@]}" --entitlements third_party/lima/vz.entitlements "$bundle/Contents/Resources/cage"
"${sign[@]}" "$bundle/Contents/Resources/mihomo"
"${sign[@]}" "$bundle/Contents/MacOS/Cage"
"${sign[@]}" "$bundle"
codesign --verify --deep --strict --verbose=2 "$bundle"
printf 'Built: %s\n' "$bundle"
if [[ "${1:-}" == "--install" ]]; then
  mkdir -p "$HOME/Applications"
  ditto "$bundle" "$HOME/Applications/Cage.app"
  printf 'Installed: %s/Applications/Cage.app\n' "$HOME"
fi

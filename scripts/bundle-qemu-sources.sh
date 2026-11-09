#!/usr/bin/env bash
# Bundle the exact QEMU/firmware revisions and the packages owning its DLLs.
set -euo pipefail
repository=$(cygpath -u "$1")
runtime=$(cygpath -u "$2")
archive=$(cygpath -u "$3")
commit=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).qemuSource.commit" "$repository/packaging/windows/dependencies.json")
[[ $commit =~ ^[a-f0-9]{40}$ && -s "$runtime/build-source-packages.txt" ]] || { echo 'QEMU source/package identity is missing.' >&2; exit 1; }
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/source/packages" "$stage/source/cage"
git -c core.autocrlf=false init -q "$stage/source/qemu"
git -C "$stage/source/qemu" fetch --depth=1 https://github.com/stweil/qemu.git "$commit"
git -c core.autocrlf=false -C "$stage/source/qemu" checkout -q --detach FETCH_HEAD
[[ $(git -C "$stage/source/qemu" rev-parse HEAD) == "$commit" ]]
# All shipped firmware comes from QEMU's pinned ROM submodules. Include nested
# submodules (EDK2 libraries etc.), not only the superproject's empty gitlinks.
git -c core.autocrlf=false -C "$stage/source/qemu" submodule update --init --recursive --depth=1 -- roms
git -C "$stage/source/qemu" submodule status --recursive -- roms > "$stage/source/firmware-revisions.txt"
if grep -Eq '^[-+U]' "$stage/source/firmware-revisions.txt"; then echo 'Firmware source revisions are incomplete.' >&2; exit 1; fi
cp "$runtime/build-source-packages.txt" "$runtime/build-packages.txt" "$runtime/cage-build.json" "$stage/source/cage/"
cp "$repository/scripts/build-qemu-windows.sh" "$repository/scripts/build-qemu-windows.ps1" "$repository/scripts/bundle-qemu-sources.sh" "$stage/source/cage/"
cp -R "$repository/patches/qemu" "$stage/source/cage/patches"
keymap_url=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).qemuKeycodemap.url" "$repository/packaging/windows/dependencies.json")
keymap_hash=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).qemuKeycodemap.hash" "$repository/packaging/windows/dependencies.json")
curl --fail --location --retry 3 -o "$stage/source/keycodemapdb.tar.gz" "$keymap_url"
printf '%s  %s\n' "$keymap_hash" "$stage/source/keycodemapdb.tar.gz" | sha256sum -c -
while read -r base version; do
    [[ $base =~ ^[a-zA-Z0-9+_.-]+$ && $version =~ ^[a-zA-Z0-9+_.:-]+$ ]] || exit 1
    found=false
    for extension in zst xz gz; do
        name="$base-$version.src.tar.$extension"
        url="https://repo.msys2.org/mingw/sources/$name"
        if curl --fail --location --retry 2 -o "$stage/source/packages/$name" "$url"; then
            curl --fail --location --retry 3 -o "$stage/source/packages/$name.sig" "$url.sig"
            pacman-key --verify "$stage/source/packages/$name.sig" "$stage/source/packages/$name"
            found=true
            break
        fi
    done
    $found || { echo "No verified corresponding source for $base $version" >&2; exit 1; }
done < "$runtime/build-source-packages.txt"
# Firmware sources remain unmodified; the Cage patch and reproducible build
# commands travel beside them. The manifest covers every distributed source.
find "$stage/source" -name .git -type d -prune -exec rm -rf {} +
find "$stage/source" -name .git -type f -delete
(cd "$stage/source" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
mkdir -p "$(dirname "$archive")"
tar -czf "$archive.partial" -C "$stage" source
mv "$archive.partial" "$archive"
sha256sum "$archive"

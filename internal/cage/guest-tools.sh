# shellcheck shell=bash
# Functions are shared by first installation and an explicit in-place upgrade.
# Each invocation owns its staging files and leaves caller traps unchanged.
# Keep only version-shaped tokens; first-run notices can precede --version.
# Read all output so pipefail cannot turn an early reader exit into SIGPIPE.
cage_tool_version() {
  awk '$1 ~ /^v?[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$/ && !found { print $1; found=1 }'
}

# The caller holds the checksum directory lock. Partial files survive a failed
# attempt; only a complete checksum-verified artifact is eligible for install.
cage_download_tool() (
  set -euo pipefail
  local url="$1" checksum="$2" artifact="$3" hash="${4:-sha256sum}" attempt status http
  if [ -f "$artifact" ]; then
    if printf '%s  %s\n' "$checksum" "$artifact" | "$hash" --check --status; then return 0; fi
    rm -f "$artifact"
  fi
  for attempt in 1 2 3 4; do
    printf 'Downloading %s (attempt %s/4; resume from %s bytes).\n' "${artifact##*/}" "$attempt" "$(if [ -f "$artifact.part" ]; then wc -c < "$artifact.part"; else echo 0; fi)"
    if http="$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location \
      --connect-timeout 15 --max-time 1800 --speed-limit 1024 --speed-time 60 \
      --continue-at - --write-out '%{http_code}' "$url" -o "$artifact.part" </dev/null)"; then
      status=0
    else
      status=$?
    fi
    # A previous attempt can have received the whole body before cancellation.
    if [ "$status" = 0 ] || [ "$http" = 416 ]; then
      if printf '%s  %s\n' "$checksum" "$artifact.part" | "$hash" --check --status; then
        mv -f "$artifact.part" "$artifact"
        return 0
      fi
      rm -f "$artifact.part"
      echo 'Tool checksum mismatch; installation refused. Retry downloads a fresh copy.' >&2
      return 1
    fi
    case "$status" in
      33|36) rm -f "$artifact.part" ;; # Server cannot resume: next attempt starts at zero.
      5|6|7|18|28|35|52|55|56|92) ;; # Connection, partial body, TLS EOF or timeout.
      22) case "$http" in 408|429|500|502|503|504) ;; *) return "$status" ;; esac ;;
      *) return "$status" ;;
    esac
    if [ "$attempt" != 4 ]; then sleep "$attempt"; fi
  done
  echo 'Download interrupted; partial data is saved. Retry setup to continue.' >&2
  return "$status"
)

# npm caches verified tarballs by their integrity. Populate it as the same
# guest user that installs Claude, so a setup retry does not fetch its large
# optional native package again. npm remains responsible for dependency setup.
cage_cache_claude() (
  set -euo pipefail
  local arch="$1" wanted="$2" package metadata integrity checksum url cache
  case "$arch" in arm64) package=claude-code-linux-arm64 ;; amd64) package=claude-code-linux-x64 ;; esac
  metadata="$(npm view --registry=https://registry.npmjs.org "@anthropic-ai/$package@$wanted" dist --json </dev/null)"
  integrity="$(printf '%s' "$metadata" | jq -er '.integrity | select(startswith("sha512-"))')"
  checksum="$(printf '%s' "${integrity#sha512-}" | base64 -d | od -An -v -tx1 | tr -d ' \n')"
  [[ "$checksum" =~ ^[0-9a-f]{128}$ ]]
  url="$(printf '%s' "$metadata" | jq -er '.tarball | select(startswith("https://registry.npmjs.org/"))')"
  cache="$HOME/.cache/cage/downloads/$checksum"
  mkdir -p "$cache"
  exec 9>"$cache/lock"
  flock -w 60 9
  cage_download_tool "$url" "$checksum" "$cache/$package.tgz" sha512sum
  npm cache add --offline --ignore-scripts "$cache/$package.tgz" </dev/null
)

cage_install_tool() (
  set -euo pipefail
  local tool="$1" arch current='' wanted url checksum artifact
  arch="$(dpkg --print-architecture)"
  case "$arch" in arm64|amd64) ;; *) echo 'Cage tool packages support arm64 and amd64.' >&2; exit 1 ;; esac
  case "$tool" in
    code-server)
      wanted="$CAGE_CODE_SERVER_VERSION"
      if command -v code-server >/dev/null; then current="$(code-server --version | cage_tool_version)" || current=''; fi
      url="https://github.com/coder/code-server/releases/download/v$wanted/code-server_${wanted}_${arch}.deb"
      if [ "$arch" = arm64 ]; then checksum="$CAGE_CODE_SERVER_ARM64_SHA256"; else checksum="$CAGE_CODE_SERVER_AMD64_SHA256"; fi
      artifact=code-server.deb
      ;;
    mise)
      wanted="$CAGE_MISE_VERSION"
      if [ -x "$HOME/.local/bin/mise" ]; then current="$("$HOME/.local/bin/mise" --version | cage_tool_version)" || current=''; fi
      if [ "$arch" = arm64 ]; then checksum="$CAGE_MISE_ARM64_SHA256"; else checksum="$CAGE_MISE_AMD64_SHA256"; fi
      url="https://github.com/jdx/mise/releases/download/v$wanted/mise-v$wanted-linux-$(if [ "$arch" = arm64 ]; then echo arm64; else echo x64; fi).tar.gz"
      artifact=mise.tar.gz
      ;;
    claude)
      wanted="$CAGE_CLAUDE_VERSION"
      if command -v claude >/dev/null; then current="$(DISABLE_AUTOUPDATER=1 claude --version | cage_tool_version)" || current=''; fi
      ;;
    *) echo 'Unknown Cage tool.' >&2; exit 2 ;;
  esac
  if [ -n "$current" ] && dpkg --compare-versions "${current#v}" ge "$wanted"; then
    printf '%s already meets required version %s.\n' "$tool" "$wanted"
    exit 0
  fi
  if [ "$tool" = claude ]; then
    export npm_config_fetch_retries=3 npm_config_fetch_timeout=120000
    cage_cache_claude "$arch" "$wanted"
    npm install --registry=https://registry.npmjs.org --prefix "$HOME/.local" --global "@anthropic-ai/claude-code@$wanted" </dev/null
    exit 0
  fi
  local cache="$HOME/.cache/cage/downloads/$checksum" stage
  mkdir -p "$cache"
  # First setup and maintenance can both reach this helper in a Linux guest.
  exec 9>"$cache/lock"
  flock -w 60 9
  cage_download_tool "$url" "$checksum" "$cache/$artifact"
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' EXIT
  if [ "$tool" = code-server ]; then
    sudo env DEBIAN_FRONTEND=noninteractive APT_CONFIG="${CAGE_APT_CONFIG:-/dev/null}" apt-get -o Acquire::Retries=3 install -y --no-install-recommends "$cache/$artifact" </dev/null
  else
    tar -xzf "$cache/$artifact" -C "$stage"
    mkdir -p "$HOME/.local/bin"
    install -m 0755 "$stage/mise/bin/mise" "$HOME/.local/bin/.mise-new"
    mv -f "$HOME/.local/bin/.mise-new" "$HOME/.local/bin/mise"
  fi
)

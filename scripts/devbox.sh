#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_CANON="$(cd "$ROOT_DIR" && pwd -P)"
LOCAL_TOOLS_BIN="$ROOT_DIR/.tools/bin"
DEVBOX_LOG_DIR="$ROOT_DIR/.devbox-logs"
DEVBOX_ENV_FILE="$ROOT_DIR/.devbox.env"
APP_ENV_FILE="$ROOT_DIR/mingle-app/.env.local"
STT_ENV_FILE="$ROOT_DIR/mingle-stt/.env.local"
NGROK_LOCAL_CONFIG="$ROOT_DIR/ngrok.mobile.local.yml"
RN_IOS_RUNTIME_XCCONFIG="$ROOT_DIR/mingle-app/rn/ios/devbox.runtime.xcconfig"
MINGLE_IOS_DIR="$ROOT_DIR/mingle-ios"
MINGLE_IOS_BUILD_SCRIPT="$MINGLE_IOS_DIR/scripts/build-ios.sh"
MINGLE_IOS_INSTALL_SCRIPT="$MINGLE_IOS_DIR/scripts/install-ios-device.sh"
MINGLE_IOS_SIMULATOR_INSTALL_SCRIPT="$MINGLE_IOS_DIR/scripts/install-ios-simulator.sh"
MINGLE_IOS_TEST_SCRIPT="$MINGLE_IOS_DIR/scripts/test-ios.sh"
MANAGED_START="# >>> devbox managed (auto)"
MANAGED_END="# <<< devbox managed (auto)"
IOS_RN_REQUIRED_API_NAMESPACE="ios/v1.0.0"

if [[ -d "$LOCAL_TOOLS_BIN" ]]; then
  PATH="$LOCAL_TOOLS_BIN:$PATH"
fi

APP_MANAGED_KEYS=(
  DEVBOX_WORKTREE_NAME
  DEVBOX_PROFILE
  DEVBOX_WEB_PORT
  DEVBOX_STT_PORT
  DEVBOX_METRO_PORT
  NEXT_PUBLIC_SITE_URL
  NEXTAUTH_URL
  NEXT_PUBLIC_WS_PORT
  NEXT_PUBLIC_WS_URL
  NEXT_PUBLIC_API_NAMESPACE
  # Legacy keys are stripped for migration cleanup.
  RN_WEB_APP_BASE_URL
  RN_DEFAULT_WS_URL
  RN_API_NAMESPACE
  MINGLE_TEST_API_BASE_URL
  MINGLE_TEST_WS_URL
)

STT_MANAGED_KEYS=(
  DEVBOX_WORKTREE_NAME
  DEVBOX_PROFILE
  PORT
)

# Populated by collect_reserved_ports/calc_default_ports.
RESERVED_ALL_PORTS=""
DEFAULT_WEB_PORT=""
DEFAULT_STT_PORT=""
DEFAULT_METRO_PORT=""
DEFAULT_NGROK_API_PORT=""

# Populated by ngrok tunnel lookup.
NGROK_WEB_URL=""
NGROK_STT_URL=""
NGROK_LAST_ERROR=""
NGROK_LAST_ERROR_KIND=""

# Values loaded from shell/vault/.env.local (and optionally .devbox.env when present).
DEVBOX_WORKTREE_NAME=""
DEVBOX_ROOT_DIR=""
DEVBOX_WEB_PORT=""
DEVBOX_STT_PORT=""
DEVBOX_METRO_PORT=""
DEVBOX_PROFILE=""
DEVBOX_LOCAL_HOST=""
DEVBOX_SITE_URL=""
DEVBOX_RN_WS_URL=""
DEVBOX_PUBLIC_WS_URL=""
DEVBOX_TEST_API_BASE_URL=""
DEVBOX_TEST_WS_URL=""
DEVBOX_VAULT_APP_PATH=""
DEVBOX_VAULT_STT_PATH=""
DEVBOX_NGROK_API_PORT=""
DEVBOX_TUNNEL_PROVIDER="${DEVBOX_TUNNEL_PROVIDER:-}"
DEVBOX_CLOUDFLARE_TUNNEL_TOKEN="${DEVBOX_CLOUDFLARE_TUNNEL_TOKEN:-}"
DEVBOX_CLOUDFLARE_WEB_HOSTNAME="${DEVBOX_CLOUDFLARE_WEB_HOSTNAME:-}"
DEVBOX_CLOUDFLARE_STT_HOSTNAME="${DEVBOX_CLOUDFLARE_STT_HOSTNAME:-}"
DEVBOX_LOG_FILE=""
DEVBOX_OPENCLAW_ROOT=""
DEVBOX_IOS_TEAM_ID="${DEVBOX_IOS_TEAM_ID:-}"

log() {
  printf '[devbox] %s\n' "$*"
}

warn() {
  printf '[devbox] warning: %s\n' "$*" >&2
}

die() {
  printf '[devbox] %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  scripts/devbox [--log-file PATH|auto] <command> [options]
  scripts/devbox init [--web-port N] [--stt-port N] [--metro-port N] [--ngrok-api-port N] [--host HOST] [--vault-app-path PATH] [--vault-stt-path PATH] [--openclaw-root PATH]
  scripts/devbox bootstrap [--vault-app-path PATH] [--vault-stt-path PATH] [--vault-push] [--openclaw-root PATH]
  scripts/devbox profile --profile local|device [--host HOST]
  scripts/devbox ngrok-config
  scripts/devbox gateway [--openclaw-root PATH] [--mode dev|run] [--]
  scripts/devbox ios-native-build [--ios-configuration Debug|Release] [--ios-coredevice-id ID]
  scripts/devbox ios-native-uninstall [--ios-native-target device|simulator] [--ios-simulator-name NAME] [--ios-simulator-udid UDID] [--ios-coredevice-id ID] [--bundle-id ID]
  scripts/devbox ios-rn-ipa [--ios-configuration Debug|Release] [--device-app-env dev|prod] [--site-url URL] [--ws-url URL] [--archive-path PATH] [--export-path PATH] [--export-options-plist PATH] [--export-method app-store-connect|release-testing|debugging|enterprise|app-store|ad-hoc|development] [--team-id TEAM_ID] [--allow-provisioning-updates|--no-allow-provisioning-updates] [--skip-export] [--dry-run]
  scripts/devbox ios-rn-ipa-prod [ios-rn-ipa options...]
  scripts/devbox mobile [--profile local|device] [--host HOST] [--platform ios|android|all] [--ios-runtime rn|native|both] [--ios-native-target device|simulator] [--ios-simulator-name NAME] [--ios-simulator-udid UDID] [--ios-udid UDID] [--ios-coredevice-id ID] [--android-serial SERIAL] [--ios-configuration Debug|Release] [--android-variant debug|release] [--with-ios-clean-install] [--device-app-env dev|prod] [--tunnel-provider ngrok|cloudflare] [--site-url URL] [--ws-url URL]
  scripts/devbox up [--profile local|device] [--host HOST] [--with-metro] [--with-ios-install] [--with-android-install] [--with-mobile-install] [--with-ios-clean-install] [--ios-runtime rn|native|both] [--ios-native-target device|simulator] [--ios-simulator-name NAME] [--ios-simulator-udid UDID] [--ios-udid UDID] [--ios-coredevice-id ID] [--android-serial SERIAL] [--ios-configuration Debug|Release] [--android-variant debug|release] [--tunnel-provider ngrok|cloudflare] [--device-app-env dev|prod] [--vault-app-path PATH] [--vault-stt-path PATH]
  scripts/devbox down
  scripts/devbox test [--target app|ios-native|all] [--ios-configuration Debug|Release] [vitest args...]
  scripts/devbox status

Commands:
  init         Generate worktree-specific ports/config runtime files.
  bootstrap    Read-only for .env.local; install deps and optionally push local env keys to Vault.
  profile      Apply local/device profile to managed env files.
  ngrok-config Regenerate ngrok.mobile.local.yml from current ports.
  gateway      Run OpenClaw gateway from configured openclaw root.
  ios-native-build Build mingle-ios only (no install).
  ios-native-uninstall Uninstall mingle-ios app from simulator/device.
  ios-rn-ipa   Archive/export RN iOS app to .xcarchive/.ipa for App Store/TestFlight.
  ios-rn-ipa-prod Same as ios-rn-ipa, defaulting to --device-app-env prod.
  mobile       Build/install RN/native iOS and Android apps (device/simulator).
  up           Start STT + Next app together (device profile includes tunnel startup).
  down         Stop devbox runtime processes (web/stt/metro/tunnels) for this repo.
  test         Run mingle-app live tests and/or mingle-ios native test build.
  status       Print current endpoints for PC/iOS/Android web and app targets.

Global Options:
  --log-file PATH|auto  Save combined devbox stdout/stderr to PATH.
                        Relative paths resolve from repository root.
                        auto -> .devbox-logs/devbox-<worktree>-<timestamp>.log

Environment:
  DEVBOX_NGROK_WEB_DOMAIN  Optional fixed ngrok domain for devbox_web tunnel.
                           Example: abcdef.ngrok-free.app
  DEVBOX_TUNNEL_PROVIDER   Device profile tunnel provider (ngrok|cloudflare).
                           Default: ngrok
  DEVBOX_CLOUDFLARE_TUNNEL_TOKEN  Optional: when set with hostnames below,
                            cloudflare provider uses named tunnel mode.
  DEVBOX_CLOUDFLARE_WEB_HOSTNAME  Named tunnel web hostname (e.g. web-dev.example.com)
  DEVBOX_CLOUDFLARE_STT_HOSTNAME  Named tunnel stt hostname (e.g. stt-dev.example.com)
  DEVBOX_IOS_TEAM_ID       Optional iOS Team ID used by ios-rn-ipa exportOptions.
                           Example: 3RFBMN8TKZ
  DEVBOX_PERSIST_ENV_FILE  Optional: set to true/1 to write .devbox.env during init/profile.
                           Default is stateless (no .devbox.env writes).
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

resolve_bundle_cmd() {
  local candidate
  for candidate in \
    "/opt/homebrew/opt/ruby/bin/bundle" \
    "/usr/local/opt/ruby/bin/bundle"
  do
    [[ -x "$candidate" ]] || continue
    printf "%s" "$candidate"
    return 0
  done

  # Avoid homebrew gem-bin shim path which can hang on some environments.
  candidate="$(command -v bundle 2>/dev/null || true)"
  if [[ -n "$candidate" && ! "$candidate" =~ ^/opt/homebrew/lib/ruby/gems/.*/bin/bundle$ ]]; then
    printf "%s" "$candidate"
    return 0
  fi

  return 1
}

trim_whitespace() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

is_truthy() {
  local raw="${1:-}"
  local value
  value="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

normalize_domain_input() {
  local value
  value="$(trim_whitespace "${1:-}")"
  value="${value#https://}"
  value="${value#http://}"
  value="${value%%/*}"
  printf '%s' "$value"
}

is_numeric() {
  [[ "${1:-}" =~ ^[0-9]+$ ]]
}

validate_port() {
  local name="$1"
  local port="$2"
  is_numeric "$port" || die "$name must be numeric: $port"
  ((port >= 1 && port <= 65535)) || die "$name out of range (1-65535): $port"
}

validate_host() {
  local host="$1"
  [[ -n "$host" ]] || die "host must not be empty"
  [[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || die "invalid host format: $host"
}

validate_http_url() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "invalid $name: $value"
}

validate_https_url() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "invalid $name (https required): $value"
}

validate_ws_url() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^wss?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "invalid $name: $value"
}

validate_wss_url() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^wss://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "invalid $name (wss required): $value"
}

ensure_single_line_value() {
  local name="$1"
  local value="$2"
  [[ "$value" != *$'\n'* ]] || die "$name cannot contain newline"
  [[ "$value" != *$'\r'* ]] || die "$name cannot contain carriage return"
}

is_valid_env_key() {
  [[ "${1:-}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
}

is_managed_key_for_target() {
  local target="$1"
  local key="$2"
  shift 2 || true

  local item
  case "$target" in
    app)
      for item in "${APP_MANAGED_KEYS[@]}"; do
        [[ "$item" == "$key" ]] && return 0
      done
      ;;
    stt)
      for item in "${STT_MANAGED_KEYS[@]}"; do
        [[ "$item" == "$key" ]] && return 0
      done
      ;;
    *)
      return 1
      ;;
  esac
  return 1
}

format_env_value_for_dotenv() {
  local value="$1"
  if [[ "$value" =~ ^[A-Za-z0-9_./:@,+=-]*$ ]]; then
    printf '%s' "$value"
    return 0
  fi

  local escaped
  escaped="$(printf '%s' "$value" | sed "s/'/'\"'\"'/g")"
  printf "'%s'" "$escaped"
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return $?
  fi
  return 1
}

port_list_contains() {
  local list="$1"
  local port="$2"
  [[ -z "$list" ]] && return 1
  printf '%s\n' "$list" | grep -Fx -- "$port" >/dev/null 2>&1
}

append_port() {
  local list="$1"
  local port="$2"
  if [[ -z "$list" ]]; then
    printf '%s' "$port"
    return
  fi
  printf '%s\n%s' "$list" "$port"
}

read_env_value_from_file() {
  local key="$1"
  local file="$2"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, "", $0); print $0; exit }' "$file"
}

read_vault_cli_env_value_from_local_env_files() {
  local key="$1"
  local value=""
  local file=""
  for file in "$APP_ENV_FILE" "$STT_ENV_FILE"; do
    [[ -f "$file" ]] || continue
    value="$(read_env_value_from_file "$key" "$file" || true)"
    value="$(decode_dotenv_value "$value")"
    value="$(trim_whitespace "$value")"
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done
  return 1
}

prepare_vault_cli_env() {
  local value=""
  if [[ -z "${VAULT_ADDR:-}" ]]; then
    value="$(read_vault_cli_env_value_from_local_env_files "VAULT_ADDR" || true)"
    if [[ -n "$value" ]]; then
      export VAULT_ADDR="$value"
    fi
  fi

  if [[ -z "${VAULT_NAMESPACE:-}" ]]; then
    value="$(read_vault_cli_env_value_from_local_env_files "VAULT_NAMESPACE" || true)"
    if [[ -n "$value" ]]; then
      export VAULT_NAMESPACE="$value"
    fi
  fi
}

read_env_value_from_vault() {
  local path="$1"
  local key="$2"
  local value

  [[ -n "$path" ]] || return 1
  [[ -n "$key" ]] || return 1

  require_cmd vault
  require_cmd jq
  prepare_vault_cli_env

  value="$(vault kv get -format=json "$path" 2>/dev/null | jq -r --arg key "$key" '.data.data[$key] // ""')"
  [[ "$value" == "null" ]] && value=""
  [[ -n "$value" ]] && printf '%s' "$value"
}

can_read_vault_path() {
  local path="$1"
  [[ -n "$path" ]] || return 1
  command -v vault >/dev/null 2>&1 || return 1
  command -v jq >/dev/null 2>&1 || return 1
  prepare_vault_cli_env
  vault kv get -format=json "$path" >/dev/null 2>&1
}

auto_detect_default_vault_path() {
  local target="$1"
  local candidate=""
  local -a candidates=()

  case "$target" in
    app)
      candidates=("secret/mingle-app/dev" "secret/mingle-app/prod")
      ;;
    stt)
      candidates=("secret/mingle-stt/dev" "secret/mingle-stt/prod")
      ;;
    *)
      return 1
      ;;
  esac

  for candidate in "${candidates[@]}"; do
    if can_read_vault_path "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  return 1
}

try_read_env_value_from_vault_path() {
  local path="$1"
  local key="$2"
  local value=""

  [[ -n "$path" ]] || return 1
  [[ -n "$key" ]] || return 1
  command -v vault >/dev/null 2>&1 || return 1
  command -v jq >/dev/null 2>&1 || return 1

  value="$(read_env_value_from_vault "$path" "$key" || true)"
  [[ -n "$value" ]] || return 1
  printf '%s' "$value"
}

read_app_setting_value() {
  local key="$1"
  local value=""
  local path=""
  local seen_paths=""
  local -a candidate_paths=()

  [[ -n "$key" ]] || return 1

  value="${!key:-}"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
    return 0
  fi

  if [[ -n "${DEVBOX_VAULT_APP_PATH:-}" ]] && command -v vault >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    value="$(read_env_value_from_vault "$DEVBOX_VAULT_APP_PATH" "$key" || true)"
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
  fi

  if [[ -f "$APP_ENV_FILE" ]]; then
    value="$(read_env_value_from_file "$key" "$APP_ENV_FILE" || true)"
    value="$(trim_whitespace "$value")"
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
  fi

  candidate_paths+=("${DEVBOX_VAULT_APP_PATH:-}")
  candidate_paths+=("secret/mingle-app/dev")
  candidate_paths+=("secret/mingle-app/prod")

  for path in "${candidate_paths[@]}"; do
    path="$(trim_whitespace "$path")"
    [[ -n "$path" ]] || continue
    if printf '%s\n' "$seen_paths" | grep -Fxq -- "$path"; then
      continue
    fi
    seen_paths="${seen_paths}${seen_paths:+$'\n'}$path"

    value="$(try_read_env_value_from_vault_path "$path" "$key" || true)"
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done

  return 1
}

derive_worktree_name() {
  local branch fallback hash
  branch="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"
  if [[ -n "$branch" ]]; then
    branch="${branch//\//-}"
    branch="${branch// /-}"
    printf '%s' "$branch"
    return
  fi

  fallback="$(basename "$(dirname "$ROOT_CANON")")"
  hash="$(printf '%s' "$ROOT_CANON" | cksum | awk '{print $1}')"
  printf '%s-%s' "$fallback" "$((hash % 100000))"
}

collect_reserved_ports() {
  RESERVED_ALL_PORTS=""

  if ! git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return
  fi

  local worktree_path worktree_canon env_file port
  while IFS= read -r worktree_path; do
    [[ -n "$worktree_path" ]] || continue
    if ! worktree_canon="$(cd "$worktree_path" 2>/dev/null && pwd -P)"; then
      continue
    fi
    [[ "$worktree_canon" == "$ROOT_CANON" ]] && continue

    env_file="$worktree_canon/.devbox.env"
    [[ -f "$env_file" ]] || continue

    for key in DEVBOX_WEB_PORT DEVBOX_STT_PORT DEVBOX_METRO_PORT DEVBOX_NGROK_API_PORT; do
      port="$(read_env_value_from_file "$key" "$env_file")"
      if is_numeric "$port"; then
        RESERVED_ALL_PORTS="$(append_port "$RESERVED_ALL_PORTS" "$port")"
      fi
    done
  done < <(git -C "$ROOT_DIR" worktree list --porcelain | awk '/^worktree /{print substr($0,10)}')
}

calc_default_ports() {
  collect_reserved_ports

  local range seed_text seed slot web stt metro ngrok_api
  range=800
  seed_text="$ROOT_CANON|$DEVBOX_WORKTREE_NAME"
  seed="$(printf '%s' "$seed_text" | cksum | awk '{print $1}')"

  for ((attempt = 0; attempt < range; attempt++)); do
    slot=$(((seed + attempt) % range))
    web=$((3200 + slot))
    stt=$((5200 + slot))
    metro=$((8200 + slot))
    ngrok_api=$((10200 + slot))

    if port_list_contains "$RESERVED_ALL_PORTS" "$web"; then
      continue
    fi
    if port_list_contains "$RESERVED_ALL_PORTS" "$stt"; then
      continue
    fi
    if port_list_contains "$RESERVED_ALL_PORTS" "$metro"; then
      continue
    fi
    if port_list_contains "$RESERVED_ALL_PORTS" "$ngrok_api"; then
      continue
    fi

    if port_in_use "$web" || port_in_use "$stt" || port_in_use "$metro" || port_in_use "$ngrok_api"; then
      continue
    fi

    DEFAULT_WEB_PORT="$web"
    DEFAULT_STT_PORT="$stt"
    DEFAULT_METRO_PORT="$metro"
    DEFAULT_NGROK_API_PORT="$ngrok_api"
    return
  done

  die "failed to allocate default ports (range exhausted: web 3200-3999, stt 5200-5999, metro 8200-8999, ngrok-api 10200-10999)"
}

ensure_file_parent() {
  local file="$1"
  mkdir -p "$(dirname "$file")"
}

find_main_worktree_root() {
  local line=""
  local worktree_path=""
  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        worktree_path="${line#worktree }"
        ;;
      branch\ refs/heads/main)
        printf '%s' "$worktree_path"
        return 0
        ;;
    esac
  done < <(git -C "$ROOT_DIR" worktree list --porcelain)
  return 1
}

file_has_non_managed_env_entries() {
  local file="$1"
  [[ -f "$file" ]] || return 1

  awk -v start="$MANAGED_START" -v end="$MANAGED_END" '
    $0 == start { in_block = 1; next }
    $0 == end { in_block = 0; next }
    !in_block && $0 ~ /^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=.*/ { found = 1; exit }
    END { exit(found ? 0 : 1) }
  ' "$file"
}

sync_env_file_from_main_if_needed() {
  local label="$1"
  local source_file="$2"
  local target_file="$3"

  [[ -f "$source_file" ]] || return 0
  [[ "$source_file" != "$target_file" ]] || return 0

  if [[ ! -f "$target_file" ]]; then
    ensure_file_parent "$target_file"
    cp "$source_file" "$target_file"
    log "seeded $label env from main worktree"
    return 0
  fi

  if file_has_non_managed_env_entries "$target_file"; then
    return 0
  fi

  if file_has_non_managed_env_entries "$source_file"; then
    cp "$source_file" "$target_file"
    log "seeded $label env from main worktree"
  fi
}

seed_env_from_main_worktree() {
  local main_root=""
  main_root="$(find_main_worktree_root || true)"
  [[ -n "$main_root" ]] || return 0
  main_root="$(cd "$main_root" 2>/dev/null && pwd -P || true)"
  [[ -n "$main_root" ]] || return 0

  sync_env_file_from_main_if_needed \
    "mingle-app" \
    "$main_root/mingle-app/.env.local" \
    "$APP_ENV_FILE"
  sync_env_file_from_main_if_needed \
    "mingle-stt" \
    "$main_root/mingle-stt/.env.local" \
    "$STT_ENV_FILE"
}

ensure_workspace_dependencies() {
  local app_next_bin="$ROOT_DIR/mingle-app/node_modules/.bin/next"
  local stt_tsnode_bin="$ROOT_DIR/mingle-stt/node_modules/.bin/ts-node"

  if [[ ! -x "$app_next_bin" ]]; then
    log "installing dependencies: mingle-app"
    pnpm --dir "$ROOT_DIR/mingle-app" install
  fi
  if [[ ! -x "$stt_tsnode_bin" ]]; then
    log "installing dependencies: mingle-stt"
    pnpm --dir "$ROOT_DIR/mingle-stt" install
  fi

  ensure_mingle_app_prisma_client
}

ensure_mingle_app_prisma_client() {
  local app_dir="$ROOT_DIR/mingle-app"
  if [[ -f "$app_dir/node_modules/.prisma/client/default.js" ]]; then
    return 0
  fi

  if ! ls "$app_dir"/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/default.js >/dev/null 2>&1; then
    log "generating prisma client: mingle-app"
    pnpm --dir "$app_dir" db:generate
  fi
}

ensure_rn_workspace_dependencies() {
  local rn_cli_bin="$ROOT_DIR/mingle-app/rn/node_modules/.bin/react-native"
  local rn_gradle_plugin_dir="$ROOT_DIR/mingle-app/rn/node_modules/@react-native/gradle-plugin"
  if [[ ! -x "$rn_cli_bin" || ! -d "$rn_gradle_plugin_dir" ]]; then
    log "installing dependencies: mingle-app/rn"
    pnpm --dir "$ROOT_DIR/mingle-app/rn" install
  fi
}

ensure_ios_pods_if_needed() {
  local ios_dir="$ROOT_DIR/mingle-app/rn/ios"
  local pods_dir="$ROOT_DIR/mingle-app/rn/ios/Pods"
  local podfile_lock="$ios_dir/Podfile.lock"
  local manifest_lock="$ios_dir/Pods/Manifest.lock"
  local bundle_cmd=""
  local needs_install=0
  local reason="already synced"

  if [[ ! -d "$pods_dir" ]]; then
    needs_install=1
    reason="Pods directory missing"
  elif [[ ! -f "$manifest_lock" ]]; then
    needs_install=1
    reason="Pods/Manifest.lock missing"
  elif [[ ! -f "$podfile_lock" ]]; then
    needs_install=1
    reason="Podfile.lock missing"
  elif ! cmp -s "$podfile_lock" "$manifest_lock"; then
    if is_truthy "${DEVBOX_ENFORCE_POD_INSTALL_ON_LOCK_MISMATCH:-0}"; then
      needs_install=1
      reason="Podfile.lock and Manifest.lock out of sync"
    else
      log "Podfile.lock and Manifest.lock out of sync; syncing Manifest.lock without pod install (set DEVBOX_ENFORCE_POD_INSTALL_ON_LOCK_MISMATCH=1 to enforce pod install)"
      cp "$podfile_lock" "$manifest_lock"
      return 0
    fi
  fi

  if [[ "$needs_install" -eq 0 ]]; then
    return 0
  fi

  log "installing iOS pods: mingle-app/rn/ios ($reason)"

  bundle_cmd="$(resolve_bundle_cmd || true)"
  if [[ -n "$bundle_cmd" ]]; then
    (
      cd "$ROOT_DIR/mingle-app/rn/ios"
      local bundle_home="$ROOT_DIR/.devbox-cache/bundle/rn"
      mkdir -p "$bundle_home"
      BUNDLE_USER_HOME="$bundle_home" \
      BUNDLE_PATH="$bundle_home" \
      BUNDLE_DISABLE_SHARED_GEMS=true \
        "$bundle_cmd" exec pod install
    )
    return 0
  fi

  if command -v pod >/dev/null 2>&1; then
    (
      cd "$ROOT_DIR/mingle-app/rn/ios"
      pod install
    )
    return 0
  fi

  die "failed to install iOS pods: neither 'bundle' nor 'pod' command is available"
}

upsert_non_managed_env_entry() {
  local file="$1"
  local key="$2"
  local value="$3"

  ensure_single_line_value "$key" "$value"
  is_valid_env_key "$key" || return 0
  ensure_file_parent "$file"

  strip_env_keys "$file" "$key"

  local formatted
  formatted="$(format_env_value_for_dotenv "$value")"

  if [[ -f "$file" && -s "$file" ]]; then
    if [[ "$(tail -c 1 "$file" 2>/dev/null || true)" != $'\n' ]]; then
      printf '\n' >> "$file"
    fi
    printf '%s=%s\n' "$key" "$formatted" >> "$file"
  else
    printf '%s=%s\n' "$key" "$formatted" > "$file"
  fi
}

decode_dotenv_value() {
  local raw="$1"
  local value
  value="$(trim_whitespace "$raw")"

  if [[ "$value" == \"*\" && "$value" == *\" && ${#value} -ge 2 ]]; then
    value="${value:1:${#value}-2}"
    value="${value//\\\"/\"}"
    value="${value//\\\\/\\}"
    value="${value//\\t/$'\t'}"
    value="${value//\\r/$'\r'}"
    value="${value//\\n/$'\n'}"
    printf '%s' "$value"
    return 0
  fi

  if [[ "$value" == \'*\' && "$value" == *\' && ${#value} -ge 2 ]]; then
    value="${value:1:${#value}-2}"
    value="$(printf '%s' "$value" | sed "s/'\"'\"'/\'/g")"
    printf '%s' "$value"
    return 0
  fi

  value="$(printf '%s' "$value" | sed -E 's/[[:space:]]+#.*$//')"
  value="$(trim_whitespace "$value")"
  printf '%s' "$value"
}

push_env_file_to_vault_path() {
  local target="$1"
  local path="$2"
  local file="$3"
  [[ -n "$path" ]] || return 0
  [[ -f "$file" ]] || {
    warn "skip vault push (${target}): env file not found: $file"
    return 0
  }

  require_cmd vault
  prepare_vault_cli_env
  local line raw_line key value_raw value count
  local -a kv_args=()
  count=0

  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    line="${raw_line%$'\r'}"
    line="$(trim_whitespace "$line")"
    [[ -n "$line" ]] || continue
    [[ "${line:0:1}" == "#" ]] && continue
    line="$(printf '%s' "$line" | sed -E 's/^export[[:space:]]+//')"
    [[ "$line" == *=* ]] || continue

    key="${line%%=*}"
    value_raw="${line#*=}"
    key="$(trim_whitespace "$key")"
    is_valid_env_key "$key" || continue
    if is_managed_key_for_target "$target" "$key"; then
      continue
    fi

    value="$(decode_dotenv_value "$value_raw")"
    ensure_single_line_value "$key" "$value"
    kv_args+=("${key}=${value}")
    count=$((count + 1))
  done < "$file"

  if [[ "$count" -eq 0 ]]; then
    log "no non-managed keys to push from ${target} env: $file"
    return 0
  fi

  log "pushing ${count} keys from ${target} env to vault path: $path"
  if vault kv patch "$path" "${kv_args[@]}" >/dev/null 2>&1; then
    log "pushed ${count} keys to vault (${target}, patch)"
    return 0
  fi

  die "failed to push ${target} env keys to vault path: $path (patch failed; refusing destructive kv put fallback)"
}

push_env_to_vault_paths() {
  local app_path="${1:-}"
  local stt_path="${2:-}"
  push_env_file_to_vault_path "app" "$app_path" "$APP_ENV_FILE"
  push_env_file_to_vault_path "stt" "$stt_path" "$STT_ENV_FILE"
}

sync_env_from_vault_path() {
  local target="$1"
  local path="$2"
  local file="$3"
  [[ -n "$path" ]] || return 0

  require_cmd vault
  require_cmd jq
  prepare_vault_cli_env

  log "syncing ${target} env from vault path: $path"

  local payload
  payload="$(vault kv get -format=json "$path")" || die "failed to read vault path: $path"

  local line key value count
  count=0
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    key="${line%%$'\t'*}"
    value="${line#*$'\t'}"
    is_valid_env_key "$key" || continue
    if is_managed_key_for_target "$target" "$key"; then
      continue
    fi
    upsert_non_managed_env_entry "$file" "$key" "$value"
    count=$((count + 1))
  done < <(
    printf '%s' "$payload" | jq -r '
      ((.data.data // .data // {}) | to_entries[]? | [.key, (.value | if type=="string" then . else tojson end)] | @tsv)
    '
  )

  normalize_file_spacing "$file"
  log "synced ${count} keys from vault (${target})"
}

sync_env_from_vault_paths() {
  local app_path="${1:-}"
  local stt_path="${2:-}"
  sync_env_from_vault_path "app" "$app_path" "$APP_ENV_FILE"
  sync_env_from_vault_path "stt" "$stt_path" "$STT_ENV_FILE"
}

write_runtime_env_from_vault_path() {
  local target="$1"
  local path="$2"
  local file="$3"

  : > "$file"
  [[ -n "$path" ]] || return 0

  require_cmd vault
  require_cmd jq
  prepare_vault_cli_env
  log "loading ${target} runtime env from vault path: $path"

  local payload
  payload="$(vault kv get -format=json "$path")" || die "failed to read vault path: $path"

  local line key value count formatted
  count=0
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    key="${line%%$'\t'*}"
    value="${line#*$'\t'}"
    is_valid_env_key "$key" || continue
    if is_managed_key_for_target "$target" "$key"; then
      continue
    fi
    ensure_single_line_value "$key" "$value"
    formatted="$(format_env_value_for_dotenv "$value")"
    printf '%s=%s\n' "$key" "$formatted" >> "$file"
    count=$((count + 1))
  done < <(
    printf '%s' "$payload" | jq -r '
      ((.data.data // .data // {}) | to_entries[]? | [.key, (.value | if type=="string" then . else tojson end)] | @tsv)
    '
  )

  log "loaded ${count} runtime keys from vault (${target})"
}

resolve_vault_paths() {
  local app_override="${1:-}"
  local stt_override="${2:-}"
  local app_path="${DEVBOX_VAULT_APP_PATH:-}"
  local stt_path="${DEVBOX_VAULT_STT_PATH:-}"
  local detected_app_path=""
  local detected_stt_path=""

  if [[ -n "$app_override" ]]; then
    app_path="$app_override"
  fi
  if [[ -n "$stt_override" ]]; then
    stt_path="$stt_override"
  fi

  if [[ -z "$app_path" ]]; then
    detected_app_path="$(auto_detect_default_vault_path "app" || true)"
    if [[ -n "$detected_app_path" ]]; then
      app_path="$detected_app_path"
      log "auto-detected vault app path: $app_path"
    fi
  fi

  if [[ -z "$stt_path" ]]; then
    detected_stt_path="$(auto_detect_default_vault_path "stt" || true)"
    if [[ -n "$detected_stt_path" ]]; then
      stt_path="$detected_stt_path"
      log "auto-detected vault stt path: $stt_path"
    fi
  fi

  DEVBOX_VAULT_APP_PATH="$app_path"
  DEVBOX_VAULT_STT_PATH="$stt_path"
}

resolve_openclaw_root() {
  local root="${DEVBOX_OPENCLAW_ROOT:-}"
  if [[ -z "$root" ]]; then
    root="$(read_app_setting_value DEVBOX_OPENCLAW_ROOT || true)"
  fi
  if [[ -z "$root" ]]; then
    root="/Users/nam/openclaw"
  fi
  printf '%s' "$root"
}

remove_managed_block() {
  local file="$1"
  local out="$2"

  if [[ -f "$file" ]]; then
    awk -v start="$MANAGED_START" -v end="$MANAGED_END" '
      $0 == start { skip = 1; next }
      $0 == end { skip = 0; next }
      !skip { print }
    ' "$file" > "$out"
  else
    : > "$out"
  fi
}

normalize_file_spacing() {
  local file="$1"
  [[ -f "$file" ]] || return 0

  local tmp
  tmp="$(mktemp)"

  # .env-like files are easiest to read with no blank lines.
  awk 'NF { print }' "$file" > "$tmp"

  mv "$tmp" "$file"
}

upsert_managed_block() {
  local file="$1"
  local block="$2"
  local tmp
  tmp="$(mktemp)"

  ensure_file_parent "$file"
  remove_managed_block "$file" "$tmp"

  if [[ -s "$tmp" ]]; then
    cat "$tmp" > "$file"
    printf '\n%s\n%s\n%s\n' "$MANAGED_START" "$block" "$MANAGED_END" >> "$file"
  else
    printf '%s\n%s\n%s\n' "$MANAGED_START" "$block" "$MANAGED_END" > "$file"
  fi

  normalize_file_spacing "$file"
  rm -f "$tmp"
}

strip_env_keys() {
  local file="$1"
  shift || true
  [[ -f "$file" ]] || return 0
  [[ "$#" -gt 0 ]] || return 0

  local key src tmp
  src="$(mktemp)"
  cp "$file" "$src"

  for key in "$@"; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "invalid env key for strip: $key"
    tmp="$(mktemp)"
    sed -E "/^[[:space:]]*(export[[:space:]]+)?${key}=.*/d" "$src" > "$tmp"
    mv "$tmp" "$src"
  done

  mv "$src" "$file"
  normalize_file_spacing "$file"
}

write_devbox_env() {
  ensure_single_line_value "DEVBOX_WORKTREE_NAME" "$DEVBOX_WORKTREE_NAME"
  ensure_single_line_value "DEVBOX_ROOT_DIR" "$ROOT_CANON"
  ensure_single_line_value "DEVBOX_WEB_PORT" "$DEVBOX_WEB_PORT"
  ensure_single_line_value "DEVBOX_STT_PORT" "$DEVBOX_STT_PORT"
  ensure_single_line_value "DEVBOX_METRO_PORT" "$DEVBOX_METRO_PORT"
  ensure_single_line_value "DEVBOX_PROFILE" "$DEVBOX_PROFILE"
  ensure_single_line_value "DEVBOX_LOCAL_HOST" "$DEVBOX_LOCAL_HOST"
  ensure_single_line_value "DEVBOX_SITE_URL" "$DEVBOX_SITE_URL"
  ensure_single_line_value "DEVBOX_RN_WS_URL" "$DEVBOX_RN_WS_URL"
  ensure_single_line_value "DEVBOX_PUBLIC_WS_URL" "$DEVBOX_PUBLIC_WS_URL"
  ensure_single_line_value "DEVBOX_TEST_API_BASE_URL" "$DEVBOX_TEST_API_BASE_URL"
  ensure_single_line_value "DEVBOX_TEST_WS_URL" "$DEVBOX_TEST_WS_URL"
  ensure_single_line_value "DEVBOX_VAULT_APP_PATH" "$DEVBOX_VAULT_APP_PATH"
  ensure_single_line_value "DEVBOX_VAULT_STT_PATH" "$DEVBOX_VAULT_STT_PATH"
  ensure_single_line_value "DEVBOX_NGROK_API_PORT" "$DEVBOX_NGROK_API_PORT"
  ensure_single_line_value "DEVBOX_OPENCLAW_ROOT" "$DEVBOX_OPENCLAW_ROOT"
  ensure_single_line_value "DEVBOX_IOS_TEAM_ID" "$DEVBOX_IOS_TEAM_ID"

  cat > "$DEVBOX_ENV_FILE" <<EOF
DEVBOX_WORKTREE_NAME=$DEVBOX_WORKTREE_NAME
DEVBOX_ROOT_DIR=$ROOT_CANON
DEVBOX_WEB_PORT=$DEVBOX_WEB_PORT
DEVBOX_STT_PORT=$DEVBOX_STT_PORT
DEVBOX_METRO_PORT=$DEVBOX_METRO_PORT
DEVBOX_PROFILE=$DEVBOX_PROFILE
DEVBOX_LOCAL_HOST=$DEVBOX_LOCAL_HOST
DEVBOX_SITE_URL=$DEVBOX_SITE_URL
DEVBOX_RN_WS_URL=$DEVBOX_RN_WS_URL
DEVBOX_PUBLIC_WS_URL=$DEVBOX_PUBLIC_WS_URL
DEVBOX_TEST_API_BASE_URL=$DEVBOX_TEST_API_BASE_URL
DEVBOX_TEST_WS_URL=$DEVBOX_TEST_WS_URL
DEVBOX_VAULT_APP_PATH=$DEVBOX_VAULT_APP_PATH
DEVBOX_VAULT_STT_PATH=$DEVBOX_VAULT_STT_PATH
DEVBOX_NGROK_API_PORT=$DEVBOX_NGROK_API_PORT
DEVBOX_OPENCLAW_ROOT=$DEVBOX_OPENCLAW_ROOT
DEVBOX_IOS_TEAM_ID=$DEVBOX_IOS_TEAM_ID
EOF
}

load_devbox_env() {
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "${line:0:1}" == "#" ]] && continue
    [[ "$line" == *=* ]] || die "invalid line in $DEVBOX_ENV_FILE: $line"

    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Z0-9_]+$ ]] || die "invalid key in $DEVBOX_ENV_FILE: $key"

    case "$key" in
      DEVBOX_WORKTREE_NAME|DEVBOX_ROOT_DIR|DEVBOX_WEB_PORT|DEVBOX_STT_PORT|DEVBOX_METRO_PORT|DEVBOX_PROFILE|DEVBOX_LOCAL_HOST|DEVBOX_SITE_URL|DEVBOX_RN_WS_URL|DEVBOX_PUBLIC_WS_URL|DEVBOX_TEST_API_BASE_URL|DEVBOX_TEST_WS_URL|DEVBOX_VAULT_APP_PATH|DEVBOX_VAULT_STT_PATH|DEVBOX_NGROK_API_PORT|DEVBOX_OPENCLAW_ROOT|DEVBOX_IOS_TEAM_ID)
        printf -v "$key" '%s' "$value"
        ;;
      *)
        die "unknown key in $DEVBOX_ENV_FILE: $key"
        ;;
    esac
  done < "$DEVBOX_ENV_FILE"
}

require_devbox_env() {
  local value=""

  if is_truthy "${DEVBOX_PERSIST_ENV_FILE:-0}" && [[ -f "$DEVBOX_ENV_FILE" ]]; then
    load_devbox_env
  fi

  if [[ -z "$DEVBOX_WORKTREE_NAME" ]]; then
    DEVBOX_WORKTREE_NAME="$(derive_worktree_name)"
  fi

  if [[ -z "${DEVBOX_VAULT_APP_PATH:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_VAULT_APP_PATH || true)")"
    [[ -n "$value" ]] && DEVBOX_VAULT_APP_PATH="$value"
  fi
  if [[ -z "${DEVBOX_VAULT_STT_PATH:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_VAULT_STT_PATH || true)")"
    [[ -n "$value" ]] && DEVBOX_VAULT_STT_PATH="$value"
  fi
  resolve_vault_paths "$DEVBOX_VAULT_APP_PATH" "$DEVBOX_VAULT_STT_PATH"

  if [[ -z "${DEVBOX_OPENCLAW_ROOT:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_OPENCLAW_ROOT || true)")"
    [[ -n "$value" ]] && DEVBOX_OPENCLAW_ROOT="$value"
  fi
  if [[ -z "${DEVBOX_OPENCLAW_ROOT:-}" ]]; then
    DEVBOX_OPENCLAW_ROOT="$(resolve_openclaw_root)"
  fi

  calc_default_ports

  if [[ -z "${DEVBOX_WEB_PORT:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_WEB_PORT || true)")"
    [[ -n "$value" ]] && DEVBOX_WEB_PORT="$value"
  fi
  if [[ -z "${DEVBOX_STT_PORT:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_STT_PORT || true)")"
    [[ -n "$value" ]] && DEVBOX_STT_PORT="$value"
  fi
  if [[ -z "${DEVBOX_METRO_PORT:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_METRO_PORT || true)")"
    [[ -n "$value" ]] && DEVBOX_METRO_PORT="$value"
  fi
  if [[ -z "${DEVBOX_NGROK_API_PORT:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_NGROK_API_PORT || true)")"
    [[ -n "$value" ]] && DEVBOX_NGROK_API_PORT="$value"
  fi

  [[ -n "${DEVBOX_WEB_PORT:-}" ]] || DEVBOX_WEB_PORT="$DEFAULT_WEB_PORT"
  [[ -n "${DEVBOX_STT_PORT:-}" ]] || DEVBOX_STT_PORT="$DEFAULT_STT_PORT"
  [[ -n "${DEVBOX_METRO_PORT:-}" ]] || DEVBOX_METRO_PORT="$DEFAULT_METRO_PORT"

  if [[ -z "${DEVBOX_PROFILE:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_PROFILE || true)")"
    [[ -n "$value" ]] && DEVBOX_PROFILE="$value"
  fi
  [[ -n "${DEVBOX_PROFILE:-}" ]] || DEVBOX_PROFILE="local"

  if [[ -z "${DEVBOX_LOCAL_HOST:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_LOCAL_HOST || true)")"
    [[ -n "$value" ]] && DEVBOX_LOCAL_HOST="$value"
  fi
  [[ -n "${DEVBOX_LOCAL_HOST:-}" ]] || DEVBOX_LOCAL_HOST="127.0.0.1"

  if [[ -z "${DEVBOX_SITE_URL:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_SITE_URL || true)")"
    [[ -n "$value" ]] && DEVBOX_SITE_URL="$value"
  fi
  if [[ -z "${DEVBOX_RN_WS_URL:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_RN_WS_URL || true)")"
    [[ -n "$value" ]] && DEVBOX_RN_WS_URL="$value"
  fi
  if [[ -z "${DEVBOX_PUBLIC_WS_URL:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_PUBLIC_WS_URL || true)")"
    [[ -n "$value" ]] && DEVBOX_PUBLIC_WS_URL="$value"
  fi
  if [[ -z "${DEVBOX_TEST_API_BASE_URL:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_TEST_API_BASE_URL || true)")"
    [[ -n "$value" ]] && DEVBOX_TEST_API_BASE_URL="$value"
  fi
  if [[ -z "${DEVBOX_TEST_WS_URL:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_TEST_WS_URL || true)")"
    [[ -n "$value" ]] && DEVBOX_TEST_WS_URL="$value"
  fi

  if [[ -z "${DEVBOX_IOS_TEAM_ID:-}" ]]; then
    value="$(trim_whitespace "$(read_app_setting_value DEVBOX_IOS_TEAM_ID || true)")"
    [[ -n "$value" ]] && DEVBOX_IOS_TEAM_ID="$value"
  fi

  : "${DEVBOX_WORKTREE_NAME:?missing DEVBOX_WORKTREE_NAME}"
  : "${DEVBOX_WEB_PORT:?missing DEVBOX_WEB_PORT}"
  : "${DEVBOX_STT_PORT:?missing DEVBOX_STT_PORT}"
  : "${DEVBOX_METRO_PORT:?missing DEVBOX_METRO_PORT}"
  if [[ -z "${DEVBOX_NGROK_API_PORT:-}" ]]; then
    DEVBOX_NGROK_API_PORT="$((DEVBOX_WEB_PORT + 7000))"
  fi
  : "${DEVBOX_PROFILE:?missing DEVBOX_PROFILE}"
  case "$DEVBOX_PROFILE" in
    local|device) ;;
    *) die "invalid DEVBOX_PROFILE: $DEVBOX_PROFILE (expected local|device)" ;;
  esac
  if [[ -z "${DEVBOX_SITE_URL:-}" ]]; then
    DEVBOX_SITE_URL="http://$DEVBOX_LOCAL_HOST:$DEVBOX_WEB_PORT"
  fi
  if [[ -z "${DEVBOX_RN_WS_URL:-}" ]]; then
    DEVBOX_RN_WS_URL="ws://$DEVBOX_LOCAL_HOST:$DEVBOX_STT_PORT"
  fi
  if [[ -z "${DEVBOX_PUBLIC_WS_URL:-}" && "$DEVBOX_PROFILE" == "device" ]]; then
    DEVBOX_PUBLIC_WS_URL="$DEVBOX_RN_WS_URL"
  fi
  if [[ -z "${DEVBOX_TEST_API_BASE_URL:-}" ]]; then
    DEVBOX_TEST_API_BASE_URL="http://127.0.0.1:$DEVBOX_WEB_PORT"
  fi
  if [[ -z "${DEVBOX_TEST_WS_URL:-}" ]]; then
    DEVBOX_TEST_WS_URL="ws://127.0.0.1:$DEVBOX_STT_PORT"
  fi
  : "${DEVBOX_SITE_URL:?missing DEVBOX_SITE_URL}"
  : "${DEVBOX_RN_WS_URL:?missing DEVBOX_RN_WS_URL}"
  : "${DEVBOX_TEST_API_BASE_URL:?missing DEVBOX_TEST_API_BASE_URL}"
  : "${DEVBOX_TEST_WS_URL:?missing DEVBOX_TEST_WS_URL}"

  validate_port "DEVBOX_WEB_PORT" "$DEVBOX_WEB_PORT"
  validate_port "DEVBOX_STT_PORT" "$DEVBOX_STT_PORT"
  validate_port "DEVBOX_METRO_PORT" "$DEVBOX_METRO_PORT"
  validate_port "DEVBOX_NGROK_API_PORT" "$DEVBOX_NGROK_API_PORT"
  validate_http_url "DEVBOX_SITE_URL" "$DEVBOX_SITE_URL"
  validate_ws_url "DEVBOX_RN_WS_URL" "$DEVBOX_RN_WS_URL"
  if [[ -n "$DEVBOX_PUBLIC_WS_URL" ]]; then
    validate_ws_url "DEVBOX_PUBLIC_WS_URL" "$DEVBOX_PUBLIC_WS_URL"
  fi
  validate_http_url "DEVBOX_TEST_API_BASE_URL" "$DEVBOX_TEST_API_BASE_URL"
  validate_ws_url "DEVBOX_TEST_WS_URL" "$DEVBOX_TEST_WS_URL"

  if [[ "$DEVBOX_PROFILE" == "local" ]]; then
    validate_host "$DEVBOX_LOCAL_HOST"
  fi
}

write_app_env_block() {
  local block
  strip_env_keys "$APP_ENV_FILE" "${APP_MANAGED_KEYS[@]}"

  block="$(cat <<EOF
DEVBOX_WORKTREE_NAME=$DEVBOX_WORKTREE_NAME
DEVBOX_PROFILE=$DEVBOX_PROFILE
DEVBOX_WEB_PORT=$DEVBOX_WEB_PORT
DEVBOX_STT_PORT=$DEVBOX_STT_PORT
DEVBOX_METRO_PORT=$DEVBOX_METRO_PORT
NEXT_PUBLIC_SITE_URL=$DEVBOX_SITE_URL
NEXTAUTH_URL=$DEVBOX_SITE_URL
NEXT_PUBLIC_WS_PORT=$DEVBOX_STT_PORT
NEXT_PUBLIC_WS_URL=$DEVBOX_PUBLIC_WS_URL
NEXT_PUBLIC_API_NAMESPACE=$IOS_RN_REQUIRED_API_NAMESPACE
MINGLE_TEST_API_BASE_URL=$DEVBOX_TEST_API_BASE_URL
MINGLE_TEST_WS_URL=$DEVBOX_TEST_WS_URL
EOF
)"

  upsert_managed_block "$APP_ENV_FILE" "$block"
}

build_devbox_nextauth_secret() {
  local checksum
  checksum="$(printf '%s' "${ROOT_CANON}|${DEVBOX_WORKTREE_NAME}|${DEVBOX_WEB_PORT}" | cksum | awk '{print $1}')"
  printf 'devbox-nextauth-%s-%s' "$DEVBOX_WORKTREE_NAME" "$checksum"
}

ensure_devbox_nextauth_secret() {
  local existing_nextauth_secret existing_auth_secret
  existing_nextauth_secret="$(read_env_value_from_file NEXTAUTH_SECRET "$APP_ENV_FILE")"
  existing_auth_secret="$(read_env_value_from_file AUTH_SECRET "$APP_ENV_FILE")"
  if [[ -n "$existing_nextauth_secret" || -n "$existing_auth_secret" ]]; then
    return 0
  fi

  upsert_non_managed_env_entry "$APP_ENV_FILE" "NEXTAUTH_SECRET" "$(build_devbox_nextauth_secret)"
}

resolve_runtime_nextauth_secret() {
  local runtime_file="$1"
  local value=""

  value="$(read_env_value_from_file NEXTAUTH_SECRET "$runtime_file")"
  if [[ -z "$value" ]]; then
    value="$(read_env_value_from_file AUTH_SECRET "$runtime_file")"
  fi
  if [[ -z "$value" ]]; then
    value="$(read_env_value_from_file NEXTAUTH_SECRET "$APP_ENV_FILE")"
  fi
  if [[ -z "$value" ]]; then
    value="$(read_env_value_from_file AUTH_SECRET "$APP_ENV_FILE")"
  fi
  if [[ -z "$value" ]]; then
    value="$(build_devbox_nextauth_secret)"
  fi

  ensure_single_line_value "NEXTAUTH_SECRET" "$value"
  printf '%s' "$value"
}

write_stt_env_block() {
  local block
  strip_env_keys "$STT_ENV_FILE" "${STT_MANAGED_KEYS[@]}"

  block="$(cat <<EOF
DEVBOX_WORKTREE_NAME=$DEVBOX_WORKTREE_NAME
DEVBOX_PROFILE=$DEVBOX_PROFILE
PORT=$DEVBOX_STT_PORT
EOF
)"

  upsert_managed_block "$STT_ENV_FILE" "$block"
}

resolve_ngrok_web_domain() {
  local raw=""
  local domain=""
  raw="$(read_app_setting_value DEVBOX_NGROK_WEB_DOMAIN || true)"
  domain="$(normalize_domain_input "$raw")"
  [[ -n "$domain" ]] || return 1
  validate_host "$domain"
  printf '%s' "$domain"
}

write_ngrok_local_config() {
  local ngrok_web_domain=""
  ngrok_web_domain="$(resolve_ngrok_web_domain || true)"

  cat > "$NGROK_LOCAL_CONFIG" <<EOF
version: "3"
agent:
  web_addr: 127.0.0.1:$DEVBOX_NGROK_API_PORT
tunnels:
  devbox_web:
    addr: $DEVBOX_WEB_PORT
    proto: http
EOF

  if [[ -n "$ngrok_web_domain" ]]; then
    cat >> "$NGROK_LOCAL_CONFIG" <<EOF
    domain: $ngrok_web_domain
EOF
  fi

  cat >> "$NGROK_LOCAL_CONFIG" <<EOF
  devbox_stt:
    addr: $DEVBOX_STT_PORT
    proto: http
EOF
}

write_rn_ios_runtime_xcconfig() {
  local site_scheme="${DEVBOX_SITE_URL%%://*}"
  local site_host="${DEVBOX_SITE_URL#*://}"
  local ws_scheme="${DEVBOX_RN_WS_URL%%://*}"
  local ws_host="${DEVBOX_RN_WS_URL#*://}"
  local escaped_site_url="$DEVBOX_SITE_URL"
  local escaped_ws_url="$DEVBOX_RN_WS_URL"
  escaped_site_url="${escaped_site_url//\\/\\\\}"
  escaped_site_url="${escaped_site_url//\"/\\\"}"
  escaped_site_url="${escaped_site_url//\//\\/}"
  escaped_ws_url="${escaped_ws_url//\\/\\\\}"
  escaped_ws_url="${escaped_ws_url//\"/\\\"}"
  escaped_ws_url="${escaped_ws_url//\//\\/}"

  cat > "$RN_IOS_RUNTIME_XCCONFIG" <<EOF
// Auto-generated by scripts/devbox.
// iOS RN runtime endpoints for this worktree/profile.
NEXT_PUBLIC_SITE_URL = "$escaped_site_url"
NEXT_PUBLIC_WS_URL = "$escaped_ws_url"
NEXT_PUBLIC_SITE_SCHEME = $site_scheme
NEXT_PUBLIC_SITE_HOST = $site_host
NEXT_PUBLIC_WS_SCHEME = $ws_scheme
NEXT_PUBLIC_WS_HOST = $ws_host
NEXT_PUBLIC_API_NAMESPACE = $IOS_RN_REQUIRED_API_NAMESPACE
EOF
}

refresh_runtime_files() {
  # Default runtime refresh is stateless for app/stt dotenv files.
  # Keep ngrok/xcconfig outputs up-to-date for current run/install.
  write_ngrok_local_config
  write_rn_ios_runtime_xcconfig
}

set_local_profile_values() {
  local host="$1"
  validate_host "$host"

  DEVBOX_PROFILE="local"
  DEVBOX_LOCAL_HOST="$host"
  DEVBOX_SITE_URL="http://$host:$DEVBOX_WEB_PORT"
  DEVBOX_RN_WS_URL="ws://$host:$DEVBOX_STT_PORT"
  DEVBOX_PUBLIC_WS_URL=""
  DEVBOX_TEST_API_BASE_URL="http://127.0.0.1:$DEVBOX_WEB_PORT"
  DEVBOX_TEST_WS_URL="ws://127.0.0.1:$DEVBOX_STT_PORT"
}

to_wss_url() {
  local input="$1"
  case "$input" in
    https://*) printf 'wss://%s' "${input#https://}" ;;
    http://*) printf 'ws://%s' "${input#http://}" ;;
    ws://*|wss://*) printf '%s' "$input" ;;
    *) die "unsupported websocket url format: $input" ;;
  esac
}

ngrok_plan_capacity_hint() {
  cat <<'EOF'
hint: ngrok free plan limits can vary by account generation (often 1~3 online endpoints).
      devbox device profile uses 2 endpoints (web+stt) per worktree.
      verify your exact limits from ngrok dashboard usage/billing pages.
EOF
}

escape_for_osascript_string() {
  local input="$1"
  input="${input//\\/\\\\}"
  input="${input//\"/\\\"}"
  printf '%s' "$input"
}

build_ngrok_launch_command() {
  local root_q
  root_q="$(printf '%q' "$ROOT_DIR")"
  printf 'cd %s && scripts/ngrok-start-mobile.sh --log stdout --log-format logfmt' "$root_q"
}

launch_ngrok_in_iterm_app() {
  local app_name="$1"
  local command_text="$2"
  local escaped_command
  escaped_command="$(escape_for_osascript_string "$command_text")"

  osascript >/dev/null <<EOF
tell application "$app_name"
  activate
  if (count of windows) = 0 then
    create window with default profile
  end if
  tell current window
    tell current session
      set newSession to (split vertically with default profile)
    end tell
    tell newSession
      write text "$escaped_command"
    end tell
  end tell
end tell
EOF
}

launch_ngrok_in_terminal_app() {
  local command_text="$1"
  local escaped_command
  escaped_command="$(escape_for_osascript_string "$command_text")"

  osascript >/dev/null <<EOF
tell application "Terminal"
  activate
  do script "$escaped_command"
end tell
EOF
}

launch_ngrok_in_separate_terminal() {
  local ngrok_command
  ngrok_command="$(build_ngrok_launch_command)"

  command -v osascript >/dev/null 2>&1 || return 1

  case "${TERM_PROGRAM:-}" in
    iTerm.app)
      launch_ngrok_in_iterm_app "iTerm2" "$ngrok_command" \
        || launch_ngrok_in_iterm_app "iTerm" "$ngrok_command"
      ;;
    Apple_Terminal)
      launch_ngrok_in_terminal_app "$ngrok_command"
      ;;
    *)
      return 1
      ;;
  esac
}

normalize_ios_configuration() {
  local raw="${1:-Release}"
  case "$raw" in
    Debug|debug) printf 'Debug' ;;
    Release|release) printf 'Release' ;;
    *) die "invalid --ios-configuration: $raw (expected Debug|Release)" ;;
  esac
}

normalize_ios_runtime() {
  local raw="${1:-rn}"
  local lowered
  lowered="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$lowered" in
    rn) printf 'rn' ;;
    native) printf 'native' ;;
    both) printf 'both' ;;
    *) die "invalid --ios-runtime: $raw (expected rn|native|both)" ;;
  esac
}

normalize_ios_native_target() {
  local raw="${1:-device}"
  local lowered
  lowered="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$lowered" in
    device) printf 'device' ;;
    simulator|sim) printf 'simulator' ;;
    *) die "invalid --ios-native-target: $raw (expected device|simulator)" ;;
  esac
}

normalize_android_variant() {
  local raw="${1:-release}"
  case "$raw" in
    debug|Debug) printf 'debug' ;;
    release|Release) printf 'release' ;;
    *) die "invalid --android-variant: $raw (expected debug|release)" ;;
  esac
}

normalize_tunnel_provider() {
  local raw="${1:-ngrok}"
  local lowered
  lowered="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$lowered" in
    ngrok) printf 'ngrok' ;;
    cloudflare|cloudflared|cf) printf 'cloudflare' ;;
    *)
      die "invalid tunnel provider: $raw (expected ngrok|cloudflare)"
      ;;
  esac
}

resolve_tunnel_provider() {
  local override="${1:-}"
  local raw="$override"

  if [[ -z "$raw" ]]; then
    raw="${DEVBOX_TUNNEL_PROVIDER:-}"
  fi
  if [[ -z "$raw" ]]; then
    raw="$(trim_whitespace "$(read_app_setting_value DEVBOX_TUNNEL_PROVIDER || true)")"
  fi
  if [[ -z "$raw" ]]; then
    raw="ngrok"
  fi

  normalize_tunnel_provider "$raw"
}

cloudflared_named_pid_file_path() {
  local worktree="${DEVBOX_WORKTREE_NAME:-$(derive_worktree_name)}"
  worktree="${worktree//[^A-Za-z0-9._-]/-}"
  printf '%s/.devbox-cache/cloudflared/%s.named.pid' "$ROOT_DIR" "$worktree"
}

cloudflared_named_log_file_path() {
  local worktree="${DEVBOX_WORKTREE_NAME:-$(derive_worktree_name)}"
  worktree="${worktree//[^A-Za-z0-9._-]/-}"
  printf '%s/.devbox-cache/cloudflared/%s.named.log' "$ROOT_DIR" "$worktree"
}

resolve_cloudflare_named_tunnel_settings() {
  local token web_host stt_host
  token="$(trim_whitespace "${DEVBOX_CLOUDFLARE_TUNNEL_TOKEN:-}")"
  web_host="$(trim_whitespace "${DEVBOX_CLOUDFLARE_WEB_HOSTNAME:-}")"
  stt_host="$(trim_whitespace "${DEVBOX_CLOUDFLARE_STT_HOSTNAME:-}")"

  if [[ -z "$token" ]]; then
    token="$(trim_whitespace "$(read_app_setting_value DEVBOX_CLOUDFLARE_TUNNEL_TOKEN || true)")"
  fi
  if [[ -z "$web_host" ]]; then
    web_host="$(trim_whitespace "$(read_app_setting_value DEVBOX_CLOUDFLARE_WEB_HOSTNAME || true)")"
  fi
  if [[ -z "$stt_host" ]]; then
    stt_host="$(trim_whitespace "$(read_app_setting_value DEVBOX_CLOUDFLARE_STT_HOSTNAME || true)")"
  fi

  if [[ -z "$token" && -z "$web_host" && -z "$stt_host" ]]; then
    return 1
  fi

  [[ -n "$token" ]] || die "missing DEVBOX_CLOUDFLARE_TUNNEL_TOKEN for named tunnel mode"
  [[ -n "$web_host" ]] || die "missing DEVBOX_CLOUDFLARE_WEB_HOSTNAME for named tunnel mode"
  [[ -n "$stt_host" ]] || die "missing DEVBOX_CLOUDFLARE_STT_HOSTNAME for named tunnel mode"

  web_host="$(normalize_domain_input "$web_host")"
  stt_host="$(normalize_domain_input "$stt_host")"
  validate_host "$web_host"
  validate_host "$stt_host"
  ensure_single_line_value "DEVBOX_CLOUDFLARE_TUNNEL_TOKEN" "$token"

  printf '%s\n%s\n%s\n' "$token" "$web_host" "$stt_host"
}

resolve_cloudflare_named_hostnames() {
  local web_host stt_host
  web_host="$(trim_whitespace "${DEVBOX_CLOUDFLARE_WEB_HOSTNAME:-}")"
  stt_host="$(trim_whitespace "${DEVBOX_CLOUDFLARE_STT_HOSTNAME:-}")"

  if [[ -z "$web_host" ]]; then
    web_host="$(trim_whitespace "$(read_app_setting_value DEVBOX_CLOUDFLARE_WEB_HOSTNAME || true)")"
  fi
  if [[ -z "$stt_host" ]]; then
    stt_host="$(trim_whitespace "$(read_app_setting_value DEVBOX_CLOUDFLARE_STT_HOSTNAME || true)")"
  fi

  if [[ -z "$web_host" && -z "$stt_host" ]]; then
    return 1
  fi

  [[ -n "$web_host" ]] || die "missing DEVBOX_CLOUDFLARE_WEB_HOSTNAME for cloudflare named host profile"
  [[ -n "$stt_host" ]] || die "missing DEVBOX_CLOUDFLARE_STT_HOSTNAME for cloudflare named host profile"

  web_host="$(normalize_domain_input "$web_host")"
  stt_host="$(normalize_domain_input "$stt_host")"
  validate_host "$web_host"
  validate_host "$stt_host"

  printf '%s\n%s\n' "$web_host" "$stt_host"
}

wait_for_cloudflared_named_tunnel() {
  local log_file="$1"
  local pid="$2"
  local timeout_sec="${3:-20}"
  local elapsed=0
  local ready_pattern='Registered tunnel connection\|Connection .* registered\|Initial protocol'

  while (( elapsed < timeout_sec )); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 1
    fi
    if [[ -f "$log_file" ]] && grep -Eq "$ready_pattern" "$log_file"; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

stop_cloudflared_named_tunnel_from_pidfile() {
  local pid_file
  local pid

  pid_file="$(cloudflared_named_pid_file_path)"
  [[ -f "$pid_file" ]] || return 0

  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    log "stopping cloudflared named tunnel connector (pid: $pid)"
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi

  rm -f "$pid_file"
}

detect_ios_coredevice_id() {
  command -v xcrun >/dev/null 2>&1 || return 1
  xcrun devicectl list devices 2>/dev/null | awk '
      /connected|available \(paired\)/ {
        if (match($0, /[0-9A-F-]{20,40}/)) {
          id = substr($0, RSTART, RLENGTH)
          if ($0 ~ / connected/) {
            print id
            exit
          }
          if (first == "") first = id
        }
      }
      END {
        if (first != "") print first
      }
    ' | head -n 1
}

detect_ios_xcode_destination_udid() {
  command -v xcodebuild >/dev/null 2>&1 || return 1
  local workspace="$ROOT_DIR/mingle-app/rn/ios/mingle.xcworkspace"
  local destination_udid=""
  [[ -d "$workspace" ]] || return 1

  destination_udid="$(
    xcodebuild \
      -workspace "$workspace" \
      -scheme mingle \
      -showdestinations 2>&1 | awk '
      /platform:iOS/ && /id:/ && /name:/ {
        line = $0
        if (line ~ /platform:iOS Simulator/) next
        if (line ~ /Any iOS Device/) next
        if (line ~ /error:[^,}]*not connected/) next
        id = ""
        if (match(line, /id:[^,}]+/)) {
          id = substr(line, RSTART + 3, RLENGTH - 3)
          gsub(/[[:space:]]/, "", id)
        }
        if (id == "" || id ~ /placeholder/) next
        print id
        exit
      }
    ' || true
  )"

  if [[ -n "$destination_udid" ]]; then
    printf '%s' "$destination_udid"
    return 0
  fi

  command -v xcrun >/dev/null 2>&1 || return 1
  xcrun xctrace list devices 2>/dev/null | awk '
    /^== Devices ==/ { in_devices = 1; next }
    /^== Simulators ==/ { in_devices = 0 }
    !in_devices { next }
    {
      line = $0
      if (line ~ /MacBook|^Mac /) next
      if (match(line, /\([0-9A-F-]{20,40}\)[[:space:]]*$/)) {
        id = substr(line, RSTART + 1, RLENGTH - 2)
        print id
        exit
      }
    }
  '
}

detect_ios_device_udid() {
  # Backward-compatible alias used by native paths.
  # For RN xcodebuild destination, use detect_ios_xcode_destination_udid.
  local coredevice_id=""
  coredevice_id="$(
    xcrun devicectl list devices 2>/dev/null | awk '
      /connected|available \(paired\)/ {
        if (match($0, /[0-9A-F-]{20,40}/)) {
          id = substr($0, RSTART, RLENGTH)
          if ($0 ~ / connected/) {
            print id
            exit
          }
          if (first == "") first = id
        }
      }
      END {
        if (first != "") print first
      }
    ' | head -n 1
  )"
  if [[ -n "$coredevice_id" ]]; then
    printf '%s' "$coredevice_id"
    return 0
  fi

  detect_ios_xcode_destination_udid || true
}

detect_android_device_serial() {
  command -v adb >/dev/null 2>&1 || return 1
  adb devices | awk 'NR > 1 && $2 == "device" { print $1; exit }'
}

resolve_ios_bundle_id() {
  local project_file="$ROOT_DIR/mingle-app/rn/ios/mingle.xcodeproj/project.pbxproj"
  if [[ -f "$project_file" ]]; then
    awk -F'= ' '/PRODUCT_BUNDLE_IDENTIFIER = /{gsub(/;$/, "", $2); print $2; exit}' "$project_file"
    return 0
  fi
  printf '%s' "com.mingle"
}

resolve_rn_ios_development_team() {
  local project_file="$ROOT_DIR/mingle-app/rn/ios/mingle.xcodeproj/project.pbxproj"
  if [[ -f "$project_file" ]]; then
    awk -F'= ' '/DEVELOPMENT_TEAM = /{gsub(/;$/, "", $2); print $2; exit}' "$project_file"
    return 0
  fi
  printf '%s' ""
}

resolve_android_application_id() {
  local gradle_file="$ROOT_DIR/mingle-app/rn/android/app/build.gradle"
  if [[ -f "$gradle_file" ]]; then
    awk -F'"' '/applicationId[[:space:]]+"/{print $2; exit}' "$gradle_file"
    return 0
  fi
  printf '%s' "com.mingle"
}

resolve_ios_simulator_udid_for_uninstall() {
  local requested_name="${1:-iPhone 16}"
  local requested_udid="${2:-}"
  local simctl_devices=""

  simctl_devices="$(xcrun simctl list devices available 2>/dev/null)" || \
    die "CoreSimulator is unavailable. Open Simulator once and retry."

  if [[ -n "$requested_udid" ]]; then
    local matched
    matched="$(
      printf '%s\n' "$simctl_devices" | awk -v udid="$requested_udid" '
        {
          line = $0
          sub(/^[[:space:]]+/, "", line)
          if (line !~ /\(Booted\)|\(Shutdown\)|\(Shutdown \(SimDiskImageMounting\)\)/) next
          if (line !~ /iPhone / && line !~ /iPad /) next
          if (match(line, /\([0-9A-F-]+\)/)) {
            candidate = substr(line, RSTART + 1, RLENGTH - 2)
            if (candidate == udid) {
              print candidate
              exit
            }
          }
        }
      '
    )"
    [[ -n "$matched" ]] || die "SIMULATOR_UDID '$requested_udid' is not available."
    printf '%s' "$requested_udid"
    return 0
  fi

  local candidates=""
  candidates="$(
    printf '%s\n' "$simctl_devices" | awk -v name="$requested_name" '
      {
        line = $0
        sub(/^[[:space:]]+/, "", line)
        if (index(line, name " (") != 1) next
        if (line !~ /\(Booted\)|\(Shutdown\)|\(Shutdown \(SimDiskImageMounting\)\)/) next
        if (line !~ /iPhone / && line !~ /iPad /) next
        if (match(line, /\([0-9A-F-]+\)/)) {
          udid = substr(line, RSTART + 1, RLENGTH - 2)
          print line " :: " udid
        }
      }
    '
  )"

  local count
  count="$(printf '%s\n' "$candidates" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [[ "$count" == "1" ]]; then
    printf '%s\n' "$candidates" | awk -F' :: ' 'NR == 1 { print $2 }'
    return 0
  fi
  if [[ "$count" -gt 1 ]]; then
    die "multiple simulators match '$requested_name'; specify --ios-simulator-udid explicitly.
$(printf '%s\n' "$candidates" | sed -n '1,20p')"
  fi

  die "no available simulator matched '$requested_name'. Use --ios-simulator-udid or check: xcrun simctl list devices available"
}

run_ios_mobile_install() {
  local requested_udid="${1:-}"
  local configuration="$2"
  local with_clean_install="${3:-0}"
  local destination_udid="$requested_udid"
  local coredevice_id=""

  if [[ -z "$destination_udid" ]]; then
    destination_udid="$(detect_ios_xcode_destination_udid || true)"
  fi

  if [[ -z "$destination_udid" ]]; then
    log "iOS device not detected; skipping iOS build/install"
    return 0
  fi
  coredevice_id="$(detect_ios_coredevice_id || true)"
  if [[ -z "$coredevice_id" ]]; then
    # Fallback for environments where only xcodebuild destination id is visible.
    coredevice_id="$destination_udid"
  fi

  require_cmd xcodebuild
  require_cmd xcrun
  ensure_rn_workspace_dependencies
  ensure_ios_pods_if_needed

  local derived_data_path="$ROOT_DIR/.devbox-cache/ios/$DEVBOX_WORKTREE_NAME"
  local app_path="$derived_data_path/Build/Products/${configuration}-iphoneos/mingle.app"
  local bundle_id
  bundle_id="$(resolve_ios_bundle_id)"

  if [[ "$with_clean_install" -eq 1 && -n "$bundle_id" ]]; then
    log "uninstalling existing iOS app before reinstall: $bundle_id (device=$coredevice_id)"
    xcrun devicectl device uninstall app --device "$coredevice_id" "$bundle_id" || \
      log "iOS uninstall skipped (app may not be installed)"
  fi

  if [[ "$with_clean_install" -eq 1 ]]; then
    log "cleaning iOS build artifacts for consistent runtime injection: $derived_data_path"
    rm -rf "$derived_data_path"
  fi

  write_rn_ios_runtime_xcconfig

  mkdir -p "$(dirname "$derived_data_path")"

  log "building iOS app ($configuration) for destination: $destination_udid"
  (
    cd "$ROOT_DIR/mingle-app/rn/ios"
    NEXT_PUBLIC_API_NAMESPACE="$IOS_RN_REQUIRED_API_NAMESPACE" \
    xcodebuild \
      -workspace mingle.xcworkspace \
      -scheme mingle \
      -configuration "$configuration" \
      -destination "id=$destination_udid" \
      -derivedDataPath "$derived_data_path" \
      -xcconfig "$RN_IOS_RUNTIME_XCCONFIG" \
      build
  )

  [[ -d "$app_path" ]] || die "built iOS app not found: $app_path"

  log "installing iOS app on device: $coredevice_id"
  xcrun devicectl device install app --device "$coredevice_id" "$app_path"

  if [[ -n "$bundle_id" ]]; then
    log "launching iOS app bundle: $bundle_id"
    xcrun devicectl device process launch --device "$coredevice_id" "$bundle_id" >/dev/null 2>&1 || \
      log "iOS app launch skipped (manual launch may be required)"
  fi
}

run_native_ios_mobile_install() {
  local requested_coredevice_id="${1:-}"
  local configuration="$2"
  local with_clean_install="${3:-0}"
  local bundle_id="${4:-com.nam.mingleios}"

  [[ -x "$MINGLE_IOS_INSTALL_SCRIPT" ]] || die "native iOS install script not found: $MINGLE_IOS_INSTALL_SCRIPT"
  require_cmd xcodebuild
  require_cmd xcrun
  require_cmd xcodegen

  local coredevice_id="$requested_coredevice_id"
  if [[ -z "$coredevice_id" ]]; then
    coredevice_id="$(detect_ios_coredevice_id || true)"
  fi

  if [[ "$with_clean_install" -eq 1 && -n "$bundle_id" && -n "$coredevice_id" ]]; then
    log "uninstalling existing native iOS app before reinstall: $bundle_id"
    xcrun devicectl device uninstall app --device "$coredevice_id" "$bundle_id" || \
      log "native iOS uninstall skipped (app may not be installed)"
  fi

  log "building native iOS app ($configuration) for device: ${requested_coredevice_id:-auto}"
  (
    cd "$MINGLE_IOS_DIR"
    APP_BUNDLE_ID="$bundle_id" \
    NEXT_PUBLIC_SITE_URL="$DEVBOX_SITE_URL" \
    NEXT_PUBLIC_WS_URL="$DEVBOX_RN_WS_URL" \
    AUTO_SELECT_DEVICE=1 \
    CONFIGURATION="$configuration" \
      "$MINGLE_IOS_INSTALL_SCRIPT" "${coredevice_id:-}"
  )
}

run_native_ios_simulator_install() {
  local simulator_name="${1:-iPhone 16}"
  local simulator_udid="${2:-}"
  local configuration="$3"
  local with_clean_install="${4:-0}"
  local bundle_id="${5:-com.nam.mingleios}"

  [[ -x "$MINGLE_IOS_SIMULATOR_INSTALL_SCRIPT" ]] || die "native iOS simulator script not found: $MINGLE_IOS_SIMULATOR_INSTALL_SCRIPT"
  require_cmd xcodebuild
  require_cmd xcrun
  require_cmd xcodegen

  if [[ "$with_clean_install" -eq 1 && -n "$bundle_id" ]]; then
    local target_simulator_udid
    target_simulator_udid="$(resolve_ios_simulator_udid_for_uninstall "$simulator_name" "$simulator_udid")"
    log "uninstalling existing native iOS app before reinstall: $bundle_id"
    xcrun simctl uninstall "$target_simulator_udid" "$bundle_id" || \
      log "native iOS simulator uninstall skipped (app may not be installed)"
    simulator_udid="$target_simulator_udid"
  fi

  log "building native iOS app ($configuration) for simulator: ${simulator_udid:-$simulator_name}"
  (
    cd "$MINGLE_IOS_DIR"
    APP_BUNDLE_ID="$bundle_id" \
    NEXT_PUBLIC_SITE_URL="$DEVBOX_SITE_URL" \
    NEXT_PUBLIC_WS_URL="$DEVBOX_RN_WS_URL" \
    CONFIGURATION="$configuration" \
    SIMULATOR_NAME="$simulator_name" \
      "$MINGLE_IOS_SIMULATOR_INSTALL_SCRIPT" "${simulator_udid:-}"
  )
}

run_native_ios_build() {
  local requested_coredevice_id="${1:-}"
  local configuration="$2"
  local api_base_url="${3:-}"
  local ws_url="${4:-}"
  local bundle_id="${5:-com.nam.mingleios}"

  [[ -x "$MINGLE_IOS_BUILD_SCRIPT" ]] || die "native iOS build script not found: $MINGLE_IOS_BUILD_SCRIPT"
  require_cmd xcodebuild
  require_cmd xcodegen

  log "building native iOS app only ($configuration): ${requested_coredevice_id:-generic}"
  (
    cd "$MINGLE_IOS_DIR"
    if [[ -n "$api_base_url" || -n "$ws_url" ]]; then
      APP_BUNDLE_ID="$bundle_id" \
      NEXT_PUBLIC_SITE_URL="${api_base_url:-}" \
      NEXT_PUBLIC_WS_URL="${ws_url:-}" \
      CONFIGURATION="$configuration" \
        "$MINGLE_IOS_BUILD_SCRIPT" "${requested_coredevice_id:-}"
    else
      APP_BUNDLE_ID="$bundle_id" \
      CONFIGURATION="$configuration" \
        "$MINGLE_IOS_BUILD_SCRIPT" "${requested_coredevice_id:-}"
    fi
  )
}

run_android_mobile_install() {
  local requested_serial="${1:-}"
  local variant="$2"
  local serial="$requested_serial"

  if [[ -z "$serial" ]]; then
    serial="$(detect_android_device_serial || true)"
  fi

  if [[ -z "$serial" ]]; then
    log "Android device not detected; skipping Android build/install"
    return 0
  fi

  require_cmd adb
  ensure_rn_workspace_dependencies

  local gradle_task="installRelease"
  if [[ "$variant" == "debug" ]]; then
    gradle_task="installDebug"
  fi
  local app_id
  app_id="$(resolve_android_application_id)"

  log "building Android app ($variant) for device: $serial"
  (
    cd "$ROOT_DIR/mingle-app/rn/android"
    ANDROID_SERIAL="$serial" \
    NEXT_PUBLIC_SITE_URL="$DEVBOX_SITE_URL" \
    NEXT_PUBLIC_WS_URL="$DEVBOX_RN_WS_URL" \
      ./gradlew "$gradle_task"
  )

  if [[ -n "$app_id" ]]; then
    log "launching Android app package: $app_id"
    adb -s "$serial" shell monkey -p "$app_id" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || \
      log "Android app launch skipped (manual launch may be required)"
  fi
}

run_mobile_install_targets() {
  local do_rn_ios="$1"
  local do_native_ios="$2"
  local do_android="$3"
  local ios_udid="$4"
  local ios_coredevice_id="$5"
  local android_serial="$6"
  local ios_configuration="$7"
  local android_variant="$8"
  local ios_native_target="$9"
  local ios_simulator_name="${10}"
  local ios_simulator_udid="${11}"
  local with_ios_clean_install="${12:-0}"
  local app_site_override="${13:-}"
  local app_ws_override="${14:-}"
  local native_ios_bundle_id="${MINGLE_IOS_BUNDLE_ID:-com.nam.mingleios}"

  (
    if [[ -n "$app_site_override" ]]; then
      DEVBOX_SITE_URL="$app_site_override"
    fi
    if [[ -n "$app_ws_override" ]]; then
      DEVBOX_RN_WS_URL="$app_ws_override"
    fi

    if [[ "$do_rn_ios" -eq 1 ]]; then
      run_ios_mobile_install "$ios_udid" "$ios_configuration" "$with_ios_clean_install"
    fi
    if [[ "$do_native_ios" -eq 1 ]]; then
      if [[ "$ios_native_target" == "simulator" ]]; then
        run_native_ios_simulator_install \
          "$ios_simulator_name" \
          "$ios_simulator_udid" \
          "$ios_configuration" \
          "$with_ios_clean_install" \
          "$native_ios_bundle_id"
      else
        run_native_ios_mobile_install \
          "$ios_coredevice_id" \
          "$ios_configuration" \
          "$with_ios_clean_install" \
          "$native_ios_bundle_id"
      fi
    fi
    if [[ "$do_android" -eq 1 ]]; then
      run_android_mobile_install "$android_serial" "$android_variant"
    fi
  )
}

stop_existing_ngrok_by_inspector_port() {
  local inspector_port="$1"
  local name_patterns=(
    "ngrok.start.*devbox_web.*devbox_stt"
    "scripts/ngrok-start-mobile.sh .*devbox_web.*devbox_stt"
    "ngrok.*devbox.mobile.local.yml"
  )
  local pids=""
  local kill_pids=""
  local candidate=""
  local pid=""
  local unique_pids=""

  [[ -n "$inspector_port" ]] || return 0
  [[ "$inspector_port" =~ ^[0-9]+$ ]] || return 0

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -tiTCP:"$inspector_port" -sTCP:LISTEN 2>/dev/null || true)"
  fi
  if [[ -z "$pids" ]] && command -v pgrep >/dev/null 2>&1; then
    local pattern
    for pattern in "${name_patterns[@]}"; do
      while IFS= read -r candidate; do
        [[ -n "$candidate" ]] || continue
        if ! printf '%s\n' "$pids" | grep -Fxq "$candidate"; then
          pids="${pids}${pids:+$'\n'}$candidate"
        fi
      done < <(pgrep -f "$pattern" 2>/dev/null || true)
    done
  fi

  unique_pids="$(printf '%s' "$pids" | awk 'NF {print $1}' | awk '!seen[$0]++')"
  pids="$unique_pids"
  kill_pids="$unique_pids"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  log "stopping existing ngrok processes on inspector port $inspector_port"
  printf '%s\n' "$pids" | while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    kill "$pid" >/dev/null 2>&1 || true
  done

  local elapsed=0
  while (( elapsed < 5 )); do
    pids="$(lsof -tiTCP:"$inspector_port" -sTCP:LISTEN 2>/dev/null || true)"
    [[ -z "$pids" ]] && return 0
    sleep 1
    elapsed=$((elapsed + 1))
  done

  printf '%s\n' "$kill_pids" | while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    kill -9 "$pid" >/dev/null 2>&1 || true
  done
}

stop_existing_cloudflared_by_local_port() {
  local local_port="$1"
  local pids=""
  local pid=""
  local unique_pids=""

  [[ -n "$local_port" ]] || return 0
  [[ "$local_port" =~ ^[0-9]+$ ]] || return 0
  command -v pgrep >/dev/null 2>&1 || return 0

  pids="$(pgrep -f "cloudflared.*tunnel.*--url http://127\\.0\\.0\\.1:${local_port}" 2>/dev/null || true)"
  unique_pids="$(printf '%s' "$pids" | awk 'NF {print $1}' | awk '!seen[$0]++')"
  [[ -n "$unique_pids" ]] || return 0

  log "stopping existing cloudflared quick tunnels for local port $local_port"
  printf '%s\n' "$unique_pids" | while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    kill "$pid" >/dev/null 2>&1 || true
  done

  sleep 1
  pids="$(pgrep -f "cloudflared.*tunnel.*--url http://127\\.0\\.0\\.1:${local_port}" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    printf '%s\n' "$pids" | while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      kill -9 "$pid" >/dev/null 2>&1 || true
    done
  fi
}

extract_cloudflared_quicktunnel_url_from_log() {
  local log_file="$1"
  [[ -f "$log_file" ]] || return 1
  sed -nE 's/.*(https:\/\/[a-z0-9-]+\.trycloudflare\.com).*/\1/p' "$log_file" | tail -n 1
}

wait_for_cloudflared_tunnel_url() {
  local log_file="$1"
  local pid="$2"
  local timeout_sec="${3:-20}"
  local elapsed=0
  local url=""

  while (( elapsed < timeout_sec )); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 1
    fi
    url="$(extract_cloudflared_quicktunnel_url_from_log "$log_file" || true)"
    if [[ -n "$url" ]]; then
      printf '%s' "$url"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

try_read_ngrok_urls() {
  local expected_web_port="${1:-}"
  local expected_stt_port="${2:-}"
  local require_https="${3:-0}"
  local inspector_port="${4:-$DEVBOX_NGROK_API_PORT}"

  local raw parsed
  NGROK_LAST_ERROR=""
  NGROK_LAST_ERROR_KIND=""

  raw="$(curl -fsS "http://127.0.0.1:${inspector_port}/api/tunnels" 2>/dev/null)" || {
    NGROK_LAST_ERROR_KIND="inspector_unreachable"
    NGROK_LAST_ERROR="cannot reach ngrok inspector at http://127.0.0.1:${inspector_port}"
    return 1
  }

  parsed="$(
    printf '%s' "$raw" | \
      DEVBOX_EXPECT_WEB_PORT="$expected_web_port" \
      DEVBOX_EXPECT_STT_PORT="$expected_stt_port" \
      DEVBOX_REQUIRE_HTTPS="$require_https" \
      node "$ROOT_DIR/scripts/devbox-ngrok-parse.mjs" 2>&1
  )" || {
    NGROK_LAST_ERROR_KIND="tunnel_mismatch"
    NGROK_LAST_ERROR="$parsed"
    return 1
  }

  NGROK_WEB_URL="$(printf '%s\n' "$parsed" | sed -n '1p')"
  NGROK_STT_URL="$(printf '%s\n' "$parsed" | sed -n '2p')"

  [[ -n "$NGROK_WEB_URL" ]] || {
    NGROK_LAST_ERROR_KIND="tunnel_mismatch"
    NGROK_LAST_ERROR="ngrok web tunnel url is empty"
    return 1
  }
  [[ -n "$NGROK_STT_URL" ]] || {
    NGROK_LAST_ERROR_KIND="tunnel_mismatch"
    NGROK_LAST_ERROR="ngrok stt tunnel url is empty"
    return 1
  }
  return 0
}

read_ngrok_urls() {
  local expected_web_port="${1:-}"
  local expected_stt_port="${2:-}"
  local require_https="${3:-0}"
  local inspector_port="${4:-$DEVBOX_NGROK_API_PORT}"

  require_cmd curl
  require_cmd node
  try_read_ngrok_urls "$expected_web_port" "$expected_stt_port" "$require_https" "$inspector_port" || {
    if [[ -n "$NGROK_LAST_ERROR" ]]; then
      die "$NGROK_LAST_ERROR"
    fi
    die "cannot read ngrok web/stt tunnels from inspector (http://127.0.0.1:${inspector_port})"
  }
}

wait_for_ngrok_tunnels() {
  local expected_web_port="$1"
  local expected_stt_port="$2"
  local require_https="$3"
  local inspector_port="${4:-$DEVBOX_NGROK_API_PORT}"
  local timeout_sec="${5:-20}"
  local elapsed=0
  while ((elapsed < timeout_sec)); do
    if try_read_ngrok_urls "$expected_web_port" "$expected_stt_port" "$require_https" "$inspector_port"; then
      return 0
    fi
    sleep 1
    ((elapsed += 1))
  done
  return 1
}

resolve_google_cloud_project() {
  local project=""

  project="$(read_app_setting_value DEVBOX_GOOGLE_CLOUD_PROJECT || true)"
  [[ -z "$project" ]] && project="$(read_app_setting_value GOOGLE_CLOUD_PROJECT || true)"
  [[ -z "$project" ]] && project="$(read_app_setting_value GCLOUD_PROJECT || true)"
  if [[ -z "$project" ]] && command -v gcloud >/dev/null 2>&1; then
    project="$(gcloud config get-value core/project 2>/dev/null || true)"
    if [[ "$project" == "(unset)" ]]; then
      project=""
    fi
  fi

  printf '%s' "$(trim_whitespace "$project")"
}

resolve_google_access_token() {
  local token_cmd=""
  local token=""

  token_cmd="$(read_app_setting_value DEVBOX_GOOGLE_ACCESS_TOKEN_CMD || true)"
  if [[ -n "$token_cmd" ]]; then
    token="$(bash -lc "$token_cmd" 2>/dev/null || true)"
  elif command -v gcloud >/dev/null 2>&1; then
    token="$(gcloud auth print-access-token 2>/dev/null || true)"
  fi

  printf '%s' "$(trim_whitespace "$token")"
}

build_google_redirect_uris_for_site() {
  local site_url="$1"
  local paths_raw=""
  local item trimmed normalized
  local -a items=()

  paths_raw="$(read_app_setting_value DEVBOX_GOOGLE_REDIRECT_PATHS || true)"
  if [[ -z "$paths_raw" ]]; then
    paths_raw="/api/auth/callback/google"
  fi

  IFS=',' read -r -a items <<< "$paths_raw"
  for item in "${items[@]}"; do
    trimmed="$(trim_whitespace "$item")"
    [[ -n "$trimmed" ]] || continue

    if [[ "$trimmed" =~ ^https?:// ]]; then
      printf '%s\n' "${trimmed%/}"
      continue
    fi

    normalized="$trimmed"
    [[ "$normalized" == /* ]] || normalized="/$normalized"
    printf '%s%s\n' "${site_url%/}" "$normalized"
  done | awk 'NF && !seen[$0]++'
}

sync_google_oauth_redirect_uris_for_site_change() {
  local previous_site_url="${1:-}"
  local current_site_url="${2:-}"
  local enabled_raw=""
  local client_id=""
  local location=""
  local project=""
  local token=""
  local encoded_client_id=""
  local endpoint=""
  local current_client_json=""
  local updated=0
  local current_uri=""
  local desired_uri=""
  local found=0
  local uris_json=""
  local payload=""
  local -a desired_redirect_uris=()
  local -a merged_redirect_uris=()

  [[ -n "$current_site_url" ]] || return 0
  [[ "$current_site_url" =~ ^https:// ]] || return 0

  enabled_raw="$(read_app_setting_value DEVBOX_GOOGLE_REDIRECT_SYNC_ENABLED || true)"
  if [[ -n "$enabled_raw" ]] && ! is_truthy "$enabled_raw"; then
    log "google oauth redirect sync disabled (DEVBOX_GOOGLE_REDIRECT_SYNC_ENABLED=$enabled_raw)"
    return 0
  fi

  if [[ "$current_site_url" == "$previous_site_url" ]]; then
    log "google oauth redirect sync check: ngrok host unchanged; validating redirect URI presence"
  fi

  client_id="$(read_app_setting_value DEVBOX_GOOGLE_OAUTH_CLIENT_ID || true)"
  [[ -z "$client_id" ]] && client_id="$(read_app_setting_value AUTH_GOOGLE_ID || true)"
  client_id="$(trim_whitespace "$client_id")"
  if [[ -z "$client_id" ]]; then
    warn "skipping google redirect sync: missing oauth client id (set AUTH_GOOGLE_ID in secret/mingle-app/dev|prod or DEVBOX_GOOGLE_OAUTH_CLIENT_ID)"
    return 0
  fi

  location="$(read_app_setting_value DEVBOX_GOOGLE_OAUTH_LOCATION || true)"
  location="$(trim_whitespace "$location")"
  [[ -n "$location" ]] || location="global"

  project="$(resolve_google_cloud_project)"
  if [[ -z "$project" ]]; then
    warn "skipping google redirect sync: missing project id (set DEVBOX_GOOGLE_CLOUD_PROJECT or gcloud core/project)"
    return 0
  fi

  while IFS= read -r desired_uri; do
    desired_uri="$(trim_whitespace "$desired_uri")"
    [[ -n "$desired_uri" ]] || continue
    desired_redirect_uris+=("$desired_uri")
  done < <(build_google_redirect_uris_for_site "$current_site_url")

  if [[ "${#desired_redirect_uris[@]}" -eq 0 ]]; then
    return 0
  fi

  token="$(resolve_google_access_token)"
  if [[ -z "$token" ]]; then
    warn "skipping google redirect sync: missing access token (run gcloud auth login or set DEVBOX_GOOGLE_ACCESS_TOKEN_CMD)"
    return 0
  fi

  if ! command -v jq >/dev/null 2>&1; then
    warn "skipping google redirect sync: jq not found"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    warn "skipping google redirect sync: curl not found"
    return 0
  fi

  encoded_client_id="$(printf '%s' "$client_id" | jq -sRr @uri)"
  endpoint="https://iam.googleapis.com/v1/projects/${project}/locations/${location}/oauthClients/${encoded_client_id}"
  current_client_json="$(curl -fsS \
    -H "Authorization: Bearer $token" \
    -H "X-Goog-User-Project: $project" \
    "$endpoint" 2>/dev/null || true)"
  if [[ -z "$current_client_json" ]]; then
    warn "google redirect sync skipped: failed to load oauth client (project=$project location=$location client=$client_id)"
    return 0
  fi

  while IFS= read -r current_uri; do
    current_uri="$(trim_whitespace "$current_uri")"
    [[ -n "$current_uri" ]] || continue
    merged_redirect_uris+=("$current_uri")
  done < <(printf '%s' "$current_client_json" | jq -r '.allowedRedirectUris[]?' 2>/dev/null || true)

  for desired_uri in "${desired_redirect_uris[@]}"; do
    found=0
    for current_uri in "${merged_redirect_uris[@]}"; do
      if [[ "$current_uri" == "$desired_uri" ]]; then
        found=1
        break
      fi
    done
    if [[ "$found" -eq 0 ]]; then
      merged_redirect_uris+=("$desired_uri")
      updated=1
    fi
  done

  if [[ "$updated" -eq 0 ]]; then
    log "google oauth redirect URI already present for current ngrok host"
    return 0
  fi

  uris_json="$(printf '%s\n' "${merged_redirect_uris[@]}" | jq -R . | jq -s 'map(select(length>0))')"
  payload="$(jq -cn --argjson uris "$uris_json" '{allowedRedirectUris: $uris}')"
  if ! curl -fsS -X PATCH \
    -H "Authorization: Bearer $token" \
    -H "X-Goog-User-Project: $project" \
    -H "Content-Type: application/json" \
    "$endpoint?update_mask=allowed_redirect_uris" \
    --data "$payload" >/dev/null 2>&1; then
    if ! curl -fsS -X PATCH \
      -H "Authorization: Bearer $token" \
      -H "X-Goog-User-Project: $project" \
      -H "Content-Type: application/json" \
      "$endpoint?updateMask=allowedRedirectUris" \
      --data "$payload" >/dev/null 2>&1; then
      warn "google redirect sync failed while patching oauth client (project=$project location=$location client=$client_id)"
      return 0
    fi
  fi

  log "google oauth redirect URI synced for ngrok host: ${desired_redirect_uris[*]}"
}

set_device_profile_values_from_urls() {
  local site_url="$1"
  local stt_url="$2"
  local provider_label="${3:-tunnel}"
  local previous_site_url="${DEVBOX_SITE_URL:-}"

  DEVBOX_PROFILE="device"
  DEVBOX_LOCAL_HOST="127.0.0.1"
  DEVBOX_SITE_URL="$site_url"
  DEVBOX_RN_WS_URL="$(to_wss_url "$stt_url")"
  DEVBOX_PUBLIC_WS_URL="$DEVBOX_RN_WS_URL"
  DEVBOX_TEST_API_BASE_URL="http://127.0.0.1:$DEVBOX_WEB_PORT"
  DEVBOX_TEST_WS_URL="ws://127.0.0.1:$DEVBOX_STT_PORT"

  validate_https_url "$provider_label web url" "$DEVBOX_SITE_URL"
  validate_wss_url "$provider_label stt url" "$DEVBOX_RN_WS_URL"
  sync_google_oauth_redirect_uris_for_site_change "$previous_site_url" "$DEVBOX_SITE_URL"
}

set_device_profile_values() {
  read_ngrok_urls "$DEVBOX_WEB_PORT" "$DEVBOX_STT_PORT" "1" "$DEVBOX_NGROK_API_PORT"
  set_device_profile_values_from_urls "$NGROK_WEB_URL" "$NGROK_STT_URL" "ngrok"
}

resolve_device_app_env_override() {
  local mode="$1"
  local path=""
  local site_url=""
  local ws_url=""

  case "$mode" in
    dev)
      path="runtime:device-profile"
      site_url="${DEVBOX_SITE_URL:-}"
      ws_url="${DEVBOX_RN_WS_URL:-}"
      [[ -n "$site_url" ]] || die "missing runtime site url for --device-app-env dev. Run with --profile device so tunnel URLs are resolved first."
      [[ -n "$ws_url" ]] || die "missing runtime ws url for --device-app-env dev. Run with --profile device so tunnel URLs are resolved first."
      ;;
    prod)
      path="secret/mingle-app/prod"
      site_url="$(read_env_value_from_vault "$path" NEXT_PUBLIC_SITE_URL || true)"
      [[ -z "$site_url" ]] && site_url="$(read_env_value_from_vault "$path" MINGLE_API_BASE_URL || true)"
      [[ -z "$site_url" ]] && site_url="$(read_env_value_from_vault "$path" RN_WEB_APP_BASE_URL || true)"
      [[ -z "$site_url" ]] && site_url="$(read_env_value_from_vault "$path" MINGLE_WEB_APP_BASE_URL || true)"

      ws_url="$(read_env_value_from_vault "$path" NEXT_PUBLIC_WS_URL || true)"
      [[ -z "$ws_url" ]] && ws_url="$(read_env_value_from_vault "$path" MINGLE_WS_URL || true)"
      [[ -z "$ws_url" ]] && ws_url="$(read_env_value_from_vault "$path" RN_DEFAULT_WS_URL || true)"
      [[ -z "$ws_url" ]] && ws_url="$(read_env_value_from_vault "$path" MINGLE_DEFAULT_WS_URL || true)"

      [[ -n "$site_url" ]] || die "missing NEXT_PUBLIC_SITE_URL in vault path: $path (fallbacks checked: MINGLE_API_BASE_URL/RN_WEB_APP_BASE_URL/MINGLE_WEB_APP_BASE_URL)"
      [[ -n "$ws_url" ]] || die "missing NEXT_PUBLIC_WS_URL in vault path: $path (fallbacks checked: MINGLE_WS_URL/RN_DEFAULT_WS_URL/MINGLE_DEFAULT_WS_URL)"
      ;;
    *)
      die "invalid --device-app-env: $mode (expected dev|prod)"
      ;;
  esac

  validate_http_url "device app env site url" "$site_url"
  validate_ws_url "device app env ws url" "$ws_url"

  printf '%s\n%s\n%s\n' "$path" "$site_url" "$ws_url"
}

save_and_refresh() {
  if is_truthy "${DEVBOX_PERSIST_ENV_FILE:-0}"; then
    write_devbox_env
  fi
  refresh_runtime_files
}

apply_profile() {
  local profile="$1"
  local host="${2:-}"

  case "$profile" in
    local)
      if [[ -z "$host" ]]; then
        host="${DEVBOX_LOCAL_HOST:-127.0.0.1}"
      fi
      set_local_profile_values "$host"
      ;;
    device)
      set_device_profile_values
      ;;
    *)
      die "unsupported profile: $profile (expected local|device)"
      ;;
  esac

  save_and_refresh
}

port_conflict_check() {
  local name="$1"
  local port="$2"
  if port_list_contains "$RESERVED_ALL_PORTS" "$port"; then
    die "$name port already reserved by another worktree: $port"
  fi
  if port_in_use "$port"; then
    die "$name port already in use by another process: $port"
  fi
}

terminate_process_tree() {
  local pid="$1"
  [[ -n "$pid" ]] || return
  kill -0 "$pid" >/dev/null 2>&1 || return

  if command -v pgrep >/dev/null 2>&1; then
    local child
    while IFS= read -r child; do
      [[ -n "$child" ]] || continue
      terminate_process_tree "$child"
    done < <(pgrep -P "$pid" 2>/dev/null || true)
  fi

  kill "$pid" >/dev/null 2>&1 || true
}

cleanup_processes() {
  local pid
  for pid in "$@"; do
    terminate_process_tree "$pid"
  done
}

collect_listening_pids_by_port() {
  local port="$1"
  local raw=""
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi
  raw="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  printf '%s\n' "$raw" | awk 'NF {print $1}' | awk '!seen[$0]++'
}

collect_pids_by_pattern() {
  local pattern="$1"
  local raw=""
  if ! command -v pgrep >/dev/null 2>&1; then
    return 0
  fi
  raw="$(pgrep -f "$pattern" 2>/dev/null || true)"
  printf '%s\n' "$raw" | awk 'NF {print $1}' | awk '!seen[$0]++'
}

force_kill_pids() {
  local pid
  for pid in "$@"; do
    [[ -n "$pid" ]] || continue
    kill -9 "$pid" >/dev/null 2>&1 || true
  done
}

stop_pids_with_grace() {
  local label="$1"
  shift

  local -a pids=("$@")
  local -a alive=("${pids[@]}")
  local retries=0

  [[ "${#pids[@]}" -gt 0 ]] || return 0
  log "stopping $label (pids: ${pids[*]})"
  cleanup_processes "${pids[@]}"

  while [[ "$retries" -lt 10 ]]; do
    alive=()
    local pid
    for pid in "${pids[@]}"; do
      if kill -0 "$pid" >/dev/null 2>&1; then
        alive+=("$pid")
      fi
    done
    [[ "${#alive[@]}" -eq 0 ]] && return 0
    sleep 0.2
    retries=$((retries + 1))
  done

  log "force-killing $label (pids: ${alive[*]})"
  force_kill_pids "${alive[@]}"
}

stop_listeners_by_port() {
  local label="$1"
  local port="$2"
  local pids_text=""
  local -a pids=()

  pids_text="$(collect_listening_pids_by_port "$port")"
  if [[ -z "$pids_text" ]]; then
    return 0
  fi
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    pids+=("$pid")
  done <<< "$pids_text"
  if [[ "${#pids[@]}" -eq 0 ]]; then
    return 0
  fi
  stop_pids_with_grace "$label(port=$port)" "${pids[@]}"
}

stop_processes_by_pattern() {
  local label="$1"
  local pattern="$2"
  local pids_text=""
  local -a pids=()

  pids_text="$(collect_pids_by_pattern "$pattern")"
  if [[ -z "$pids_text" ]]; then
    return 0
  fi
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    pids+=("$pid")
  done <<< "$pids_text"
  if [[ "${#pids[@]}" -eq 0 ]]; then
    return 0
  fi
  stop_pids_with_grace "$label" "${pids[@]}"
}

wait_for_any_child_exit() {
  local pid
  local -a pids=("$@")
  while true; do
    for pid in "${pids[@]}"; do
      if ! kill -0 "$pid" >/dev/null 2>&1; then
        wait "$pid"
        return $?
      fi
    done
    sleep 1
  done
}

cmd_init() {
  require_cmd pnpm
  local web_port="" stt_port="" metro_port="" ngrok_api_port="" host="127.0.0.1"
  local vault_app_override="" vault_stt_override=""
  local openclaw_root_override=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --web-port) web_port="${2:-}"; shift 2 ;;
      --stt-port) stt_port="${2:-}"; shift 2 ;;
      --metro-port) metro_port="${2:-}"; shift 2 ;;
      --ngrok-api-port) ngrok_api_port="${2:-}"; shift 2 ;;
      --host) host="${2:-}"; shift 2 ;;
      --vault-app-path) vault_app_override="${2:-}"; shift 2 ;;
      --vault-stt-path) vault_stt_override="${2:-}"; shift 2 ;;
      --openclaw-root) openclaw_root_override="${2:-}"; shift 2 ;;
      *) die "unknown option for init: $1" ;;
    esac
  done

  resolve_vault_paths "$vault_app_override" "$vault_stt_override"
  if [[ -n "$openclaw_root_override" ]]; then
    DEVBOX_OPENCLAW_ROOT="$openclaw_root_override"
  fi
  if [[ -z "$DEVBOX_OPENCLAW_ROOT" ]]; then
    DEVBOX_OPENCLAW_ROOT="$(resolve_openclaw_root)"
  fi

  DEVBOX_WORKTREE_NAME="$(derive_worktree_name)"
  calc_default_ports

  [[ -n "$web_port" ]] || web_port="$DEFAULT_WEB_PORT"
  [[ -n "$stt_port" ]] || stt_port="$DEFAULT_STT_PORT"
  [[ -n "$metro_port" ]] || metro_port="$DEFAULT_METRO_PORT"
  [[ -n "$ngrok_api_port" ]] || ngrok_api_port="$DEFAULT_NGROK_API_PORT"

  validate_port "web port" "$web_port"
  validate_port "stt port" "$stt_port"
  validate_port "metro port" "$metro_port"
  validate_port "ngrok api port" "$ngrok_api_port"

  [[ "$web_port" != "$stt_port" ]] || die "web/stt ports must differ"
  [[ "$web_port" != "$metro_port" ]] || die "web/metro ports must differ"
  [[ "$stt_port" != "$metro_port" ]] || die "stt/metro ports must differ"
  [[ "$ngrok_api_port" != "$web_port" ]] || die "ngrok api/web ports must differ"
  [[ "$ngrok_api_port" != "$stt_port" ]] || die "ngrok api/stt ports must differ"
  [[ "$ngrok_api_port" != "$metro_port" ]] || die "ngrok api/metro ports must differ"

  port_conflict_check "web" "$web_port"
  port_conflict_check "stt" "$stt_port"
  port_conflict_check "metro" "$metro_port"
  port_conflict_check "ngrok api" "$ngrok_api_port"

  DEVBOX_WEB_PORT="$web_port"
  DEVBOX_STT_PORT="$stt_port"
  DEVBOX_METRO_PORT="$metro_port"
  DEVBOX_NGROK_API_PORT="$ngrok_api_port"
  set_local_profile_values "$host"

  save_and_refresh
  ensure_rn_workspace_dependencies
  ensure_ios_pods_if_needed

  log "initialized for worktree: $DEVBOX_WORKTREE_NAME"
  cmd_status
}

cmd_bootstrap() {
  require_cmd pnpm
  local vault_app_override=""
  local vault_stt_override=""
  local vault_push=0
  local openclaw_root_override=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --vault-app-path) vault_app_override="${2:-}"; shift 2 ;;
      --vault-stt-path) vault_stt_override="${2:-}"; shift 2 ;;
      --vault-push) vault_push=1; shift ;;
      --openclaw-root) openclaw_root_override="${2:-}"; shift 2 ;;
      *) die "unknown option for bootstrap: $1" ;;
    esac
  done

  require_devbox_env

  resolve_vault_paths "$vault_app_override" "$vault_stt_override"
  if [[ -n "$openclaw_root_override" ]]; then
    DEVBOX_OPENCLAW_ROOT="$openclaw_root_override"
  fi
  if [[ -z "$DEVBOX_OPENCLAW_ROOT" ]]; then
    DEVBOX_OPENCLAW_ROOT="$(resolve_openclaw_root)"
  fi

  if [[ "$vault_push" -eq 1 ]]; then
    [[ -n "$DEVBOX_VAULT_APP_PATH" ]] || die "missing vault app path for --vault-push (set --vault-app-path or bootstrap once with detected path)"
    [[ -n "$DEVBOX_VAULT_STT_PATH" ]] || die "missing vault stt path for --vault-push (set --vault-stt-path or bootstrap once with detected path)"
    push_env_to_vault_paths "$DEVBOX_VAULT_APP_PATH" "$DEVBOX_VAULT_STT_PATH"
  fi
  log "bootstrap is read-only for .env.local (no seed/sync writes)"
  ensure_workspace_dependencies
  ensure_rn_workspace_dependencies
  ensure_ios_pods_if_needed
  save_and_refresh
  log "bootstrap complete"
}

cmd_profile() {
  require_devbox_env

  local profile=""
  local host=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --profile) profile="${2:-}"; shift 2 ;;
      --host) host="${2:-}"; shift 2 ;;
      *) die "unknown option for profile: $1" ;;
    esac
  done

  [[ -n "$profile" ]] || die "missing --profile local|device"
  apply_profile "$profile" "$host"
  log "applied profile: $profile"
  cmd_status
}

cmd_ngrok_config() {
  require_devbox_env
  write_ngrok_local_config
  log "wrote $NGROK_LOCAL_CONFIG"
}

cmd_gateway() {
  require_cmd pnpm
  local openclaw_root=""
  local mode="dev"
  local dry_run=0
  local -a passthrough=()
  local -a cmd=()

  require_devbox_env

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --openclaw-root) openclaw_root="${2:-}"; shift 2 ;;
      --mode) mode="${2:-}"; shift 2 ;;
      --dry-run) dry_run=1; shift ;;
      --) shift; passthrough+=("$@"); break ;;
      *)
        passthrough+=("$1")
        shift
        ;;
    esac
  done

  if [[ -z "$openclaw_root" ]]; then
    openclaw_root="$(resolve_openclaw_root)"
  fi
  [[ -n "$openclaw_root" ]] || die "unable to resolve openclaw root (use --openclaw-root)"
  [[ -d "$openclaw_root" ]] || die "openclaw root not found: $openclaw_root"

  case "$mode" in
    dev)
      [[ "${#passthrough[@]}" -eq 0 ]] || die "--mode dev does not accept extra args (use --mode run -- ...)"
      cmd=(pnpm --dir "$openclaw_root" gateway:dev)
      ;;
    run)
      cmd=(pnpm --dir "$openclaw_root" openclaw gateway run)
      ;;
    *)
      die "invalid --mode: $mode (expected dev|run)"
      ;;
  esac

  log "openclaw gateway command (mode=$mode, root=$openclaw_root)"
  if [[ "$dry_run" -eq 1 ]]; then
    printf '%q ' "${cmd[@]}"
    if [[ "${#passthrough[@]}" -gt 0 ]]; then
      printf '%q ' "${passthrough[@]}"
    fi
    printf '\n'
    return 0
  fi

  if [[ "$mode" == "run" ]]; then
    if [[ "${#passthrough[@]}" -gt 0 ]]; then
      "${cmd[@]}" "${passthrough[@]}"
    else
      "${cmd[@]}"
    fi
  else
    "${cmd[@]}"
  fi
}

cmd_ios_rn_ipa() {
  require_cmd xcodebuild

  local ios_configuration="Release"
  local device_app_env=""
  local site_override=""
  local ws_override=""
  local archive_path=""
  local export_path=""
  local export_options_plist=""
  local export_method="app-store-connect"
  local allow_provisioning_updates=1
  local team_id=""
  local shell_team_id="${DEVBOX_IOS_TEAM_ID:-}"
  local skip_export=0
  local dry_run=0
  local timestamp=""
  local archive_site_url=""
  local archive_ws_url=""
  local previous_site_url=""
  local previous_ws_url=""
  local restore_runtime_xcconfig=0
  local device_app_env_payload=""
  local device_app_env_path=""
  local temp_export_options_plist=""

  if [[ -f "$DEVBOX_ENV_FILE" ]]; then
    require_devbox_env
  else
    log "no .devbox.env found; ios-rn-ipa will use vault/.env.local/shell values only"
  fi

  timestamp="$(date '+%Y%m%d-%H%M%S')"
  archive_path="/tmp/mingle-${timestamp}.xcarchive"
  export_path="/tmp/mingle-ipa-${timestamp}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --ios-configuration) ios_configuration="${2:-}"; shift 2 ;;
      --device-app-env) device_app_env="${2:-}"; shift 2 ;;
      --site-url) site_override="${2:-}"; shift 2 ;;
      --ws-url) ws_override="${2:-}"; shift 2 ;;
      --archive-path) archive_path="${2:-}"; shift 2 ;;
      --export-path) export_path="${2:-}"; shift 2 ;;
      --export-options-plist) export_options_plist="${2:-}"; shift 2 ;;
      --export-method) export_method="${2:-}"; shift 2 ;;
      --team-id) team_id="${2:-}"; shift 2 ;;
      --allow-provisioning-updates) allow_provisioning_updates=1; shift ;;
      --no-allow-provisioning-updates) allow_provisioning_updates=0; shift ;;
      --skip-export) skip_export=1; shift ;;
      --dry-run) dry_run=1; shift ;;
      *) die "unknown option for ios-rn-ipa: $1" ;;
    esac
  done

  ios_configuration="$(normalize_ios_configuration "$ios_configuration")"

  case "$export_method" in
    app-store) export_method="app-store-connect" ;;
    ad-hoc) export_method="release-testing" ;;
    development) export_method="debugging" ;;
    app-store-connect|release-testing|debugging|enterprise|validation) ;;
    *) die "invalid --export-method: $export_method (expected app-store-connect|release-testing|debugging|enterprise|validation)" ;;
  esac

  if [[ -n "$device_app_env" ]]; then
    device_app_env_payload="$(resolve_device_app_env_override "$device_app_env")"
    device_app_env_path="$(printf '%s\n' "$device_app_env_payload" | sed -n '1p')"
    archive_site_url="$(printf '%s\n' "$device_app_env_payload" | sed -n '2p')"
    archive_ws_url="$(printf '%s\n' "$device_app_env_payload" | sed -n '3p')"
    log "ipa build app env override: $device_app_env (${device_app_env_path:-})"
  fi

  if [[ -n "$site_override" || -n "$ws_override" ]]; then
    [[ -n "$site_override" ]] || die "--ws-url requires --site-url"
    [[ -n "$ws_override" ]] || die "--site-url requires --ws-url"
    archive_site_url="$site_override"
    archive_ws_url="$ws_override"
  fi

  if [[ -z "$archive_site_url" ]]; then
    archive_site_url="${DEVBOX_SITE_URL:-}"
  fi
  if [[ -z "$archive_ws_url" ]]; then
    archive_ws_url="${DEVBOX_RN_WS_URL:-}"
  fi

  if [[ -z "$archive_site_url" ]]; then
    archive_site_url="$(trim_whitespace "$(read_app_setting_value NEXT_PUBLIC_SITE_URL || true)")"
  fi
  if [[ -z "$archive_ws_url" ]]; then
    archive_ws_url="$(trim_whitespace "$(read_app_setting_value NEXT_PUBLIC_WS_URL || true)")"
  fi
  if [[ -z "$archive_site_url" ]]; then
    archive_site_url="$(trim_whitespace "$(read_app_setting_value MINGLE_API_BASE_URL || true)")"
  fi
  if [[ -z "$archive_ws_url" ]]; then
    archive_ws_url="$(trim_whitespace "$(read_app_setting_value MINGLE_WS_URL || true)")"
  fi
  if [[ -z "$archive_site_url" ]]; then
    archive_site_url="$(trim_whitespace "$(read_app_setting_value RN_WEB_APP_BASE_URL || true)")"
  fi
  if [[ -z "$archive_site_url" ]]; then
    archive_site_url="$(trim_whitespace "$(read_app_setting_value MINGLE_WEB_APP_BASE_URL || true)")"
  fi
  if [[ -z "$archive_ws_url" ]]; then
    archive_ws_url="$(trim_whitespace "$(read_app_setting_value RN_DEFAULT_WS_URL || true)")"
  fi
  if [[ -z "$archive_ws_url" ]]; then
    archive_ws_url="$(trim_whitespace "$(read_app_setting_value MINGLE_DEFAULT_WS_URL || true)")"
  fi

  [[ -n "$archive_site_url" ]] || die "missing archive site url (use --device-app-env, --site-url/--ws-url, or set NEXT_PUBLIC_SITE_URL)"
  [[ -n "$archive_ws_url" ]] || die "missing archive ws url (use --device-app-env, --site-url/--ws-url, or set NEXT_PUBLIC_WS_URL)"

  validate_http_url "archive site url" "$archive_site_url"
  validate_ws_url "archive ws url" "$archive_ws_url"

  if [[ "$device_app_env" == "prod" ]]; then
    validate_https_url "archive site url (prod)" "$archive_site_url"
    validate_wss_url "archive ws url (prod)" "$archive_ws_url"
  fi

  if [[ -z "$team_id" ]]; then
    team_id="$(trim_whitespace "${DEVBOX_IOS_TEAM_ID:-}")"
  fi

  if [[ -z "$team_id" ]]; then
    team_id="$(trim_whitespace "$shell_team_id")"
  fi

  if [[ -z "$team_id" ]]; then
    team_id="$(trim_whitespace "$(resolve_rn_ios_development_team || true)")"
  fi

  [[ -n "$archive_path" ]] || die "--archive-path must not be empty"
  [[ -n "$export_path" ]] || die "--export-path must not be empty"
  ensure_single_line_value "archive path" "$archive_path"
  ensure_single_line_value "export path" "$export_path"

  if [[ "$skip_export" -eq 0 ]]; then
    if [[ -n "$export_options_plist" ]]; then
      [[ -f "$export_options_plist" ]] || die "export options plist not found: $export_options_plist"
    elif [[ "$dry_run" -eq 1 ]]; then
      export_options_plist="/tmp/mingle-export-options-${timestamp}.plist"
    else
      temp_export_options_plist="$(mktemp -t mingle-export-options)"
      cat > "$temp_export_options_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>$export_method</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>destination</key>
  <string>export</string>
EOF
      if [[ -n "$team_id" ]]; then
        cat >> "$temp_export_options_plist" <<EOF
  <key>teamID</key>
  <string>$team_id</string>
EOF
      fi
      cat >> "$temp_export_options_plist" <<'EOF'
</dict>
</plist>
EOF
      export_options_plist="$temp_export_options_plist"
    fi
  fi

  previous_site_url="${DEVBOX_SITE_URL:-}"
  previous_ws_url="${DEVBOX_RN_WS_URL:-}"
  if [[ -n "$previous_site_url" && -n "$previous_ws_url" ]]; then
    restore_runtime_xcconfig=1
  fi
  DEVBOX_SITE_URL="$archive_site_url"
  DEVBOX_RN_WS_URL="$archive_ws_url"
  write_rn_ios_runtime_xcconfig

  local -a xcode_provisioning_args=()
  if [[ "$allow_provisioning_updates" -eq 1 ]]; then
    xcode_provisioning_args+=(-allowProvisioningUpdates)
  fi

  log "building RN iOS archive (config=$ios_configuration, archive=$archive_path)"
  log "runtime URL: site=$archive_site_url ws=$archive_ws_url"

  if [[ "$dry_run" -eq 1 ]]; then
    cat <<EOF
xcodebuild -workspace $ROOT_DIR/mingle-app/rn/ios/mingle.xcworkspace -scheme mingle -configuration $ios_configuration -destination generic/platform=iOS -archivePath $archive_path -xcconfig $RN_IOS_RUNTIME_XCCONFIG ${xcode_provisioning_args[*]} archive
EOF
    if [[ "$skip_export" -eq 0 ]]; then
      cat <<EOF
xcodebuild -exportArchive ${xcode_provisioning_args[*]} -archivePath $archive_path -exportOptionsPlist $export_options_plist -exportPath $export_path
EOF
    fi
    if [[ "$restore_runtime_xcconfig" -eq 1 ]]; then
      DEVBOX_SITE_URL="$previous_site_url"
      DEVBOX_RN_WS_URL="$previous_ws_url"
      write_rn_ios_runtime_xcconfig
    fi
    return 0
  fi

  ensure_rn_workspace_dependencies
  ensure_ios_pods_if_needed

  (
    cd "$ROOT_DIR/mingle-app/rn/ios"
    NEXT_PUBLIC_API_NAMESPACE="$IOS_RN_REQUIRED_API_NAMESPACE" \
      xcodebuild \
        "${xcode_provisioning_args[@]}" \
        -workspace "$ROOT_DIR/mingle-app/rn/ios/mingle.xcworkspace" \
        -scheme mingle \
        -configuration "$ios_configuration" \
        -destination "generic/platform=iOS" \
        -archivePath "$archive_path" \
        -xcconfig "$RN_IOS_RUNTIME_XCCONFIG" \
        archive
  )

  [[ -d "$archive_path" ]] || die "archive not found after build: $archive_path"

  if [[ "$skip_export" -eq 1 ]]; then
    if [[ "$restore_runtime_xcconfig" -eq 1 ]]; then
      DEVBOX_SITE_URL="$previous_site_url"
      DEVBOX_RN_WS_URL="$previous_ws_url"
      write_rn_ios_runtime_xcconfig
    fi
    log "archive complete (export skipped): $archive_path"
    return 0
  fi

  xcodebuild \
    "${xcode_provisioning_args[@]}" \
    -exportArchive \
    -archivePath "$archive_path" \
    -exportOptionsPlist "$export_options_plist" \
    -exportPath "$export_path"

  local ipa_file=""
  ipa_file="$(find "$export_path" -maxdepth 1 -type f -name '*.ipa' | head -n 1)"
  [[ -n "$ipa_file" ]] || die "ipa export failed: no .ipa in $export_path"

  if [[ "$restore_runtime_xcconfig" -eq 1 ]]; then
    DEVBOX_SITE_URL="$previous_site_url"
    DEVBOX_RN_WS_URL="$previous_ws_url"
    write_rn_ios_runtime_xcconfig
  fi

  log "archive complete: $archive_path"
  log "ipa exported: $ipa_file"
  log "next: Xcode Organizer -> Distribute App -> App Store Connect -> Upload"
}

cmd_mobile() {
  require_devbox_env
  require_cmd pnpm

  local active_profile="${DEVBOX_PROFILE:-local}"
  local active_host="${DEVBOX_LOCAL_HOST:-127.0.0.1}"
  local profile_override=""
  local host_override=""
  local with_ios_clean_install=0
  local device_app_env=""
  local platform="all"
  local ios_runtime="rn"
  local ios_native_target="device"
  local ios_simulator_name="iPhone 16"
  local ios_simulator_udid=""
  local ios_udid=""
  local ios_coredevice_id=""
  local android_serial=""
  local ios_configuration="Release"
  local android_variant="release"
  local tunnel_provider_override=""
  local mobile_site_override=""
  local mobile_ws_override=""
  local site_override=""
  local ws_override=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --profile) profile_override="${2:-}"; shift 2 ;;
      --host) host_override="${2:-}"; shift 2 ;;
      --platform) platform="${2:-}"; shift 2 ;;
      --ios-runtime) ios_runtime="${2:-}"; shift 2 ;;
      --ios-native-target) ios_native_target="${2:-}"; shift 2 ;;
      --ios-simulator-name) ios_simulator_name="${2:-}"; shift 2 ;;
      --ios-simulator-udid) ios_simulator_udid="${2:-}"; shift 2 ;;
      --ios-udid) ios_udid="${2:-}"; shift 2 ;;
      --ios-coredevice-id) ios_coredevice_id="${2:-}"; shift 2 ;;
      --android-serial) android_serial="${2:-}"; shift 2 ;;
      --ios-configuration) ios_configuration="${2:-}"; shift 2 ;;
      --android-variant) android_variant="${2:-}"; shift 2 ;;
      --with-ios-clean-install) with_ios_clean_install=1; shift ;;
      --device-app-env) device_app_env="${2:-}"; shift 2 ;;
      --tunnel-provider) tunnel_provider_override="${2:-}"; shift 2 ;;
      --site-url) site_override="${2:-}"; shift 2 ;;
      --ws-url) ws_override="${2:-}"; shift 2 ;;
      *) die "unknown option for mobile: $1" ;;
    esac
  done

  if [[ -n "$profile_override" ]]; then
    case "$profile_override" in
      local|device) active_profile="$profile_override" ;;
      *) die "invalid --profile for mobile: $profile_override (expected local|device)" ;;
    esac
  fi

  if [[ -n "$host_override" ]]; then
    active_host="$host_override"
  fi

  if [[ -n "$site_override" || -n "$ws_override" ]]; then
    [[ -n "$site_override" ]] || die "--ws-url requires --site-url"
    [[ -n "$ws_override" ]] || die "--site-url requires --ws-url"
    validate_http_url "mobile site url override" "$site_override"
    validate_ws_url "mobile ws url override" "$ws_override"
    mobile_site_override="$site_override"
    mobile_ws_override="$ws_override"
  fi

  ios_runtime="$(normalize_ios_runtime "$ios_runtime")"
  ios_native_target="$(normalize_ios_native_target "$ios_native_target")"
  local tunnel_provider=""
  tunnel_provider="$(resolve_tunnel_provider "$tunnel_provider_override")"
  DEVBOX_TUNNEL_PROVIDER="$tunnel_provider"
  local profile_already_saved=0
  case "$active_profile" in
    device)
      if [[ "$device_app_env" == "prod" ]]; then
        log "device app env is prod; skipping device tunnel profile refresh"
      elif [[ -n "$mobile_site_override" || -n "$mobile_ws_override" ]]; then
        log "manual mobile runtime URL override is set; skipping device tunnel profile refresh"
      else
        case "$tunnel_provider" in
          ngrok)
            # Refresh ngrok-derived URLs before mobile build/install to avoid stale app URL embedding.
            # Keep existing ngrok alive so mobile clean-install can run while `devbox up --profile device` is active.
            apply_profile "device"
            profile_already_saved=1
            ;;
          cloudflare)
            local cloudflare_named_hosts=""
            cloudflare_named_hosts="$(resolve_cloudflare_named_hostnames || true)"
            if [[ -z "$cloudflare_named_hosts" ]]; then
              die "cloudflare mobile profile refresh requires named tunnel hostnames (DEVBOX_CLOUDFLARE_WEB_HOSTNAME/STT_HOSTNAME)."
            fi
            local cloudflare_named_web_host=""
            local cloudflare_named_stt_host=""
            cloudflare_named_web_host="$(printf '%s\n' "$cloudflare_named_hosts" | sed -n '1p')"
            cloudflare_named_stt_host="$(printf '%s\n' "$cloudflare_named_hosts" | sed -n '2p')"
            set_device_profile_values_from_urls \
              "https://$cloudflare_named_web_host" \
              "https://$cloudflare_named_stt_host" \
              "cloudflare"
            ;;
          *)
            die "unsupported tunnel provider for mobile: $tunnel_provider"
            ;;
        esac
      fi
      ;;
    local)
      apply_profile "local" "$active_host"
      profile_already_saved=1
      ;;
    *)
      die "unsupported DEVBOX_PROFILE in .devbox.env: $active_profile (expected local|device)"
      ;;
  esac
  if [[ "$profile_already_saved" -eq 0 ]]; then
    save_and_refresh
  fi

  if [[ -n "$device_app_env" ]]; then
    [[ "$active_profile" == "device" ]] || die "--device-app-env is only supported when DEVBOX_PROFILE=device"
    local device_app_env_payload=""
    local device_app_env_path=""
    device_app_env_payload="$(resolve_device_app_env_override "$device_app_env")"
    device_app_env_path="$(printf '%s\n' "$device_app_env_payload" | sed -n '1p')"
    mobile_site_override="$(printf '%s\n' "$device_app_env_payload" | sed -n '2p')"
    mobile_ws_override="$(printf '%s\n' "$device_app_env_payload" | sed -n '3p')"
    log "device app env override: $device_app_env (${device_app_env_path:-})"
  fi
  ios_configuration="$(normalize_ios_configuration "$ios_configuration")"
  android_variant="$(normalize_android_variant "$android_variant")"

  local do_rn_ios=0
  local do_native_ios=0
  local do_android=0

  case "$platform" in
    ios)
      case "$ios_runtime" in
        rn) do_rn_ios=1 ;;
        native) do_native_ios=1 ;;
        both) do_rn_ios=1; do_native_ios=1 ;;
      esac
      ;;
    android)
      do_android=1
      ;;
    all)
      case "$ios_runtime" in
        rn) do_rn_ios=1 ;;
        native) do_native_ios=1 ;;
        both) do_rn_ios=1; do_native_ios=1 ;;
      esac
      do_android=1
      ;;
    *)
      die "invalid --platform: $platform (expected ios|android|all)"
      ;;
  esac

  if [[ -n "$ios_udid" ]]; then
    do_rn_ios=1
  fi
  if [[ -n "$ios_coredevice_id" ]]; then
    do_native_ios=1
    ios_native_target="device"
  fi
  if [[ -n "$ios_simulator_udid" ]]; then
    do_native_ios=1
    ios_native_target="simulator"
  fi
  if [[ "$ios_native_target" == "simulator" ]]; then
    do_native_ios=1
  fi
  if [[ -n "$android_serial" ]]; then
    do_android=1
  fi

  run_mobile_install_targets \
    "$do_rn_ios" \
    "$do_native_ios" \
    "$do_android" \
    "$ios_udid" \
    "$ios_coredevice_id" \
    "$android_serial" \
    "$ios_configuration" \
    "$android_variant" \
    "$ios_native_target" \
    "$ios_simulator_name" \
    "$ios_simulator_udid" \
    "$with_ios_clean_install" \
    "$mobile_site_override" \
    "$mobile_ws_override"

  log "mobile build/install complete"
}

cmd_up() {
  require_devbox_env
  require_cmd pnpm
  local vault_app_override=""
  local vault_stt_override=""

  local profile="local"
  local host=""
  local with_metro=0
  local with_ios_install=0
  local with_android_install=0
  local ios_runtime="rn"
  local ios_native_target="device"
  local ios_simulator_name="iPhone 16"
  local ios_simulator_udid=""
  local with_ios_clean_install=0
  local device_app_env=""
  local ios_udid=""
  local ios_coredevice_id=""
  local android_serial=""
  local ios_configuration="Release"
  local android_variant="release"
  local mobile_site_override=""
  local mobile_ws_override=""
  local tunnel_provider_override=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --profile) profile="${2:-}"; shift 2 ;;
      --host) host="${2:-}"; shift 2 ;;
      --with-metro) with_metro=1; shift ;;
      --with-ios-install) with_ios_install=1; shift ;;
      --with-android-install) with_android_install=1; shift ;;
      --with-mobile-install) with_ios_install=1; with_android_install=1; shift ;;
      --ios-runtime) ios_runtime="${2:-}"; shift 2 ;;
      --ios-native-target) ios_native_target="${2:-}"; with_ios_install=1; shift 2 ;;
      --ios-simulator-name) ios_simulator_name="${2:-}"; with_ios_install=1; shift 2 ;;
      --ios-simulator-udid) ios_simulator_udid="${2:-}"; with_ios_install=1; shift 2 ;;
      --with-ios-clean-install) with_ios_clean_install=1; shift ;;
      --ios-udid) ios_udid="${2:-}"; with_ios_install=1; shift 2 ;;
      --ios-coredevice-id) ios_coredevice_id="${2:-}"; with_ios_install=1; shift 2 ;;
      --android-serial) android_serial="${2:-}"; with_android_install=1; shift 2 ;;
      --ios-configuration) ios_configuration="${2:-}"; shift 2 ;;
      --android-variant) android_variant="${2:-}"; shift 2 ;;
      --tunnel-provider) tunnel_provider_override="${2:-}"; shift 2 ;;
      --device-app-env) device_app_env="${2:-}"; shift 2 ;;
      --vault-app-path) vault_app_override="${2:-}"; shift 2 ;;
      --vault-stt-path) vault_stt_override="${2:-}"; shift 2 ;;
      *) die "unknown option for up: $1" ;;
    esac
  done

  ios_runtime="$(normalize_ios_runtime "$ios_runtime")"
  ios_native_target="$(normalize_ios_native_target "$ios_native_target")"
  ios_configuration="$(normalize_ios_configuration "$ios_configuration")"
  android_variant="$(normalize_android_variant "$android_variant")"
  local tunnel_provider=""
  tunnel_provider="$(resolve_tunnel_provider "$tunnel_provider_override")"
  DEVBOX_TUNNEL_PROVIDER="$tunnel_provider"

  resolve_vault_paths "$vault_app_override" "$vault_stt_override"
  log "stateless mode: skipping automatic vault -> .env.local sync (.env.local is user-managed)"
  local runtime_app_env_file=""
  local runtime_stt_env_file=""
  local runtime_nextauth_secret=""
  runtime_app_env_file="$(mktemp "${TMPDIR:-/tmp}/devbox-app-runtime-env.XXXXXX")"
  runtime_stt_env_file="$(mktemp "${TMPDIR:-/tmp}/devbox-stt-runtime-env.XXXXXX")"
  write_runtime_env_from_vault_path "app" "$DEVBOX_VAULT_APP_PATH" "$runtime_app_env_file"
  write_runtime_env_from_vault_path "stt" "$DEVBOX_VAULT_STT_PATH" "$runtime_stt_env_file"
  runtime_nextauth_secret="$(resolve_runtime_nextauth_secret "$runtime_app_env_file")"
  ensure_workspace_dependencies

  local -a pids=()
  local exit_code=0
  local started_tunnel_mode="none"
  local cloudflared_web_url=""
  local cloudflared_stt_url=""
  local cloudflared_web_log=""
  local cloudflared_stt_log=""
  local cloudflared_web_pid=""
  local cloudflared_stt_pid=""
  local cloudflared_named_log=""
  local cloudflared_named_pid_file=""
  local cloudflared_named_token=""
  local cloudflared_named_web_host=""
  local cloudflared_named_stt_host=""

  if [[ "$profile" == "device" ]]; then
    if [[ "$device_app_env" == "prod" ]]; then
      log "device app env is prod; skipping device tunnel startup/check"
    else
      case "$tunnel_provider" in
        ngrok)
          if [[ "$with_ios_clean_install" -eq 1 ]]; then
            stop_existing_ngrok_by_inspector_port "$DEVBOX_NGROK_API_PORT"
          fi
          write_ngrok_local_config

          if ! try_read_ngrok_urls "$DEVBOX_WEB_PORT" "$DEVBOX_STT_PORT" "1" "$DEVBOX_NGROK_API_PORT"; then
            if [[ "$NGROK_LAST_ERROR_KIND" == "tunnel_mismatch" ]]; then
              die "running ngrok tunnels do not match this worktree ports(web=$DEVBOX_WEB_PORT stt=$DEVBOX_STT_PORT) or are not https/wss (inspector port=$DEVBOX_NGROK_API_PORT).
$NGROK_LAST_ERROR
$(ngrok_plan_capacity_hint)"
            fi
            require_cmd ngrok
            log "starting ngrok for device profile"
            if launch_ngrok_in_separate_terminal; then
              started_tunnel_mode="ngrok-separate"
              log "ngrok started in a separate terminal pane/tab"
            else
              log "separate terminal launch unavailable; falling back to inline ngrok"
              (
                cd "$ROOT_DIR"
                scripts/ngrok-start-mobile.sh --log stdout --log-format logfmt
              ) &
              pids+=("$!")
              started_tunnel_mode="ngrok-inline"
            fi

            if ! wait_for_ngrok_tunnels "$DEVBOX_WEB_PORT" "$DEVBOX_STT_PORT" "1" "$DEVBOX_NGROK_API_PORT" 20; then
              if [[ "$started_tunnel_mode" == "ngrok-inline" ]]; then
                cleanup_processes "${pids[@]}"
              fi
              if [[ -n "$NGROK_LAST_ERROR" ]]; then
                die "$NGROK_LAST_ERROR
$(ngrok_plan_capacity_hint)"
              fi
              die "ngrok inspector(port=$DEVBOX_NGROK_API_PORT) did not expose matching web/stt tunnels within 20s.
$(ngrok_plan_capacity_hint)"
            fi
          else
            started_tunnel_mode="ngrok-reused"
          fi
          ;;
        cloudflare)
          require_cmd cloudflared
          local cloudflare_named_payload=""
          cloudflare_named_payload="$(resolve_cloudflare_named_tunnel_settings || true)"

          if [[ -n "$cloudflare_named_payload" ]]; then
            cloudflared_named_token="$(printf '%s\n' "$cloudflare_named_payload" | sed -n '1p')"
            cloudflared_named_web_host="$(printf '%s\n' "$cloudflare_named_payload" | sed -n '2p')"
            cloudflared_named_stt_host="$(printf '%s\n' "$cloudflare_named_payload" | sed -n '3p')"

            cloudflared_named_pid_file="$(cloudflared_named_pid_file_path)"
            cloudflared_named_log="$(cloudflared_named_log_file_path)"
            mkdir -p "$(dirname "$cloudflared_named_pid_file")"

            stop_cloudflared_named_tunnel_from_pidfile
            rm -f "$cloudflared_named_log"

            log "starting cloudflared named tunnel connector"
            cloudflared tunnel --no-autoupdate run --token "$cloudflared_named_token" >"$cloudflared_named_log" 2>&1 &
            local cloudflared_named_pid="$!"
            printf '%s\n' "$cloudflared_named_pid" > "$cloudflared_named_pid_file"
            pids+=("$cloudflared_named_pid")

            if ! wait_for_cloudflared_named_tunnel "$cloudflared_named_log" "$cloudflared_named_pid" 25; then
              cleanup_processes "${pids[@]}"
              rm -f "$cloudflared_named_pid_file"
              die "cloudflared named tunnel startup failed (log: $cloudflared_named_log)"
            fi

            cloudflared_web_url="https://$cloudflared_named_web_host"
            cloudflared_stt_url="https://$cloudflared_named_stt_host"
            started_tunnel_mode="cloudflare-named"
            log "cloudflared named tunnel ready: web=$cloudflared_web_url stt=$cloudflared_stt_url"
          else
            if [[ "$with_ios_clean_install" -eq 1 ]]; then
              stop_existing_cloudflared_by_local_port "$DEVBOX_WEB_PORT"
              stop_existing_cloudflared_by_local_port "$DEVBOX_STT_PORT"
            fi

            cloudflared_web_log="$(mktemp "${TMPDIR:-/tmp}/devbox-cloudflared-web.XXXXXX")"
            cloudflared_stt_log="$(mktemp "${TMPDIR:-/tmp}/devbox-cloudflared-stt.XXXXXX")"

            log "starting cloudflared quick tunnel for web(port=$DEVBOX_WEB_PORT)"
            cloudflared tunnel --url "http://127.0.0.1:$DEVBOX_WEB_PORT" --no-autoupdate >"$cloudflared_web_log" 2>&1 &
            cloudflared_web_pid="$!"
            pids+=("$cloudflared_web_pid")

            log "starting cloudflared quick tunnel for stt(port=$DEVBOX_STT_PORT)"
            cloudflared tunnel --url "http://127.0.0.1:$DEVBOX_STT_PORT" --no-autoupdate >"$cloudflared_stt_log" 2>&1 &
            cloudflared_stt_pid="$!"
            pids+=("$cloudflared_stt_pid")

            if ! cloudflared_web_url="$(wait_for_cloudflared_tunnel_url "$cloudflared_web_log" "$cloudflared_web_pid" 25)"; then
              cleanup_processes "${pids[@]}"
              die "cloudflared web tunnel startup failed (log: $cloudflared_web_log)"
            fi
            if ! cloudflared_stt_url="$(wait_for_cloudflared_tunnel_url "$cloudflared_stt_log" "$cloudflared_stt_pid" 25)"; then
              cleanup_processes "${pids[@]}"
              die "cloudflared stt tunnel startup failed (log: $cloudflared_stt_log)"
            fi

            started_tunnel_mode="cloudflare-quick"
            log "cloudflared quick tunnel ready: web=$cloudflared_web_url stt=$cloudflared_stt_url"
          fi
          ;;
        *)
          die "unsupported tunnel provider: $tunnel_provider"
          ;;
      esac
    fi
  elif [[ -n "$device_app_env" ]]; then
    die "--device-app-env is only supported with --profile device"
  fi

  if [[ "$profile" == "device" && "$device_app_env" == "prod" ]]; then
    log "device app env is prod; skipping device profile URL sync"
  else
    if [[ "$profile" == "device" && "$tunnel_provider" == "cloudflare" && "$device_app_env" != "prod" ]]; then
      set_device_profile_values_from_urls "$cloudflared_web_url" "$cloudflared_stt_url" "cloudflare"
      save_and_refresh
    else
      apply_profile "$profile" "$host"
    fi
    cmd_status
  fi

  if [[ "$profile" == "device" && -n "$device_app_env" ]]; then
    local device_app_env_payload=""
    local device_app_env_path=""
    device_app_env_payload="$(resolve_device_app_env_override "$device_app_env")"
    device_app_env_path="$(printf '%s\n' "$device_app_env_payload" | sed -n '1p')"
    mobile_site_override="$(printf '%s\n' "$device_app_env_payload" | sed -n '2p')"
    mobile_ws_override="$(printf '%s\n' "$device_app_env_payload" | sed -n '3p')"
    log "device app env override: $device_app_env (${device_app_env_path:-})"
  fi

  if [[ "$with_ios_install" -eq 1 || "$with_android_install" -eq 1 ]]; then
    local do_rn_ios=0
    local do_native_ios=0
    local do_android=0

    if [[ "$with_ios_install" -eq 1 ]]; then
      case "$ios_runtime" in
        rn) do_rn_ios=1 ;;
        native) do_native_ios=1 ;;
        both) do_rn_ios=1; do_native_ios=1 ;;
      esac
    fi

    if [[ "$with_android_install" -eq 1 ]]; then
      do_android=1
    fi

    if [[ -n "$ios_udid" ]]; then
      do_rn_ios=1
    fi
    if [[ -n "$ios_coredevice_id" ]]; then
      do_native_ios=1
      ios_native_target="device"
    fi
    if [[ -n "$ios_simulator_udid" ]]; then
      do_native_ios=1
      ios_native_target="simulator"
    fi
    if [[ "$ios_native_target" == "simulator" ]]; then
      do_native_ios=1
    fi
    if [[ -n "$android_serial" ]]; then
      do_android=1
    fi

    run_mobile_install_targets \
      "$do_rn_ios" \
      "$do_native_ios" \
      "$do_android" \
      "$ios_udid" \
      "$ios_coredevice_id" \
      "$android_serial" \
      "$ios_configuration" \
      "$android_variant" \
      "$ios_native_target" \
      "$ios_simulator_name" \
      "$ios_simulator_udid" \
      "$with_ios_clean_install" \
      "$mobile_site_override" \
      "$mobile_ws_override"
  fi

  if [[ "$profile" == "device" && "$device_app_env" == "prod" ]]; then
    log "device app env is prod; skipping mingle-app/mingle-stt/tunnel runtime startup"
    rm -f "$runtime_app_env_file" "$runtime_stt_env_file"
    return 0
  fi

  log "starting mingle-stt(port=$DEVBOX_STT_PORT) + mingle-app(port=$DEVBOX_WEB_PORT)"
  (
    cd "$ROOT_DIR/mingle-stt"
    if [[ -s "$runtime_stt_env_file" ]]; then
      set -a
      # shellcheck disable=SC1090
      . "$runtime_stt_env_file"
      set +a
    fi
    PORT="$DEVBOX_STT_PORT" pnpm dev
  ) &
  pids+=("$!")

  (
    cd "$ROOT_DIR/mingle-app"
    if [[ -s "$runtime_app_env_file" ]]; then
      set -a
      # shellcheck disable=SC1090
      . "$runtime_app_env_file"
      set +a
    fi
    DEVBOX_WORKTREE_NAME="$DEVBOX_WORKTREE_NAME" \
    DEVBOX_PROFILE="$DEVBOX_PROFILE" \
    DEVBOX_WEB_PORT="$DEVBOX_WEB_PORT" \
    DEVBOX_STT_PORT="$DEVBOX_STT_PORT" \
    DEVBOX_METRO_PORT="$DEVBOX_METRO_PORT" \
    NEXT_PUBLIC_SITE_URL="$DEVBOX_SITE_URL" \
    NEXTAUTH_URL="$DEVBOX_SITE_URL" \
    NEXTAUTH_SECRET="$runtime_nextauth_secret" \
    AUTH_SECRET="$runtime_nextauth_secret" \
    NEXT_PUBLIC_WS_PORT="$DEVBOX_STT_PORT" \
    NEXT_PUBLIC_WS_URL="$DEVBOX_PUBLIC_WS_URL" \
    NEXT_PUBLIC_API_NAMESPACE="$IOS_RN_REQUIRED_API_NAMESPACE" \
    MINGLE_TEST_API_BASE_URL="$DEVBOX_TEST_API_BASE_URL" \
    MINGLE_TEST_WS_URL="$DEVBOX_TEST_WS_URL" \
    pnpm exec next dev --port "$DEVBOX_WEB_PORT"
  ) &
  pids+=("$!")

  if [[ "$with_metro" -eq 1 ]]; then
    require_cmd node
    log "starting Metro(port=$DEVBOX_METRO_PORT)"
    (
      cd "$ROOT_DIR/mingle-app"
      if [[ -s "$runtime_app_env_file" ]]; then
        set -a
        # shellcheck disable=SC1090
        . "$runtime_app_env_file"
        set +a
      fi
      DEVBOX_WORKTREE_NAME="$DEVBOX_WORKTREE_NAME" \
      DEVBOX_PROFILE="$DEVBOX_PROFILE" \
      DEVBOX_WEB_PORT="$DEVBOX_WEB_PORT" \
      DEVBOX_STT_PORT="$DEVBOX_STT_PORT" \
      DEVBOX_METRO_PORT="$DEVBOX_METRO_PORT" \
      NEXT_PUBLIC_SITE_URL="$DEVBOX_SITE_URL" \
      NEXTAUTH_URL="$DEVBOX_SITE_URL" \
      NEXTAUTH_SECRET="$runtime_nextauth_secret" \
      AUTH_SECRET="$runtime_nextauth_secret" \
      NEXT_PUBLIC_WS_PORT="$DEVBOX_STT_PORT" \
      NEXT_PUBLIC_WS_URL="$DEVBOX_PUBLIC_WS_URL" \
      NEXT_PUBLIC_API_NAMESPACE="$IOS_RN_REQUIRED_API_NAMESPACE" \
      MINGLE_TEST_API_BASE_URL="$DEVBOX_TEST_API_BASE_URL" \
      MINGLE_TEST_WS_URL="$DEVBOX_TEST_WS_URL" \
      node scripts/run-with-env-local.mjs pnpm --dir rn start --port "$DEVBOX_METRO_PORT"
    ) &
    pids+=("$!")
  fi

  rm -f "$runtime_app_env_file" "$runtime_stt_env_file"

  if [[ "$started_tunnel_mode" == "ngrok-inline" ]]; then
    log "ngrok is running with this process group (Ctrl+C to stop all)"
  elif [[ "$started_tunnel_mode" == "ngrok-separate" ]]; then
    log "ngrok is running in separate terminal pane/tab"
  elif [[ "$started_tunnel_mode" == "ngrok-reused" ]]; then
    log "reusing existing ngrok tunnels from inspector"
  elif [[ "$started_tunnel_mode" == "cloudflare-quick" ]]; then
    log "cloudflared quick tunnels are running with this process group (Ctrl+C to stop all)"
    log "cloudflared logs: web=$cloudflared_web_log stt=$cloudflared_stt_log"
  elif [[ "$started_tunnel_mode" == "cloudflare-named" ]]; then
    log "cloudflared named tunnel connector is running with this process group (Ctrl+C to stop all)"
    log "cloudflared named tunnel log: $cloudflared_named_log"
  fi

  trap 'cleanup_processes "${pids[@]:-}"' INT TERM EXIT

  if ! wait_for_any_child_exit "${pids[@]}"; then
    exit_code=$?
  fi

  cleanup_processes "${pids[@]}"
  trap - INT TERM EXIT
  return "$exit_code"
}

cmd_down() {
  if [[ $# -gt 0 ]]; then
    die "unknown option for down: $1"
  fi

  require_devbox_env
  log "stopping devbox runtime processes for repo: $ROOT_DIR"

  stop_processes_by_pattern "mingle-app next dev" "$ROOT_DIR/mingle-app.*next dev --port"
  stop_processes_by_pattern "mingle-stt dev server" "$ROOT_DIR/mingle-stt.*stt-server.ts"
  stop_processes_by_pattern "metro" "$ROOT_DIR/mingle-app.*pnpm --dir rn start --port"

  stop_listeners_by_port "mingle-app next dev" "$DEVBOX_WEB_PORT"
  stop_listeners_by_port "mingle-stt dev server" "$DEVBOX_STT_PORT"
  stop_listeners_by_port "metro" "$DEVBOX_METRO_PORT"
  stop_existing_ngrok_by_inspector_port "$DEVBOX_NGROK_API_PORT"
  stop_existing_cloudflared_by_local_port "$DEVBOX_WEB_PORT"
  stop_existing_cloudflared_by_local_port "$DEVBOX_STT_PORT"
  stop_cloudflared_named_tunnel_from_pidfile

  local next_lock_file="$ROOT_DIR/mingle-app/.next/dev/lock"
  if [[ -f "$next_lock_file" ]]; then
    rm -f "$next_lock_file"
    log "removed stale lock file: $next_lock_file"
  fi

  log "devbox down complete"
}

cmd_ios_native_build() {
  local ios_configuration="Debug"
  local ios_coredevice_id=""
  local ios_bundle_id="${MINGLE_IOS_BUNDLE_ID:-com.nam.mingleios}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --ios-configuration) ios_configuration="${2:-}"; shift 2 ;;
      --ios-coredevice-id) ios_coredevice_id="${2:-}"; shift 2 ;;
      *) die "unknown option for ios-native-build: $1" ;;
    esac
  done

  ios_configuration="$(normalize_ios_configuration "$ios_configuration")"

  local api_base_url=""
  local ws_url=""
  require_devbox_env
  api_base_url="$DEVBOX_SITE_URL"
  ws_url="$DEVBOX_RN_WS_URL"

  run_native_ios_build "$ios_coredevice_id" "$ios_configuration" "$api_base_url" "$ws_url" "$ios_bundle_id"
}

cmd_ios_native_uninstall() {
  local ios_native_target="simulator"
  local ios_simulator_name="iPhone 16"
  local ios_simulator_udid=""
  local ios_coredevice_id=""
  local bundle_id="${MINGLE_IOS_BUNDLE_ID:-com.nam.mingleios}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --ios-native-target) ios_native_target="${2:-}"; shift 2 ;;
      --ios-simulator-name) ios_simulator_name="${2:-}"; shift 2 ;;
      --ios-simulator-udid) ios_simulator_udid="${2:-}"; shift 2 ;;
      --ios-coredevice-id) ios_coredevice_id="${2:-}"; shift 2 ;;
      --bundle-id) bundle_id="${2:-}"; shift 2 ;;
      *) die "unknown option for ios-native-uninstall: $1" ;;
    esac
  done

  ios_native_target="$(normalize_ios_native_target "$ios_native_target")"
  [[ -n "$bundle_id" ]] || die "--bundle-id must not be empty"
  require_cmd xcrun

  if [[ "$ios_native_target" == "simulator" ]]; then
    local simulator_udid
    simulator_udid="$(resolve_ios_simulator_udid_for_uninstall "$ios_simulator_name" "$ios_simulator_udid")"
    log "uninstalling native iOS app bundle '$bundle_id' from simulator: $simulator_udid"
    if xcrun simctl uninstall "$simulator_udid" "$bundle_id"; then
      log "native iOS app uninstalled from simulator: $simulator_udid"
    else
      log "native iOS app uninstall skipped (bundle may be absent): $bundle_id on $simulator_udid"
    fi
    return 0
  fi

  local coredevice_id="$ios_coredevice_id"
  if [[ -z "$coredevice_id" ]]; then
    coredevice_id="$(detect_ios_coredevice_id || true)"
  fi
  [[ -n "$coredevice_id" ]] || die "iOS device not detected; specify --ios-coredevice-id"

  log "uninstalling native iOS app bundle '$bundle_id' from device: $coredevice_id"
  if xcrun devicectl device uninstall app --device "$coredevice_id" "$bundle_id"; then
    log "native iOS app uninstalled from device: $coredevice_id"
  else
    log "native iOS app uninstall skipped (bundle may be absent): $bundle_id on $coredevice_id"
  fi
}

cmd_test() {
  require_devbox_env
  local target="app"
  local ios_configuration="Debug"
  local -a app_test_args=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --target) target="${2:-}"; shift 2 ;;
      --ios-configuration) ios_configuration="${2:-}"; shift 2 ;;
      --) shift; app_test_args+=("$@"); break ;;
      *) app_test_args+=("$1"); shift ;;
    esac
  done

  ios_configuration="$(normalize_ios_configuration "$ios_configuration")"

  local run_app=0
  local run_ios_native=0
  case "$target" in
    app) run_app=1 ;;
    ios-native) run_ios_native=1 ;;
    all) run_app=1; run_ios_native=1 ;;
    *) die "invalid --target: $target (expected app|ios-native|all)" ;;
  esac

  if [[ "$run_app" -eq 1 ]]; then
    require_cmd pnpm
    (
      cd "$ROOT_DIR/mingle-app"
      if ((${#app_test_args[@]} > 0)); then
        MINGLE_TEST_API_BASE_URL="$DEVBOX_TEST_API_BASE_URL" \
        MINGLE_TEST_WS_URL="$DEVBOX_TEST_WS_URL" \
          pnpm test:live "${app_test_args[@]}"
      else
        MINGLE_TEST_API_BASE_URL="$DEVBOX_TEST_API_BASE_URL" \
        MINGLE_TEST_WS_URL="$DEVBOX_TEST_WS_URL" \
          pnpm test:live
      fi
    )
  fi

  if [[ "$run_ios_native" -eq 1 ]]; then
    [[ -x "$MINGLE_IOS_TEST_SCRIPT" ]] || die "native iOS test script not found: $MINGLE_IOS_TEST_SCRIPT"
    require_cmd xcodebuild
    require_cmd xcodegen
    log "running mingle-ios native test build ($ios_configuration)"
    (
      cd "$MINGLE_IOS_DIR"
      NEXT_PUBLIC_SITE_URL="$DEVBOX_SITE_URL" \
      NEXT_PUBLIC_WS_URL="$DEVBOX_RN_WS_URL" \
      CONFIGURATION="$ios_configuration" \
        "$MINGLE_IOS_TEST_SCRIPT"
    )
  fi
}

cmd_status() {
  require_devbox_env
  local ngrok_web_domain="(auto)"
  local detected_ngrok_web_domain=""
  local tunnel_provider=""
  local cloudflare_mode="quick"
  local ngrok_line=""
  local ngrok_domain_line=""
  local devbox_env_note="$DEVBOX_ENV_FILE (optional; write only when DEVBOX_PERSIST_ENV_FILE=true)"
  detected_ngrok_web_domain="$(resolve_ngrok_web_domain || true)"
  tunnel_provider="$(resolve_tunnel_provider "")"
  if [[ "$tunnel_provider" == "cloudflare" ]]; then
    if resolve_cloudflare_named_tunnel_settings >/dev/null 2>&1; then
      cloudflare_mode="named"
    fi
  fi
  if [[ -n "$detected_ngrok_web_domain" ]]; then
    ngrok_web_domain="$detected_ngrok_web_domain"
  fi
  ngrok_line="[devbox] ngrok:    inspector=http://127.0.0.1:$DEVBOX_NGROK_API_PORT"
  ngrok_domain_line="[devbox] ngrok-web-domain: $ngrok_web_domain"
  if [[ "$tunnel_provider" != "ngrok" ]]; then
    ngrok_line="[devbox] ngrok:    disabled for provider=$tunnel_provider"
    ngrok_domain_line="[devbox] ngrok-web-domain: (n/a)"
  fi

  cat <<EOF
[devbox] worktree: $DEVBOX_WORKTREE_NAME
[devbox] profile:  $DEVBOX_PROFILE
[devbox] ports:    web=$DEVBOX_WEB_PORT stt=$DEVBOX_STT_PORT metro=$DEVBOX_METRO_PORT
[devbox] tunnel:   provider=$tunnel_provider$( [[ "$tunnel_provider" == "cloudflare" ]] && printf ' mode=%s' "$cloudflare_mode" )
$ngrok_line
$ngrok_domain_line

PC Web      : $DEVBOX_SITE_URL
iOS Web     : $DEVBOX_SITE_URL
Android Web : $DEVBOX_SITE_URL
iOS App     : NEXT_PUBLIC_SITE_URL=$DEVBOX_SITE_URL | NEXT_PUBLIC_WS_URL=$DEVBOX_RN_WS_URL | NEXT_PUBLIC_API_NAMESPACE=$IOS_RN_REQUIRED_API_NAMESPACE
iOS Native  : NEXT_PUBLIC_SITE_URL=$DEVBOX_SITE_URL | NEXT_PUBLIC_WS_URL=$DEVBOX_RN_WS_URL
Android App : NEXT_PUBLIC_SITE_URL=$DEVBOX_SITE_URL | NEXT_PUBLIC_WS_URL=$DEVBOX_RN_WS_URL
Live Test   : MINGLE_TEST_API_BASE_URL=$DEVBOX_TEST_API_BASE_URL | MINGLE_TEST_WS_URL=$DEVBOX_TEST_WS_URL
Vault App   : ${DEVBOX_VAULT_APP_PATH:-"(unset)"}
Vault STT   : ${DEVBOX_VAULT_STT_PATH:-"(unset)"}
OpenClaw    : root=${DEVBOX_OPENCLAW_ROOT:-$(resolve_openclaw_root)}
iOS Team ID : ${DEVBOX_IOS_TEAM_ID:-"(auto: mingle.xcodeproj DEVELOPMENT_TEAM)"}

Files:
- $devbox_env_note
- $APP_ENV_FILE
- $STT_ENV_FILE
- $NGROK_LOCAL_CONFIG
- $RN_IOS_RUNTIME_XCCONFIG

Run:
- scripts/devbox up --profile local
- scripts/devbox up --profile device
- scripts/devbox up --profile device --tunnel-provider cloudflare
- scripts/devbox bootstrap --vault-push
- scripts/devbox gateway --mode dev
- scripts/devbox gateway --mode run -- --bind loopback --port 18789
- scripts/devbox up --profile device --device-app-env dev --with-ios-install
- scripts/devbox up --profile device --device-app-env prod --with-ios-install
- scripts/devbox up --profile device --with-mobile-install
- scripts/devbox up --profile device --with-ios-install --ios-runtime native
- scripts/devbox up --profile local --with-ios-install --ios-runtime native --ios-native-target simulator
- scripts/devbox up --profile local --with-metro
- scripts/devbox ios-native-build --ios-configuration Debug
- scripts/devbox ios-rn-ipa --device-app-env prod
- scripts/devbox ios-rn-ipa-prod
- scripts/devbox ios-native-uninstall --ios-native-target simulator --ios-simulator-udid <UDID>
- scripts/devbox mobile --platform ios --ios-runtime rn
- scripts/devbox mobile --platform ios --ios-runtime native
- scripts/devbox mobile --platform ios --ios-runtime native --ios-native-target simulator --ios-simulator-name "iPhone 16"
- scripts/devbox mobile --platform android
- scripts/devbox test --target ios-native
- scripts/devbox profile --profile local --host <LAN_IP>
- scripts/devbox test
EOF
}

default_log_file_path() {
  local timestamp worktree
  timestamp="$(date '+%Y%m%d-%H%M%S')"
  worktree="${DEVBOX_WORKTREE_NAME:-$(derive_worktree_name)}"
  worktree="${worktree//[^A-Za-z0-9._-]/-}"
  printf '%s/devbox-%s-%s.log' "$DEVBOX_LOG_DIR" "$worktree" "$timestamp"
}

resolve_log_file_path() {
  local raw_value="$1"
  local value="$raw_value"

  [[ -n "$value" ]] || die "missing value for --log-file (expected PATH or auto)"
  if [[ "$value" == "auto" ]]; then
    value="$(default_log_file_path)"
  elif [[ "$value" != /* ]]; then
    value="$ROOT_DIR/$value"
  fi

  ensure_single_line_value "log file path" "$value"
  printf '%s' "$value"
}

enable_log_capture() {
  local file="$1"
  local fifo_path

  command -v tee >/dev/null 2>&1 || die "required command not found: tee"
  mkdir -p "$(dirname "$file")"
  printf '===== devbox log started %s =====\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" >> "$file"
  fifo_path="$(mktemp -u "${TMPDIR:-/tmp}/devbox-log.XXXXXX")"
  mkfifo "$fifo_path"
  tee -a "$file" < "$fifo_path" &
  exec > "$fifo_path" 2>&1
  rm -f "$fifo_path"
  log "log capture enabled: $file"
}

main() {
  local log_file_option=""
  local -a filtered_args=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --log-file)
        [[ $# -ge 2 ]] || die "missing value for --log-file"
        log_file_option="$2"
        shift 2
        ;;
      --log-file=*)
        log_file_option="${1#--log-file=}"
        shift
        ;;
      *)
        filtered_args+=("$1")
        shift
        ;;
    esac
  done

  if [[ -n "$log_file_option" ]]; then
    DEVBOX_LOG_FILE="$(resolve_log_file_path "$log_file_option")"
    enable_log_capture "$DEVBOX_LOG_FILE"
  fi

  local cmd="help"
  if [[ "${#filtered_args[@]}" -gt 0 ]]; then
    cmd="${filtered_args[0]}"
    if [[ "${#filtered_args[@]}" -gt 1 ]]; then
      set -- "${filtered_args[@]:1}"
    else
      set --
    fi
  else
    set --
  fi

  case "$cmd" in
    init) cmd_init "$@" ;;
    bootstrap) cmd_bootstrap "$@" ;;
    profile) cmd_profile "$@" ;;
    profile-local) cmd_profile --profile local "$@" ;;
    profile-device|profile-ngrok) cmd_profile --profile device "$@" ;;
    ngrok-config) cmd_ngrok_config "$@" ;;
    gateway|openclaw-gateway) cmd_gateway "$@" ;;
    ios-native-build|ios-build-native) cmd_ios_native_build "$@" ;;
    ios-native-uninstall|ios-uninstall-native|ios-native-remove) cmd_ios_native_uninstall "$@" ;;
    ios-rn-ipa|ios-build-rn-ipa) cmd_ios_rn_ipa "$@" ;;
    ios-rn-ipa-prod|ios-build-rn-ipa-prod) cmd_ios_rn_ipa --device-app-env prod "$@" ;;
    mobile) cmd_mobile "$@" ;;
    up) cmd_up "$@" ;;
    down) cmd_down "$@" ;;
    test|test-live) cmd_test "$@" ;;
    status) cmd_status "$@" ;;
    help|-h|--help) usage ;;
    *) die "unknown command: $cmd (run: scripts/devbox help)" ;;
  esac
}

main "$@"

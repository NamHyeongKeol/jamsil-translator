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
MANAGED_START="# >>> devbox managed (auto)"
MANAGED_END="# <<< devbox managed (auto)"

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
  RN_WEB_APP_BASE_URL
  NEXT_PUBLIC_WS_PORT
  NEXT_PUBLIC_WS_URL
  RN_DEFAULT_WS_URL
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

# Values loaded/generated via .devbox.env.
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
DEVBOX_LOG_FILE=""

log() {
  printf '[devbox] %s\n' "$*"
}

die() {
  printf '[devbox] %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  scripts/devbox [--log-file PATH|auto] <command> [options]
  scripts/devbox init [--web-port N] [--stt-port N] [--metro-port N] [--ngrok-api-port N] [--host HOST]
  scripts/devbox bootstrap [--vault-app-path PATH] [--vault-stt-path PATH]
  scripts/devbox profile --profile local|device [--host HOST]
  scripts/devbox ngrok-config
  scripts/devbox mobile [--platform ios|android|all] [--ios-udid UDID] [--android-serial SERIAL] [--ios-configuration Debug|Release] [--android-variant debug|release] [--with-ios-clean-install] [--device-app-env dev|prod]
  scripts/devbox up [--profile local|device] [--host HOST] [--with-metro] [--with-ios-install] [--with-android-install] [--with-mobile-install] [--with-ios-clean-install] [--ios-udid UDID] [--android-serial SERIAL] [--ios-configuration Debug|Release] [--android-variant debug|release] [--device-app-env dev|prod] [--vault-app-path PATH] [--vault-stt-path PATH]
  scripts/devbox test [vitest args...]
  scripts/devbox status

Commands:
  init         Generate worktree-specific ports/config/env files.
  bootstrap    Seed env files from main/Vault and install dependencies.
  profile      Apply local/device profile to managed env files.
  ngrok-config Regenerate ngrok.mobile.local.yml from current ports.
  mobile       Build/install RN app(s) on connected iOS/Android device if available.
  up           Start STT + Next app together (device profile includes ngrok, auto-init if needed).
  test         Run mingle-app live integration tests with devbox endpoints.
  status       Print current endpoints for PC/iOS/Android web and app targets.

Global Options:
  --log-file PATH|auto  Save combined devbox stdout/stderr to PATH.
                        Relative paths resolve from repository root.
                        auto -> .devbox-logs/devbox-<worktree>-<timestamp>.log
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
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

read_env_value_from_vault() {
  local path="$1"
  local key="$2"
  local value

  [[ -n "$path" ]] || return 1
  [[ -n "$key" ]] || return 1

  require_cmd vault
  require_cmd jq

  value="$(vault kv get -format=json "$path" 2>/dev/null | jq -r --arg key "$key" '.data.data[$key] // ""')"
  [[ "$value" == "null" ]] && value=""
  [[ -n "$value" ]] && printf '%s' "$value"
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
    needs_install=1
    reason="Podfile.lock and Manifest.lock out of sync"
  fi

  if [[ "$needs_install" -eq 0 ]]; then
    return 0
  fi

  log "installing iOS pods: mingle-app/rn/ios ($reason)"
  (
    cd "$ROOT_DIR/mingle-app/rn"
    if command -v bundle >/dev/null 2>&1; then
      local bundle_home="$ROOT_DIR/.devbox-cache/bundle/rn"
      mkdir -p "$bundle_home"
      if ! BUNDLE_USER_HOME="$bundle_home" \
        BUNDLE_PATH="$bundle_home" \
        BUNDLE_DISABLE_SHARED_GEMS=true \
        bundle check >/dev/null 2>&1; then
        BUNDLE_USER_HOME="$bundle_home" \
        BUNDLE_PATH="$bundle_home" \
        BUNDLE_DISABLE_SHARED_GEMS=true \
          bundle install
      fi
      (
        cd ios
        BUNDLE_USER_HOME="$bundle_home" \
        BUNDLE_PATH="$bundle_home" \
        BUNDLE_DISABLE_SHARED_GEMS=true \
          bundle exec pod install
      )
    else
      (
        cd ios
        pod install
      )
    fi
  )
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

sync_env_from_vault_path() {
  local target="$1"
  local path="$2"
  local file="$3"
  [[ -n "$path" ]] || return 0

  require_cmd vault
  require_cmd jq

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

resolve_vault_paths() {
  local app_override="${1:-}"
  local stt_override="${2:-}"
  local app_path="${DEVBOX_VAULT_APP_PATH:-}"
  local stt_path="${DEVBOX_VAULT_STT_PATH:-}"

  if [[ -n "$app_override" ]]; then
    app_path="$app_override"
  fi
  if [[ -n "$stt_override" ]]; then
    stt_path="$stt_override"
  fi

  DEVBOX_VAULT_APP_PATH="$app_path"
  DEVBOX_VAULT_STT_PATH="$stt_path"
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
      DEVBOX_WORKTREE_NAME|DEVBOX_ROOT_DIR|DEVBOX_WEB_PORT|DEVBOX_STT_PORT|DEVBOX_METRO_PORT|DEVBOX_PROFILE|DEVBOX_LOCAL_HOST|DEVBOX_SITE_URL|DEVBOX_RN_WS_URL|DEVBOX_PUBLIC_WS_URL|DEVBOX_TEST_API_BASE_URL|DEVBOX_TEST_WS_URL|DEVBOX_VAULT_APP_PATH|DEVBOX_VAULT_STT_PATH|DEVBOX_NGROK_API_PORT)
        printf -v "$key" '%s' "$value"
        ;;
      *)
        die "unknown key in $DEVBOX_ENV_FILE: $key"
        ;;
    esac
  done < "$DEVBOX_ENV_FILE"
}

require_devbox_env() {
  [[ -f "$DEVBOX_ENV_FILE" ]] || die "missing $DEVBOX_ENV_FILE (run: scripts/devbox init)"
  load_devbox_env

  : "${DEVBOX_WORKTREE_NAME:?missing DEVBOX_WORKTREE_NAME}"
  : "${DEVBOX_WEB_PORT:?missing DEVBOX_WEB_PORT}"
  : "${DEVBOX_STT_PORT:?missing DEVBOX_STT_PORT}"
  : "${DEVBOX_METRO_PORT:?missing DEVBOX_METRO_PORT}"
  if [[ -z "${DEVBOX_NGROK_API_PORT:-}" ]]; then
    DEVBOX_NGROK_API_PORT="$((DEVBOX_WEB_PORT + 7000))"
  fi
  : "${DEVBOX_PROFILE:?missing DEVBOX_PROFILE}"
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
RN_WEB_APP_BASE_URL=$DEVBOX_SITE_URL
NEXT_PUBLIC_WS_PORT=$DEVBOX_STT_PORT
NEXT_PUBLIC_WS_URL=$DEVBOX_PUBLIC_WS_URL
RN_DEFAULT_WS_URL=$DEVBOX_RN_WS_URL
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

write_ngrok_local_config() {
  cat > "$NGROK_LOCAL_CONFIG" <<EOF
version: "3"
agent:
  web_addr: 127.0.0.1:$DEVBOX_NGROK_API_PORT
tunnels:
  devbox_web:
    addr: $DEVBOX_WEB_PORT
    proto: http
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
MINGLE_WEB_APP_BASE_URL = "$escaped_site_url"
MINGLE_DEFAULT_WS_URL = "$escaped_ws_url"
MINGLE_WEB_APP_SCHEME = $site_scheme
MINGLE_WEB_APP_HOST = $site_host
MINGLE_DEFAULT_WS_SCHEME = $ws_scheme
MINGLE_DEFAULT_WS_HOST = $ws_host
EOF
}

refresh_runtime_files() {
  write_app_env_block
  ensure_devbox_nextauth_secret
  write_stt_env_block
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

normalize_android_variant() {
  local raw="${1:-release}"
  case "$raw" in
    debug|Debug) printf 'debug' ;;
    release|Release) printf 'release' ;;
    *) die "invalid --android-variant: $raw (expected debug|release)" ;;
  esac
}

detect_ios_device_udid() {
  command -v xcrun >/dev/null 2>&1 || return 1
  xcrun xctrace list devices 2>/dev/null | \
    sed -nE '/Simulator/d; s/^.*\([^)]*\)[[:space:]]+\(([A-Fa-f0-9-]{8,})\)$/\1/p' | \
    head -n 1
}

detect_android_device_serial() {
  command -v adb >/dev/null 2>&1 || return 1
  adb devices | awk 'NR > 1 && $2 == "device" { print $1; exit }'
}

resolve_ios_bundle_id() {
  local project_file="$ROOT_DIR/mingle-app/rn/ios/rnnative.xcodeproj/project.pbxproj"
  if [[ -f "$project_file" ]]; then
    awk -F'= ' '/PRODUCT_BUNDLE_IDENTIFIER = /{gsub(/;$/, "", $2); print $2; exit}' "$project_file"
    return 0
  fi
  printf '%s' "com.rnnative"
}

resolve_android_application_id() {
  local gradle_file="$ROOT_DIR/mingle-app/rn/android/app/build.gradle"
  if [[ -f "$gradle_file" ]]; then
    awk -F'"' '/applicationId[[:space:]]+"/{print $2; exit}' "$gradle_file"
    return 0
  fi
  printf '%s' "com.rnnative"
}

run_ios_mobile_install() {
  local requested_udid="${1:-}"
  local configuration="$2"
  local with_clean_install="${3:-0}"
  local udid="$requested_udid"

  if [[ -z "$udid" ]]; then
    udid="$(detect_ios_device_udid || true)"
  fi

  if [[ -z "$udid" ]]; then
    log "iOS device not detected; skipping iOS build/install"
    return 0
  fi

  require_cmd xcodebuild
  require_cmd xcrun
  ensure_rn_workspace_dependencies
  ensure_ios_pods_if_needed

  local derived_data_path="$ROOT_DIR/.devbox-cache/ios/$DEVBOX_WORKTREE_NAME"
  local app_path="$derived_data_path/Build/Products/${configuration}-iphoneos/rnnative.app"
  local bundle_id
  bundle_id="$(resolve_ios_bundle_id)"

  if [[ "$with_clean_install" -eq 1 && -n "$bundle_id" ]]; then
    log "uninstalling existing iOS app before reinstall: $bundle_id"
    xcrun devicectl device uninstall app --device "$udid" "$bundle_id" || \
      log "iOS uninstall skipped (app may not be installed)"
  fi

  if [[ "$with_clean_install" -eq 1 ]]; then
    log "cleaning iOS build artifacts for consistent runtime injection: $derived_data_path"
    rm -rf "$derived_data_path"
  fi

  write_rn_ios_runtime_xcconfig

  mkdir -p "$(dirname "$derived_data_path")"

  log "building iOS app ($configuration) for device: $udid"
  (
    cd "$ROOT_DIR/mingle-app/rn/ios"
    xcodebuild \
      -workspace rnnative.xcworkspace \
      -scheme rnnative \
      -configuration "$configuration" \
      -destination "id=$udid" \
      -derivedDataPath "$derived_data_path" \
      -xcconfig "$RN_IOS_RUNTIME_XCCONFIG" \
      build
  )

  [[ -d "$app_path" ]] || die "built iOS app not found: $app_path"

  log "installing iOS app on device: $udid"
  xcrun devicectl device install app --device "$udid" "$app_path"

  if [[ -n "$bundle_id" ]]; then
    log "launching iOS app bundle: $bundle_id"
    xcrun devicectl device process launch --device "$udid" "$bundle_id" >/dev/null 2>&1 || \
      log "iOS app launch skipped (manual launch may be required)"
  fi
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
    RN_WEB_APP_BASE_URL="$DEVBOX_SITE_URL" \
    RN_DEFAULT_WS_URL="$DEVBOX_RN_WS_URL" \
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
  local do_ios="$1"
  local do_android="$2"
  local ios_udid="$3"
  local android_serial="$4"
  local ios_configuration="$5"
  local android_variant="$6"
  local with_ios_clean_install="$7"
  local app_site_override="${8:-}"
  local app_ws_override="${9:-}"

  (
    if [[ -n "$app_site_override" ]]; then
      DEVBOX_SITE_URL="$app_site_override"
    fi
    if [[ -n "$app_ws_override" ]]; then
      DEVBOX_RN_WS_URL="$app_ws_override"
    fi

    if [[ "$do_ios" -eq 1 ]]; then
      run_ios_mobile_install "$ios_udid" "$ios_configuration" "$with_ios_clean_install"
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

set_device_profile_values() {
  read_ngrok_urls "$DEVBOX_WEB_PORT" "$DEVBOX_STT_PORT" "1" "$DEVBOX_NGROK_API_PORT"

  DEVBOX_PROFILE="device"
  DEVBOX_LOCAL_HOST="127.0.0.1"
  DEVBOX_SITE_URL="$NGROK_WEB_URL"
  DEVBOX_RN_WS_URL="$(to_wss_url "$NGROK_STT_URL")"
  DEVBOX_PUBLIC_WS_URL="$DEVBOX_RN_WS_URL"
  DEVBOX_TEST_API_BASE_URL="http://127.0.0.1:$DEVBOX_WEB_PORT"
  DEVBOX_TEST_WS_URL="ws://127.0.0.1:$DEVBOX_STT_PORT"

  validate_https_url "ngrok web url" "$DEVBOX_SITE_URL"
  validate_wss_url "ngrok stt url" "$DEVBOX_RN_WS_URL"
}

resolve_device_app_env_override() {
  local mode="$1"
  local path=""
  local site_url=""
  local ws_url=""

  case "$mode" in
    dev|prod)
      path="secret/mingle-app/$mode"
      ;;
    *)
      die "invalid --device-app-env: $mode (expected dev|prod)"
      ;;
  esac

  site_url="$(read_env_value_from_vault "$path" RN_WEB_APP_BASE_URL || true)"
  [[ -z "$site_url" ]] && site_url="$(read_env_value_from_vault "$path" MINGLE_WEB_APP_BASE_URL || true)"
  [[ -z "$site_url" ]] && site_url="$(read_env_value_from_vault "$path" NEXT_PUBLIC_SITE_URL || true)"

  ws_url="$(read_env_value_from_vault "$path" RN_DEFAULT_WS_URL || true)"
  [[ -z "$ws_url" ]] && ws_url="$(read_env_value_from_vault "$path" MINGLE_DEFAULT_WS_URL || true)"
  [[ -z "$ws_url" ]] && ws_url="$(read_env_value_from_vault "$path" NEXT_PUBLIC_WS_URL || true)"

  [[ -n "$site_url" ]] || die "missing RN_WEB_APP_BASE_URL/MINGLE_WEB_APP_BASE_URL/NEXT_PUBLIC_SITE_URL in vault path: $path"
  [[ -n "$ws_url" ]] || die "missing RN_DEFAULT_WS_URL/MINGLE_DEFAULT_WS_URL/NEXT_PUBLIC_WS_URL in vault path: $path"

  validate_http_url "device app env site url" "$site_url"
  validate_ws_url "device app env ws url" "$ws_url"

  printf '%s\n%s\n%s\n' "$path" "$site_url" "$ws_url"
}

save_and_refresh() {
  write_devbox_env
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

  if [[ -f "$DEVBOX_ENV_FILE" ]]; then
    DEVBOX_VAULT_APP_PATH="$(read_env_value_from_file DEVBOX_VAULT_APP_PATH "$DEVBOX_ENV_FILE")"
    DEVBOX_VAULT_STT_PATH="$(read_env_value_from_file DEVBOX_VAULT_STT_PATH "$DEVBOX_ENV_FILE")"
    ngrok_api_port="$(read_env_value_from_file DEVBOX_NGROK_API_PORT "$DEVBOX_ENV_FILE")"
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --web-port) web_port="${2:-}"; shift 2 ;;
      --stt-port) stt_port="${2:-}"; shift 2 ;;
      --metro-port) metro_port="${2:-}"; shift 2 ;;
      --ngrok-api-port) ngrok_api_port="${2:-}"; shift 2 ;;
      --host) host="${2:-}"; shift 2 ;;
      *) die "unknown option for init: $1" ;;
    esac
  done

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

  seed_env_from_main_worktree
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

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --vault-app-path) vault_app_override="${2:-}"; shift 2 ;;
      --vault-stt-path) vault_stt_override="${2:-}"; shift 2 ;;
      *) die "unknown option for bootstrap: $1" ;;
    esac
  done

  if [[ -f "$DEVBOX_ENV_FILE" ]]; then
    require_devbox_env
  fi
  resolve_vault_paths "$vault_app_override" "$vault_stt_override"

  seed_env_from_main_worktree
  sync_env_from_vault_paths "$DEVBOX_VAULT_APP_PATH" "$DEVBOX_VAULT_STT_PATH"
  ensure_workspace_dependencies
  ensure_rn_workspace_dependencies
  ensure_ios_pods_if_needed
  if [[ -f "$DEVBOX_ENV_FILE" ]]; then
    save_and_refresh
  fi
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

cmd_mobile() {
  if [[ ! -f "$DEVBOX_ENV_FILE" ]]; then
    log "missing .devbox.env, running init automatically"
    cmd_init
  fi
  require_devbox_env
  require_cmd pnpm

  local active_profile="${DEVBOX_PROFILE:-local}"
  local active_host="${DEVBOX_LOCAL_HOST:-127.0.0.1}"
  local with_ios_clean_install=0
  local device_app_env=""
  local platform="all"
  local ios_udid=""
  local android_serial=""
  local ios_configuration="Release"
  local android_variant="release"
  local mobile_site_override=""
  local mobile_ws_override=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --platform) platform="${2:-}"; shift 2 ;;
      --ios-udid) ios_udid="${2:-}"; shift 2 ;;
      --android-serial) android_serial="${2:-}"; shift 2 ;;
      --ios-configuration) ios_configuration="${2:-}"; shift 2 ;;
      --android-variant) android_variant="${2:-}"; shift 2 ;;
      --with-ios-clean-install) with_ios_clean_install=1; shift ;;
      --device-app-env) device_app_env="${2:-}"; shift 2 ;;
      *) die "unknown option for mobile: $1" ;;
    esac
  done

  # parse arguments first so clean-install flag is available
  # for profile-level behavior below.
  case "$active_profile" in
    device)
      if [[ "$with_ios_clean_install" -eq 1 ]]; then
        stop_existing_ngrok_by_inspector_port "$DEVBOX_NGROK_API_PORT"
      fi
      # Refresh ngrok-derived URLs before mobile build/install to avoid stale app URL embedding.
      apply_profile "device"
      ;;
    local)
      apply_profile "local" "$active_host"
      ;;
    *)
      die "unsupported DEVBOX_PROFILE in .devbox.env: $active_profile (expected local|device)"
      ;;
  esac
  save_and_refresh

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

  local do_ios=0
  local do_android=0

  case "$platform" in
    ios)
      do_ios=1
      ;;
    android)
      do_android=1
      ;;
    all)
      do_ios=1
      do_android=1
      ;;
    *)
      die "invalid --platform: $platform (expected ios|android|all)"
      ;;
  esac

  if [[ -n "$ios_udid" ]]; then
    do_ios=1
  fi
  if [[ -n "$android_serial" ]]; then
    do_android=1
  fi

  run_mobile_install_targets \
    "$do_ios" \
    "$do_android" \
    "$ios_udid" \
    "$android_serial" \
    "$ios_configuration" \
    "$android_variant" \
    "$with_ios_clean_install" \
    "$mobile_site_override" \
    "$mobile_ws_override"

  log "mobile build/install complete"
}

cmd_up() {
  if [[ ! -f "$DEVBOX_ENV_FILE" ]]; then
    log "missing .devbox.env, running init automatically"
    cmd_init
  fi
  require_devbox_env
  require_cmd pnpm
  local vault_app_override=""
  local vault_stt_override=""
  seed_env_from_main_worktree

  local profile="local"
  local host=""
  local with_metro=0
  local with_ios_install=0
  local with_android_install=0
  local with_ios_clean_install=0
  local device_app_env=""
  local ios_udid=""
  local android_serial=""
  local ios_configuration="Release"
  local android_variant="release"
  local mobile_site_override=""
  local mobile_ws_override=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --profile) profile="${2:-}"; shift 2 ;;
      --host) host="${2:-}"; shift 2 ;;
      --with-metro) with_metro=1; shift ;;
      --with-ios-install) with_ios_install=1; shift ;;
      --with-android-install) with_android_install=1; shift ;;
      --with-mobile-install) with_ios_install=1; with_android_install=1; shift ;;
      --with-ios-clean-install) with_ios_clean_install=1; shift ;;
      --ios-udid) ios_udid="${2:-}"; with_ios_install=1; shift 2 ;;
      --android-serial) android_serial="${2:-}"; with_android_install=1; shift 2 ;;
      --ios-configuration) ios_configuration="${2:-}"; shift 2 ;;
      --android-variant) android_variant="${2:-}"; shift 2 ;;
      --device-app-env) device_app_env="${2:-}"; shift 2 ;;
      --vault-app-path) vault_app_override="${2:-}"; shift 2 ;;
      --vault-stt-path) vault_stt_override="${2:-}"; shift 2 ;;
      *) die "unknown option for up: $1" ;;
    esac
  done

  ios_configuration="$(normalize_ios_configuration "$ios_configuration")"
  android_variant="$(normalize_android_variant "$android_variant")"

  resolve_vault_paths "$vault_app_override" "$vault_stt_override"
  sync_env_from_vault_paths "$DEVBOX_VAULT_APP_PATH" "$DEVBOX_VAULT_STT_PATH"
  ensure_workspace_dependencies

  local -a pids=()
  local exit_code=0
  local started_ngrok_mode="none"

  if [[ "$profile" == "device" ]]; then
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
        started_ngrok_mode="separate"
        log "ngrok started in a separate terminal pane/tab"
      else
        log "separate terminal launch unavailable; falling back to inline ngrok"
        (
          cd "$ROOT_DIR"
          scripts/ngrok-start-mobile.sh --log stdout --log-format logfmt
        ) &
        pids+=("$!")
        started_ngrok_mode="inline"
      fi

      if ! wait_for_ngrok_tunnels "$DEVBOX_WEB_PORT" "$DEVBOX_STT_PORT" "1" "$DEVBOX_NGROK_API_PORT" 20; then
        if [[ "$started_ngrok_mode" == "inline" ]]; then
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
      started_ngrok_mode="reused"
    fi
  elif [[ -n "$device_app_env" ]]; then
    die "--device-app-env is only supported with --profile device"
  fi

  apply_profile "$profile" "$host"
  cmd_status

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
    run_mobile_install_targets \
      "$with_ios_install" \
      "$with_android_install" \
      "$ios_udid" \
      "$android_serial" \
      "$ios_configuration" \
      "$android_variant" \
      "$with_ios_clean_install" \
      "$mobile_site_override" \
      "$mobile_ws_override"
  fi

  log "starting mingle-stt(port=$DEVBOX_STT_PORT) + mingle-app(port=$DEVBOX_WEB_PORT)"
  (
    cd "$ROOT_DIR/mingle-stt"
    PORT="$DEVBOX_STT_PORT" pnpm dev
  ) &
  pids+=("$!")

  (
    cd "$ROOT_DIR/mingle-app"
    pnpm exec next dev --port "$DEVBOX_WEB_PORT"
  ) &
  pids+=("$!")

  if [[ "$with_metro" -eq 1 ]]; then
    require_cmd node
    log "starting Metro(port=$DEVBOX_METRO_PORT)"
    (
      cd "$ROOT_DIR/mingle-app"
      node scripts/run-with-env-local.mjs pnpm --dir rn start --port "$DEVBOX_METRO_PORT"
    ) &
    pids+=("$!")
  fi

  if [[ "$started_ngrok_mode" == "inline" ]]; then
    log "ngrok is running with this process group (Ctrl+C to stop all)"
  elif [[ "$started_ngrok_mode" == "separate" ]]; then
    log "ngrok is running in separate terminal pane/tab"
  elif [[ "$profile" == "device" ]]; then
    log "reusing existing ngrok tunnels from inspector"
  fi

  trap 'cleanup_processes "${pids[@]:-}"' INT TERM EXIT

  if ! wait_for_any_child_exit "${pids[@]}"; then
    exit_code=$?
  fi

  cleanup_processes "${pids[@]}"
  trap - INT TERM EXIT
  return "$exit_code"
}

cmd_test() {
  require_devbox_env
  require_cmd pnpm

  (
    cd "$ROOT_DIR/mingle-app"
    MINGLE_TEST_API_BASE_URL="$DEVBOX_TEST_API_BASE_URL" \
    MINGLE_TEST_WS_URL="$DEVBOX_TEST_WS_URL" \
      pnpm test:live "$@"
  )
}

cmd_status() {
  require_devbox_env

  cat <<EOF
[devbox] worktree: $DEVBOX_WORKTREE_NAME
[devbox] profile:  $DEVBOX_PROFILE
[devbox] ports:    web=$DEVBOX_WEB_PORT stt=$DEVBOX_STT_PORT metro=$DEVBOX_METRO_PORT
[devbox] ngrok:    inspector=http://127.0.0.1:$DEVBOX_NGROK_API_PORT

PC Web      : $DEVBOX_SITE_URL
iOS Web     : $DEVBOX_SITE_URL
Android Web : $DEVBOX_SITE_URL
iOS App     : RN_WEB_APP_BASE_URL=$DEVBOX_SITE_URL | RN_DEFAULT_WS_URL=$DEVBOX_RN_WS_URL
Android App : RN_WEB_APP_BASE_URL=$DEVBOX_SITE_URL | RN_DEFAULT_WS_URL=$DEVBOX_RN_WS_URL
Live Test   : MINGLE_TEST_API_BASE_URL=$DEVBOX_TEST_API_BASE_URL | MINGLE_TEST_WS_URL=$DEVBOX_TEST_WS_URL
Vault App   : ${DEVBOX_VAULT_APP_PATH:-"(unset)"}
Vault STT   : ${DEVBOX_VAULT_STT_PATH:-"(unset)"}

Files:
- $DEVBOX_ENV_FILE
- $APP_ENV_FILE
- $STT_ENV_FILE
- $NGROK_LOCAL_CONFIG
- $RN_IOS_RUNTIME_XCCONFIG

Run:
- scripts/devbox up --profile local
- scripts/devbox up --profile device
- scripts/devbox up --profile device --device-app-env dev --with-ios-install
- scripts/devbox up --profile device --device-app-env prod --with-ios-install
- scripts/devbox up --profile device --with-mobile-install
- scripts/devbox up --profile local --with-metro
- scripts/devbox mobile --platform ios
- scripts/devbox mobile --platform android
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
    mobile) cmd_mobile "$@" ;;
    up) cmd_up "$@" ;;
    test|test-live) cmd_test "$@" ;;
    status) cmd_status "$@" ;;
    help|-h|--help) usage ;;
    *) die "unknown command: $cmd (run: scripts/devbox help)" ;;
  esac
}

main "$@"

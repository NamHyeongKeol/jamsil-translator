#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_CANON="$(cd "$ROOT_DIR" && pwd -P)"
DEVBOX_ENV_FILE="$ROOT_DIR/.devbox.env"
APP_ENV_FILE="$ROOT_DIR/mingle-app/.env.local"
STT_ENV_FILE="$ROOT_DIR/mingle-stt/.env.local"
NGROK_LOCAL_CONFIG="$ROOT_DIR/ngrok.mobile.local.yml"
MANAGED_START="# >>> devbox managed (auto)"
MANAGED_END="# <<< devbox managed (auto)"

APP_MANAGED_KEYS=(
  DEVBOX_WORKTREE_NAME
  DEVBOX_PROFILE
  DEVBOX_WEB_PORT
  DEVBOX_STT_PORT
  DEVBOX_METRO_PORT
  NEXT_PUBLIC_SITE_URL
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
  scripts/devbox init [--web-port N] [--stt-port N] [--metro-port N] [--host HOST]
  scripts/devbox bootstrap
  scripts/devbox profile --profile local|device [--host HOST]
  scripts/devbox ngrok-config
  scripts/devbox up [--profile local|device] [--host HOST] [--with-metro]
  scripts/devbox test [vitest args...]
  scripts/devbox status

Commands:
  init         Generate worktree-specific ports/config/env files.
  bootstrap    Seed env files from main worktree and install dependencies.
  profile      Apply local/device profile to managed env files.
  ngrok-config Regenerate ngrok.mobile.local.yml from current ports.
  up           Start STT + Next app together (device profile includes ngrok).
  test         Run mingle-app live integration tests with devbox endpoints.
  status       Print current endpoints for PC/iOS/Android web and app targets.
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

    for key in DEVBOX_WEB_PORT DEVBOX_STT_PORT DEVBOX_METRO_PORT; do
      port="$(read_env_value_from_file "$key" "$env_file")"
      if is_numeric "$port"; then
        RESERVED_ALL_PORTS="$(append_port "$RESERVED_ALL_PORTS" "$port")"
      fi
    done
  done < <(git -C "$ROOT_DIR" worktree list --porcelain | awk '/^worktree /{print substr($0,10)}')
}

calc_default_ports() {
  collect_reserved_ports

  local range seed_text seed slot web stt metro
  range=800
  seed_text="$ROOT_CANON|$DEVBOX_WORKTREE_NAME"
  seed="$(printf '%s' "$seed_text" | cksum | awk '{print $1}')"

  for ((attempt = 0; attempt < range; attempt++)); do
    slot=$(((seed + attempt) % range))
    web=$((3200 + slot))
    stt=$((5200 + slot))
    metro=$((8200 + slot))

    if port_list_contains "$RESERVED_ALL_PORTS" "$web"; then
      continue
    fi
    if port_list_contains "$RESERVED_ALL_PORTS" "$stt"; then
      continue
    fi
    if port_list_contains "$RESERVED_ALL_PORTS" "$metro"; then
      continue
    fi

    if port_in_use "$web" || port_in_use "$stt" || port_in_use "$metro"; then
      continue
    fi

    DEFAULT_WEB_PORT="$web"
    DEFAULT_STT_PORT="$stt"
    DEFAULT_METRO_PORT="$metro"
    return
  done

  die "failed to allocate default ports (range exhausted: web 3200-3999, stt 5200-5999, metro 8200-8999)"
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
      DEVBOX_WORKTREE_NAME|DEVBOX_ROOT_DIR|DEVBOX_WEB_PORT|DEVBOX_STT_PORT|DEVBOX_METRO_PORT|DEVBOX_PROFILE|DEVBOX_LOCAL_HOST|DEVBOX_SITE_URL|DEVBOX_RN_WS_URL|DEVBOX_PUBLIC_WS_URL|DEVBOX_TEST_API_BASE_URL|DEVBOX_TEST_WS_URL)
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
  : "${DEVBOX_PROFILE:?missing DEVBOX_PROFILE}"
  : "${DEVBOX_SITE_URL:?missing DEVBOX_SITE_URL}"
  : "${DEVBOX_RN_WS_URL:?missing DEVBOX_RN_WS_URL}"
  : "${DEVBOX_TEST_API_BASE_URL:?missing DEVBOX_TEST_API_BASE_URL}"
  : "${DEVBOX_TEST_WS_URL:?missing DEVBOX_TEST_WS_URL}"

  validate_port "DEVBOX_WEB_PORT" "$DEVBOX_WEB_PORT"
  validate_port "DEVBOX_STT_PORT" "$DEVBOX_STT_PORT"
  validate_port "DEVBOX_METRO_PORT" "$DEVBOX_METRO_PORT"
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
tunnels:
  web:
    addr: $DEVBOX_WEB_PORT
    proto: http
  stt:
    addr: $DEVBOX_STT_PORT
    proto: http
EOF
}

refresh_runtime_files() {
  write_app_env_block
  write_stt_env_block
  write_ngrok_local_config
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

try_read_ngrok_urls() {
  local expected_web_port="${1:-}"
  local expected_stt_port="${2:-}"
  local require_https="${3:-0}"

  local raw parsed
  NGROK_LAST_ERROR=""
  NGROK_LAST_ERROR_KIND=""

  raw="$(curl -fsS http://127.0.0.1:4040/api/tunnels 2>/dev/null)" || {
    NGROK_LAST_ERROR_KIND="inspector_unreachable"
    NGROK_LAST_ERROR="cannot reach ngrok inspector at http://127.0.0.1:4040"
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

  require_cmd curl
  require_cmd node
  try_read_ngrok_urls "$expected_web_port" "$expected_stt_port" "$require_https" || {
    if [[ -n "$NGROK_LAST_ERROR" ]]; then
      die "$NGROK_LAST_ERROR"
    fi
    die "cannot read ngrok web/stt tunnels from inspector (http://127.0.0.1:4040)"
  }
}

wait_for_ngrok_tunnels() {
  local expected_web_port="$1"
  local expected_stt_port="$2"
  local require_https="$3"
  local timeout_sec="${4:-20}"
  local elapsed=0
  while ((elapsed < timeout_sec)); do
    if try_read_ngrok_urls "$expected_web_port" "$expected_stt_port" "$require_https"; then
      return 0
    fi
    sleep 1
    ((elapsed += 1))
  done
  return 1
}

set_device_profile_values() {
  read_ngrok_urls "$DEVBOX_WEB_PORT" "$DEVBOX_STT_PORT" "1"

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
  local web_port="" stt_port="" metro_port="" host="127.0.0.1"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --web-port) web_port="${2:-}"; shift 2 ;;
      --stt-port) stt_port="${2:-}"; shift 2 ;;
      --metro-port) metro_port="${2:-}"; shift 2 ;;
      --host) host="${2:-}"; shift 2 ;;
      *) die "unknown option for init: $1" ;;
    esac
  done

  DEVBOX_WORKTREE_NAME="$(derive_worktree_name)"
  calc_default_ports

  [[ -n "$web_port" ]] || web_port="$DEFAULT_WEB_PORT"
  [[ -n "$stt_port" ]] || stt_port="$DEFAULT_STT_PORT"
  [[ -n "$metro_port" ]] || metro_port="$DEFAULT_METRO_PORT"

  validate_port "web port" "$web_port"
  validate_port "stt port" "$stt_port"
  validate_port "metro port" "$metro_port"

  [[ "$web_port" != "$stt_port" ]] || die "web/stt ports must differ"
  [[ "$web_port" != "$metro_port" ]] || die "web/metro ports must differ"
  [[ "$stt_port" != "$metro_port" ]] || die "stt/metro ports must differ"

  port_conflict_check "web" "$web_port"
  port_conflict_check "stt" "$stt_port"
  port_conflict_check "metro" "$metro_port"

  DEVBOX_WEB_PORT="$web_port"
  DEVBOX_STT_PORT="$stt_port"
  DEVBOX_METRO_PORT="$metro_port"
  set_local_profile_values "$host"

  seed_env_from_main_worktree
  save_and_refresh

  log "initialized for worktree: $DEVBOX_WORKTREE_NAME"
  cmd_status
}

cmd_bootstrap() {
  require_cmd pnpm
  seed_env_from_main_worktree
  ensure_workspace_dependencies
  if [[ -f "$DEVBOX_ENV_FILE" ]]; then
    require_devbox_env
    refresh_runtime_files
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

cmd_up() {
  require_devbox_env
  require_cmd pnpm
  seed_env_from_main_worktree
  ensure_workspace_dependencies

  local profile="local"
  local host=""
  local with_metro=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --profile) profile="${2:-}"; shift 2 ;;
      --host) host="${2:-}"; shift 2 ;;
      --with-metro) with_metro=1; shift ;;
      *) die "unknown option for up: $1" ;;
    esac
  done

  local -a pids=()
  local exit_code=0
  local started_ngrok=0

  if [[ "$profile" == "device" ]]; then
    write_ngrok_local_config

    if ! try_read_ngrok_urls "$DEVBOX_WEB_PORT" "$DEVBOX_STT_PORT" "1"; then
      if [[ "$NGROK_LAST_ERROR_KIND" == "tunnel_mismatch" ]]; then
        die "running ngrok tunnels do not match this worktree ports(web=$DEVBOX_WEB_PORT stt=$DEVBOX_STT_PORT) or are not https/wss.
$NGROK_LAST_ERROR"
      fi
      require_cmd ngrok
      log "starting ngrok for device profile"
      (
        cd "$ROOT_DIR"
        scripts/ngrok-start-mobile.sh
      ) &
      pids+=("$!")
      started_ngrok=1

      if ! wait_for_ngrok_tunnels "$DEVBOX_WEB_PORT" "$DEVBOX_STT_PORT" "1" 20; then
        cleanup_processes "${pids[@]}"
        if [[ -n "$NGROK_LAST_ERROR" ]]; then
          die "$NGROK_LAST_ERROR"
        fi
        die "ngrok inspector did not expose matching web/stt tunnels within 20s"
      fi
    fi
  fi

  apply_profile "$profile" "$host"
  cmd_status

  log "starting mingle-stt(port=$DEVBOX_STT_PORT) + mingle-app(port=$DEVBOX_WEB_PORT)"
  (
    cd "$ROOT_DIR/mingle-stt"
    PORT="$DEVBOX_STT_PORT" pnpm dev
  ) &
  pids+=("$!")

  (
    cd "$ROOT_DIR/mingle-app"
    pnpm dev -- --port "$DEVBOX_WEB_PORT"
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

  if [[ "$started_ngrok" -eq 1 ]]; then
    log "ngrok is running with this process group (Ctrl+C to stop all)"
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

PC Web      : $DEVBOX_SITE_URL
iOS Web     : $DEVBOX_SITE_URL
Android Web : $DEVBOX_SITE_URL
iOS App     : RN_WEB_APP_BASE_URL=$DEVBOX_SITE_URL | RN_DEFAULT_WS_URL=$DEVBOX_RN_WS_URL
Android App : RN_WEB_APP_BASE_URL=$DEVBOX_SITE_URL | RN_DEFAULT_WS_URL=$DEVBOX_RN_WS_URL
Live Test   : MINGLE_TEST_API_BASE_URL=$DEVBOX_TEST_API_BASE_URL | MINGLE_TEST_WS_URL=$DEVBOX_TEST_WS_URL

Files:
- $DEVBOX_ENV_FILE
- $APP_ENV_FILE
- $STT_ENV_FILE
- $NGROK_LOCAL_CONFIG

Run:
- scripts/devbox up --profile local
- scripts/devbox up --profile device
- scripts/devbox up --profile local --with-metro
- scripts/devbox profile --profile local --host <LAN_IP>
- scripts/devbox test
EOF
}

main() {
  local cmd="${1:-help}"
  shift || true

  case "$cmd" in
    init) cmd_init "$@" ;;
    bootstrap) cmd_bootstrap "$@" ;;
    profile) cmd_profile "$@" ;;
    profile-local) cmd_profile --profile local "$@" ;;
    profile-device|profile-ngrok) cmd_profile --profile device "$@" ;;
    ngrok-config) cmd_ngrok_config "$@" ;;
    up) cmd_up "$@" ;;
    test|test-live) cmd_test "$@" ;;
    status) cmd_status "$@" ;;
    help|-h|--help) usage ;;
    *) die "unknown command: $cmd (run: scripts/devbox help)" ;;
  esac
}

main "$@"

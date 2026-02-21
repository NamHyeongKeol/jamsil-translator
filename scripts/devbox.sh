#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVBOX_ENV_FILE="$ROOT_DIR/.devbox.env"
APP_ENV_FILE="$ROOT_DIR/mingle-app/.env.local"
STT_ENV_FILE="$ROOT_DIR/mingle-stt/.env.local"
NGROK_LOCAL_CONFIG="$ROOT_DIR/ngrok.mobile.local.yml"
MANAGED_START="# >>> devbox managed (auto)"
MANAGED_END="# <<< devbox managed (auto)"

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
  scripts/devbox.sh init [--web-port N] [--stt-port N] [--metro-port N] [--host HOST]
  scripts/devbox.sh profile-local [--host HOST]
  scripts/devbox.sh profile-ngrok
  scripts/devbox.sh ngrok-config
  scripts/devbox.sh up [--with-metro]
  scripts/devbox.sh test-live [vitest args...]
  scripts/devbox.sh status

Commands:
  init           Generate worktree-specific ports/config/env files.
  profile-local  Apply local/LAN profile to mingle-app/.env.local.
  profile-ngrok  Read ngrok inspector (127.0.0.1:4040) and apply tunnel profile.
  ngrok-config   Regenerate ngrok.mobile.local.yml from current ports.
  up             Start STT + Next app together (optional Metro).
  test-live      Run mingle-app live integration tests with devbox endpoints.
  status         Print current endpoints for PC Web / iOS Web / iOS App / Android App / Android Web.
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

calc_default_ports() {
  local hash slot
  hash="$(printf '%s' "$ROOT_DIR" | cksum | awk '{print $1}')"
  slot=$((hash % 200))

  DEFAULT_WEB_PORT=$((3200 + slot))
  DEFAULT_STT_PORT=$((5200 + slot))
  DEFAULT_METRO_PORT=$((8200 + slot))
}

ensure_file_parent() {
  local file="$1"
  mkdir -p "$(dirname "$file")"
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

write_devbox_env() {
  cat > "$DEVBOX_ENV_FILE" <<EOF
DEVBOX_WORKTREE_NAME=$DEVBOX_WORKTREE_NAME
DEVBOX_ROOT_DIR=$ROOT_DIR
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

require_devbox_env() {
  [[ -f "$DEVBOX_ENV_FILE" ]] || die "missing $DEVBOX_ENV_FILE (run: scripts/devbox.sh init)"

  # shellcheck disable=SC1090
  source "$DEVBOX_ENV_FILE"

  : "${DEVBOX_WEB_PORT:?missing DEVBOX_WEB_PORT}"
  : "${DEVBOX_STT_PORT:?missing DEVBOX_STT_PORT}"
  : "${DEVBOX_METRO_PORT:?missing DEVBOX_METRO_PORT}"
  : "${DEVBOX_PROFILE:?missing DEVBOX_PROFILE}"
  : "${DEVBOX_SITE_URL:?missing DEVBOX_SITE_URL}"
  : "${DEVBOX_RN_WS_URL:?missing DEVBOX_RN_WS_URL}"
}

write_app_env_block() {
  local block
  block="$(cat <<EOF
DEVBOX_WORKTREE_NAME=$DEVBOX_WORKTREE_NAME
DEVBOX_PROFILE=$DEVBOX_PROFILE
DEVBOX_WEB_PORT=$DEVBOX_WEB_PORT
DEVBOX_STT_PORT=$DEVBOX_STT_PORT
DEVBOX_METRO_PORT=$DEVBOX_METRO_PORT
NEXT_PUBLIC_SITE_URL=$DEVBOX_SITE_URL
RN_WEB_APP_BASE_URL=$DEVBOX_SITE_URL
NEXT_PUBLIC_WS_PORT=$DEVBOX_STT_PORT
RN_DEFAULT_WS_URL=$DEVBOX_RN_WS_URL
MINGLE_TEST_API_BASE_URL=$DEVBOX_TEST_API_BASE_URL
MINGLE_TEST_WS_URL=$DEVBOX_TEST_WS_URL
EOF
)"

  if [[ -n "${DEVBOX_PUBLIC_WS_URL:-}" ]]; then
    block="${block}"$'\n'"NEXT_PUBLIC_WS_URL=$DEVBOX_PUBLIC_WS_URL"
  else
    block="${block}"$'\n'"# NEXT_PUBLIC_WS_URL is intentionally unset in local/lan profile."
  fi

  upsert_managed_block "$APP_ENV_FILE" "$block"
}

write_stt_env_block() {
  local block
  block="$(cat <<EOF
DEVBOX_WORKTREE_NAME=$DEVBOX_WORKTREE_NAME
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

read_ngrok_urls() {
  require_cmd curl
  require_cmd node

  local raw parsed
  raw="$(curl -fsS http://127.0.0.1:4040/api/tunnels)" || {
    die "cannot reach ngrok inspector at http://127.0.0.1:4040 (run ngrok first)"
  }

  parsed="$(
    printf '%s' "$raw" | node -e '
      const fs = require("fs");
      const payload = fs.readFileSync(0, "utf8");
      const data = JSON.parse(payload);
      const tunnels = Array.isArray(data.tunnels) ? data.tunnels : [];
      const pick = (name) => {
        const found = tunnels.find((t) => t && t.name === name && typeof t.public_url === "string");
        return found ? found.public_url : "";
      };
      console.log(pick("web"));
      console.log(pick("stt"));
    '
  )"

  NGROK_WEB_URL="$(printf '%s\n' "$parsed" | sed -n '1p')"
  NGROK_STT_URL="$(printf '%s\n' "$parsed" | sed -n '2p')"

  [[ -n "$NGROK_WEB_URL" ]] || die "ngrok tunnel 'web' not found"
  [[ -n "$NGROK_STT_URL" ]] || die "ngrok tunnel 'stt' not found"
}

cmd_init() {
  calc_default_ports

  local web_port="$DEFAULT_WEB_PORT"
  local stt_port="$DEFAULT_STT_PORT"
  local metro_port="$DEFAULT_METRO_PORT"
  local host="127.0.0.1"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --web-port) web_port="${2:-}"; shift 2 ;;
      --stt-port) stt_port="${2:-}"; shift 2 ;;
      --metro-port) metro_port="${2:-}"; shift 2 ;;
      --host) host="${2:-}"; shift 2 ;;
      *)
        die "unknown option for init: $1"
        ;;
    esac
  done

  [[ "$web_port" =~ ^[0-9]+$ ]] || die "web port must be numeric"
  [[ "$stt_port" =~ ^[0-9]+$ ]] || die "stt port must be numeric"
  [[ "$metro_port" =~ ^[0-9]+$ ]] || die "metro port must be numeric"

  DEVBOX_WORKTREE_NAME="$(basename "$ROOT_DIR")"
  DEVBOX_WEB_PORT="$web_port"
  DEVBOX_STT_PORT="$stt_port"
  DEVBOX_METRO_PORT="$metro_port"
  set_local_profile_values "$host"

  write_devbox_env
  refresh_runtime_files

  log "initialized for worktree: $DEVBOX_WORKTREE_NAME"
  cmd_status
}

cmd_profile_local() {
  require_devbox_env

  local host="${DEVBOX_LOCAL_HOST:-127.0.0.1}"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --host) host="${2:-}"; shift 2 ;;
      *)
        die "unknown option for profile-local: $1"
        ;;
    esac
  done

  set_local_profile_values "$host"
  write_devbox_env
  refresh_runtime_files
  log "applied local profile (host=$host)"
  cmd_status
}

cmd_profile_ngrok() {
  require_devbox_env
  read_ngrok_urls

  DEVBOX_PROFILE="ngrok"
  DEVBOX_SITE_URL="$NGROK_WEB_URL"
  DEVBOX_RN_WS_URL="$(to_wss_url "$NGROK_STT_URL")"
  DEVBOX_PUBLIC_WS_URL="$DEVBOX_RN_WS_URL"
  DEVBOX_TEST_API_BASE_URL="http://127.0.0.1:$DEVBOX_WEB_PORT"
  DEVBOX_TEST_WS_URL="ws://127.0.0.1:$DEVBOX_STT_PORT"

  write_devbox_env
  refresh_runtime_files

  log "applied ngrok profile from live tunnels"
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

  local with_metro=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --with-metro) with_metro=1; shift ;;
      *)
        die "unknown option for up: $1"
        ;;
    esac
  done

  local pids=()
  local idx

  log "starting STT(port=$DEVBOX_STT_PORT) + Next(port=$DEVBOX_WEB_PORT)"
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
    log "starting Metro(port=$DEVBOX_METRO_PORT)"
    (
      cd "$ROOT_DIR/mingle-app"
      node scripts/run-with-env-local.mjs pnpm --dir rn start --port "$DEVBOX_METRO_PORT"
    ) &
    pids+=("$!")
  fi

  cleanup() {
    local pid
    for pid in "${pids[@]:-}"; do
      if kill -0 "$pid" >/dev/null 2>&1; then
        kill "$pid" >/dev/null 2>&1 || true
      fi
    done
  }

  trap cleanup INT TERM EXIT

  for idx in "${!pids[@]}"; do
    wait "${pids[$idx]}"
  done
}

cmd_test_live() {
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
- scripts/devbox.sh up
- scripts/devbox.sh up --with-metro
- scripts/devbox.sh test-live
- scripts/devbox.sh profile-local --host <LAN_IP>
- scripts/devbox.sh profile-ngrok
EOF
}

main() {
  local cmd="${1:-help}"
  shift || true

  case "$cmd" in
    init) cmd_init "$@" ;;
    profile-local) cmd_profile_local "$@" ;;
    profile-ngrok) cmd_profile_ngrok "$@" ;;
    ngrok-config) cmd_ngrok_config "$@" ;;
    up) cmd_up "$@" ;;
    test-live) cmd_test_live "$@" ;;
    status) cmd_status "$@" ;;
    help|-h|--help) usage ;;
    *)
      die "unknown command: $cmd (run: scripts/devbox.sh help)"
      ;;
  esac
}

main "$@"

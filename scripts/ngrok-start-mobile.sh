#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GLOBAL_CONFIG="$HOME/Library/Application Support/ngrok/ngrok.yml"
LOCAL_OVERRIDE_CONFIG="$ROOT_DIR/ngrok.mobile.local.yml"
LOCAL_DEFAULT_CONFIG="$ROOT_DIR/ngrok.mobile.yml"
LOCAL_CONFIG="$LOCAL_DEFAULT_CONFIG"

if [[ -f "$LOCAL_OVERRIDE_CONFIG" ]]; then
  LOCAL_CONFIG="$LOCAL_OVERRIDE_CONFIG"
fi

if [[ ! -f "$GLOBAL_CONFIG" ]]; then
  echo "ngrok global config not found: $GLOBAL_CONFIG" >&2
  exit 1
fi

if [[ ! -f "$LOCAL_CONFIG" ]]; then
  echo "ngrok local config not found: $LOCAL_CONFIG" >&2
  exit 1
fi

# Starts devbox-specific tunnels using selected local config.
ngrok start --config "$GLOBAL_CONFIG" --config "$LOCAL_CONFIG" devbox_web devbox_stt "$@"

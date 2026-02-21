#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GLOBAL_CONFIG="$HOME/Library/Application Support/ngrok/ngrok.yml"
LOCAL_CONFIG="$ROOT_DIR/ngrok.mobile.yml"

if [[ ! -f "$GLOBAL_CONFIG" ]]; then
  echo "ngrok global config not found: $GLOBAL_CONFIG" >&2
  exit 1
fi

if [[ ! -f "$LOCAL_CONFIG" ]]; then
  echo "ngrok local config not found: $LOCAL_CONFIG" >&2
  exit 1
fi

# Starts both web(3000) and stt(3001) named tunnels.
ngrok start --config "$GLOBAL_CONFIG" --config "$LOCAL_CONFIG" web stt "$@"

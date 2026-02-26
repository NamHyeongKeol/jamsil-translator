#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_DIR}"

echo "== devicectl devices =="
xcrun devicectl list devices || true
echo

echo "== xcodebuild destinations =="
xcodegen generate --spec project.yml > /dev/null
xcodebuild -project MingleIOS.xcodeproj -scheme MingleIOS -showdestinations || true

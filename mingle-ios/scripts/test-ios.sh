#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

SCHEME="${SCHEME:-MingleIOS}"
CONFIGURATION="${CONFIGURATION:-Debug}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-${PROJECT_DIR}/.derived-data-test}"
MINGLE_API_BASE_URL="${MINGLE_API_BASE_URL:-}"
MINGLE_WS_URL="${MINGLE_WS_URL:-}"

cd "${PROJECT_DIR}"
xcodegen generate --spec project.yml > /dev/null

XCB_ARGS=(
  -project MingleIOS.xcodeproj
  -scheme "${SCHEME}"
  -configuration "${CONFIGURATION}"
  -derivedDataPath "${DERIVED_DATA_PATH}"
  -destination "generic/platform=iOS"
  "CODE_SIGNING_ALLOWED=NO"
  "CODE_SIGNING_REQUIRED=NO"
  "CODE_SIGN_IDENTITY="
)

if [[ -n "${MINGLE_API_BASE_URL}" ]]; then
  XCB_ARGS+=("MINGLE_API_BASE_URL=${MINGLE_API_BASE_URL}")
fi
if [[ -n "${MINGLE_WS_URL}" ]]; then
  XCB_ARGS+=("MINGLE_WS_URL=${MINGLE_WS_URL}")
fi

xcodebuild "${XCB_ARGS[@]}" build-for-testing

echo "Native iOS test build succeeded: scheme=${SCHEME} configuration=${CONFIGURATION}"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

SCHEME="${SCHEME:-MingleIOS}"
CONFIGURATION="${CONFIGURATION:-Debug}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-${PROJECT_DIR}/.derived-data}"
DEVICE_ID="${1:-${DEVICE_ID:-}}"

cd "${PROJECT_DIR}"

xcodegen generate --spec project.yml > /dev/null

XCB_ARGS=(
  -project MingleIOS.xcodeproj
  -scheme "${SCHEME}"
  -configuration "${CONFIGURATION}"
  -derivedDataPath "${DERIVED_DATA_PATH}"
)

if [[ -n "${DEVICE_ID}" ]]; then
  XCB_ARGS+=(
    -destination "id=${DEVICE_ID}"
    -allowProvisioningUpdates
  )
  if [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
    XCB_ARGS+=("DEVELOPMENT_TEAM=${DEVELOPMENT_TEAM}")
  fi
else
  # Sandbox 환경에서도 컴파일 검증이 가능하도록 시뮬레이터 대신 iOS generic build 사용.
  XCB_ARGS+=(
    -destination "generic/platform=iOS"
    "CODE_SIGNING_ALLOWED=NO"
    "CODE_SIGNING_REQUIRED=NO"
    "CODE_SIGN_IDENTITY="
  )
fi

xcodebuild "${XCB_ARGS[@]}" build

echo "Build succeeded: scheme=${SCHEME} configuration=${CONFIGURATION}"

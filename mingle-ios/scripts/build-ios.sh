#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

SCHEME="${SCHEME:-MingleIOS}"
CONFIGURATION="${CONFIGURATION:-Debug}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-${PROJECT_DIR}/.derived-data}"
DEVICE_ID="${1:-${DEVICE_ID:-}}"
MINGLE_API_BASE_URL="${MINGLE_API_BASE_URL:-}"
MINGLE_WS_URL="${MINGLE_WS_URL:-}"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-com.nam.mingleios}"

maybe_generate_xcodeproj() {
  local project_file="${PROJECT_DIR}/MingleIOS.xcodeproj/project.pbxproj"
  local spec_file="${PROJECT_DIR}/project.yml"
  if [[ "${MINGLE_IOS_FORCE_XCODEGEN:-0}" == "1" || ! -f "${project_file}" || "${spec_file}" -nt "${project_file}" ]]; then
    (
      cd "${PROJECT_DIR}"
      xcodegen generate --spec project.yml > /dev/null
    )
  fi
}

cd "${PROJECT_DIR}"
maybe_generate_xcodeproj

XCB_ARGS=(
  -project MingleIOS.xcodeproj
  -scheme "${SCHEME}"
  -configuration "${CONFIGURATION}"
  -derivedDataPath "${DERIVED_DATA_PATH}"
)

if [[ -n "${MINGLE_API_BASE_URL}" ]]; then
  XCB_ARGS+=("MINGLE_API_BASE_URL=${MINGLE_API_BASE_URL}")
fi
if [[ -n "${MINGLE_WS_URL}" ]]; then
  XCB_ARGS+=("MINGLE_WS_URL=${MINGLE_WS_URL}")
fi
if [[ -n "${APP_BUNDLE_ID}" ]]; then
  XCB_ARGS+=("PRODUCT_BUNDLE_IDENTIFIER=${APP_BUNDLE_ID}")
fi

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

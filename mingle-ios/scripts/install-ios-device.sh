#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-${PROJECT_DIR}/.derived-data-device}"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-com.nam.mingleios}"
APP_PATH="${DERIVED_DATA_PATH}/Build/Products/Debug-iphoneos/MingleIOS.app"

DEVICE_ID="${1:-${DEVICE_ID:-}}"
if [[ -z "${DEVICE_ID}" ]]; then
  for _ in 1 2 3; do
    DEVICE_ID="$(
      xcrun devicectl list devices 2>/dev/null \
      | sed -nE 's/.* ([0-9A-F-]{36}) +(connected|available \\(paired\\)).*/\1/p' \
      | head -n 1
    )"
    if [[ -n "${DEVICE_ID}" ]]; then
      break
    fi
    sleep 2
  done
fi

if [[ -z "${DEVICE_ID}" ]]; then
  echo "No connected iPhone found. Connect/unlock iPhone and retry."
  echo "You can pass a CoreDevice ID manually:"
  echo "  ./scripts/install-ios-device.sh <COREDEVICE_ID>"
  exit 1
fi

TEAM_ID="${DEVELOPMENT_TEAM:-}"
if [[ -z "${TEAM_ID}" ]]; then
  TEAM_ID="$(security find-identity -v -p codesigning | sed -nE 's/.*\(([A-Z0-9]{10})\)"$/\1/p' | head -n 1)"
fi

if [[ -z "${TEAM_ID}" ]]; then
  echo "No Apple Development signing identity found."
  exit 1
fi

cd "${PROJECT_DIR}"
xcodegen generate --spec project.yml > /dev/null

BUILD_LOG="$(mktemp)"
set +e
xcodebuild \
  -project MingleIOS.xcodeproj \
  -scheme MingleIOS \
  -configuration Debug \
  -derivedDataPath "${DERIVED_DATA_PATH}" \
  -destination "generic/platform=iOS" \
  -allowProvisioningUpdates \
  "DEVELOPMENT_TEAM=${TEAM_ID}" \
  build | tee "${BUILD_LOG}"
BUILD_EXIT=$?
set -e

if [[ ${BUILD_EXIT} -ne 0 ]]; then
  if rg -q "No Accounts|No profiles" "${BUILD_LOG}"; then
    echo
    echo "Signing prerequisites are missing."
    echo "1) Open Xcode > Settings > Accounts and sign in with Apple ID"
    echo "2) Connect/unlock iPhone and trust this Mac"
    echo "3) Re-run: DEVELOPMENT_TEAM=${TEAM_ID} ./scripts/install-ios-device.sh ${DEVICE_ID}"
  fi
  exit ${BUILD_EXIT}
fi

if [[ ! -d "${APP_PATH}" ]]; then
  echo "App not found at ${APP_PATH}"
  exit 1
fi

xcrun devicectl device install app --device "${DEVICE_ID}" "${APP_PATH}"
xcrun devicectl device process launch --device "${DEVICE_ID}" "${APP_BUNDLE_ID}"

echo "Installed and launched on device ${DEVICE_ID}"

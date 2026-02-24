#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-${PROJECT_DIR}/.derived-data-device}"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-com.nam.mingleios}"
CONFIGURATION="${CONFIGURATION:-Debug}"
APP_PATH="${DERIVED_DATA_PATH}/Build/Products/${CONFIGURATION}-iphoneos/MingleIOS.app"
MINGLE_API_BASE_URL="${MINGLE_API_BASE_URL:-}"
MINGLE_WS_URL="${MINGLE_WS_URL:-}"
AUTO_SELECT_DEVICE="${AUTO_SELECT_DEVICE:-0}"

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

DEVICE_ID="${1:-${DEVICE_ID:-}}"
detect_devices() {
  xcrun devicectl list devices 2>/dev/null \
    | sed -nE 's/.* ([0-9A-F-]{36}) +(connected|available \(paired\)).*/\1|\0/p'
}

print_device_candidates() {
  local max="${1:-0}"
  if [[ "${max}" -gt 0 ]]; then
    detect_devices | sed 's/.*|/ - /' | sed -n "1,${max}p"
  else
    detect_devices | sed 's/.*|/ - /'
  fi
}

select_device() {
  local requested_id="$1"
  local -a devices=()
  local row id _
  while IFS='|' read -r id _; do
    [[ -n "${id}" ]] && devices+=("${id}")
  done < <(detect_devices)

  if [[ -n "${requested_id}" ]]; then
    local known
    for known in "${devices[@]}"; do
      if [[ "${known}" == "${requested_id}" ]]; then
        echo "${requested_id}"
        return 0
      fi
    done
    echo "Device not found or not connected: ${requested_id}" >&2
    return 1
  fi

  if [[ "${#devices[@]}" -eq 0 ]]; then
    return 1
  fi

  if [[ "${#devices[@]}" -eq 1 ]]; then
    echo "${devices[0]}"
    return 0
  fi

  if [[ "${AUTO_SELECT_DEVICE}" == "1" ]]; then
    local first="${devices[0]}"
    if [[ -n "${first}" ]]; then
      echo "${first}"
      return 0
    fi
  fi

  return 1
}

if [[ -z "${DEVICE_ID}" ]]; then
  if ! DEVICE_ID="$(select_device "")"; then
    for _ in 1 2 3; do
      DEVICE_ID="$(select_device "" || true)"
      if [[ -n "${DEVICE_ID}" ]]; then
        break
      fi
      sleep 2
    done
  fi
fi

if [[ -z "${DEVICE_ID}" ]]; then
  echo "No connected iPhone found. Connect/unlock iPhone and retry."
  echo "Available connected devices:"
  print_device_candidates 20
  echo "You can pass a CoreDevice ID manually:"
  echo "  ./scripts/install-ios-device.sh <COREDEVICE_ID>"
  echo "Or choose auto selection with AUTO_SELECT_DEVICE=1 if exactly one device exists."
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
maybe_generate_xcodeproj

BUILD_LOG="$(mktemp)"
XCB_ARGS=(
  -project MingleIOS.xcodeproj
  -scheme MingleIOS
  -configuration "${CONFIGURATION}"
  -derivedDataPath "${DERIVED_DATA_PATH}"
  -destination "generic/platform=iOS"
  -allowProvisioningUpdates
  "DEVELOPMENT_TEAM=${TEAM_ID}"
  "PRODUCT_BUNDLE_IDENTIFIER=${APP_BUNDLE_ID}"
)
if [[ -n "${MINGLE_API_BASE_URL}" ]]; then
  XCB_ARGS+=("MINGLE_API_BASE_URL=${MINGLE_API_BASE_URL}")
fi
if [[ -n "${MINGLE_WS_URL}" ]]; then
  XCB_ARGS+=("MINGLE_WS_URL=${MINGLE_WS_URL}")
fi

set +e
xcodebuild "${XCB_ARGS[@]}" build | tee "${BUILD_LOG}"
BUILD_EXIT=$?
set -e

if [[ ${BUILD_EXIT} -ne 0 ]]; then
  signing_error_detected=0
  if command -v rg >/dev/null 2>&1; then
    if rg -q "No Accounts|No profiles" "${BUILD_LOG}"; then
      signing_error_detected=1
    fi
  elif grep -Eq "No Accounts|No profiles" "${BUILD_LOG}"; then
    signing_error_detected=1
  fi

  if [[ "${signing_error_detected}" -eq 1 ]]; then
    echo
    echo "Signing prerequisites are missing."
    echo "1) Open Xcode > Settings > Accounts and sign in with Apple ID"
    echo "2) Connect/unlock iPhone and trust this Mac"
    echo "3) Re-run: APP_BUNDLE_ID=${APP_BUNDLE_ID} DEVELOPMENT_TEAM=${TEAM_ID} ./scripts/install-ios-device.sh ${DEVICE_ID}"
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

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-${PROJECT_DIR}/.derived-data-simulator}"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-com.nam.mingleios}"
SCHEME="${SCHEME:-MingleIOS}"
CONFIGURATION="${CONFIGURATION:-Debug}"
SIMULATOR_NAME="${SIMULATOR_NAME:-iPhone 16}"
MINGLE_API_BASE_URL="${MINGLE_API_BASE_URL:-}"
MINGLE_WS_URL="${MINGLE_WS_URL:-}"

SIMULATOR_UDID="${1:-${SIMULATOR_UDID:-}}"
APP_PATH="${DERIVED_DATA_PATH}/Build/Products/${CONFIGURATION}-iphonesimulator/MingleIOS.app"
SIMCTL_DEVICES_LIST=""

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "required command not found: $1"
    exit 1
  }
}

find_simulator_udid_by_name() {
  local name="$1"
  printf '%s\n' "${SIMCTL_DEVICES_LIST}" | awk -v name="$name" '
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      if (index(line, name " (") != 1) next
      if (line !~ /\(Booted\)|\(Shutdown\)/) next
      if (match(line, /\([0-9A-F-]+\)/)) {
        udid = substr(line, RSTART + 1, RLENGTH - 2)
        print udid
        exit
      }
    }
  '
}

find_first_iphone_simulator_udid() {
  printf '%s\n' "${SIMCTL_DEVICES_LIST}" | awk '
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      if (index(line, "iPhone ") != 1) next
      if (line !~ /\(Booted\)|\(Shutdown\)/) next
      if (match(line, /\([0-9A-F-]+\)/)) {
        udid = substr(line, RSTART + 1, RLENGTH - 2)
        print udid
        exit
      }
    }
  '
}

require_cmd xcodegen
require_cmd xcodebuild
require_cmd xcrun

simctl_output_file="$(mktemp)"
if ! xcrun simctl list devices available >"${simctl_output_file}" 2>&1; then
  echo "CoreSimulator is unavailable. Open Xcode, launch Simulator once, and retry."
  sed -n '1,3p' "${simctl_output_file}"
  rm -f "${simctl_output_file}"
  exit 1
fi
SIMCTL_DEVICES_LIST="$(cat "${simctl_output_file}")"
rm -f "${simctl_output_file}"

if [[ -z "${SIMULATOR_UDID}" ]]; then
  SIMULATOR_UDID="$(find_simulator_udid_by_name "${SIMULATOR_NAME}")"
fi
if [[ -z "${SIMULATOR_UDID}" ]]; then
  SIMULATOR_UDID="$(find_first_iphone_simulator_udid)"
fi

if [[ -z "${SIMULATOR_UDID}" ]]; then
  echo "No available iOS simulator found."
  echo "Check with: xcrun simctl list devices available"
  exit 1
fi

cd "${PROJECT_DIR}"
xcodegen generate --spec project.yml > /dev/null

# Keep simulator running state stable for install/launch.
xcrun simctl boot "${SIMULATOR_UDID}" >/dev/null 2>&1 || true
xcrun simctl bootstatus "${SIMULATOR_UDID}" -b
open -a Simulator >/dev/null 2>&1 || true

XCB_ARGS=(
  -project MingleIOS.xcodeproj
  -scheme "${SCHEME}"
  -configuration "${CONFIGURATION}"
  -derivedDataPath "${DERIVED_DATA_PATH}"
  -destination "id=${SIMULATOR_UDID}"
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

xcodebuild "${XCB_ARGS[@]}" build

if [[ ! -d "${APP_PATH}" ]]; then
  echo "App not found at ${APP_PATH}"
  exit 1
fi

xcrun simctl install "${SIMULATOR_UDID}" "${APP_PATH}"
xcrun simctl launch "${SIMULATOR_UDID}" "${APP_BUNDLE_ID}"

echo "Installed and launched on simulator ${SIMULATOR_UDID}"

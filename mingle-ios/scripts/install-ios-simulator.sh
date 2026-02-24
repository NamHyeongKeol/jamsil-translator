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
AUTO_SELECT_SIMULATOR="${AUTO_SELECT_SIMULATOR:-0}"

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
      if (line !~ /\(Booted\)|\(Shutdown\)|\(Shutdown \(SimDiskImageMounting\)\)/) next
      if (match(line, /\([0-9A-F-]+\)/)) {
        udid = substr(line, RSTART + 1, RLENGTH - 2)
        print udid
        exit
      }
    }
  '
}

print_simulator_candidates() {
  local name_filter="${1:-}"
  printf '%s\n' "${SIMCTL_DEVICES_LIST}" | awk -v name_filter="$name_filter" '
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      if (line !~ /\(Booted\)|\(Shutdown\)|\(Shutdown \(SimDiskImageMounting\)\)/) next
      if (length(name_filter) > 0 && index(line, name_filter " (") != 1) next
      if (line !~ /iPhone / && line !~ /iPad /) next
      if (match(line, /\([0-9A-F-]+\)/)) {
        udid = substr(line, RSTART + 1, RLENGTH - 2)
        print line " :: " udid
      }
    }
  '
}

find_simulator_candidates_count() {
  local name_filter="${1:-}"
  print_simulator_candidates "$name_filter" | wc -l | tr -d ' '
}

pick_first_simulator_legacy() {
  local filter="${1:-}"
  printf '%s\n' "${SIMCTL_DEVICES_LIST}" | awk -v filter="$filter" '
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      if (length(filter) > 0 && index(line, filter " (") != 1) next
      if (line !~ /\(Booted\)|\(Shutdown\)|\(Shutdown \(SimDiskImageMounting\)\)/) next
      if (line !~ /iPhone / && line !~ /iPad /) next
      if (match(line, /\([0-9A-F-]+\)/)) {
        udid = substr(line, RSTART + 1, RLENGTH - 2)
        print udid
        exit
      }
    }
  '
}

choose_simulator_udid() {
  local requested_name="$1"
  local requested_udid="$2"
  local count
  local udid=""

  if [[ -n "${requested_udid}" ]]; then
    local matched
    matched="$(printf '%s\n' "${SIMCTL_DEVICES_LIST}" | awk -v udid="${requested_udid}" '
      {
        line = $0
        sub(/^[[:space:]]+/, "", line)
        if (line !~ /\(Booted\)|\(Shutdown\)|\(Shutdown \(SimDiskImageMounting\)\)/) next
        if (line !~ /iPhone / && line !~ /iPad /) next
        if (match(line, /\([0-9A-F-]+\)/)) {
          candidate = substr(line, RSTART + 1, RLENGTH - 2)
          if (candidate == udid) {
            print candidate
            exit
          }
        }
      }
    ')"
    if [[ -z "${matched}" ]]; then
      echo "SIMULATOR_UDID '${requested_udid}' is not available."
      return 1
    fi
    printf '%s\n' "${requested_udid}"
    return 0
  fi

  if [[ -n "${requested_name}" ]]; then
    count="$(find_simulator_candidates_count "${requested_name}")"
    if [[ "${count}" -gt 1 && "${AUTO_SELECT_SIMULATOR}" != "1" ]]; then
      echo "Multiple simulators match '${requested_name}'. Specify SIMULATOR_UDID explicitly."
      print_simulator_candidates "${requested_name}" | sed -n '1,20p'
      return 1
    fi
    if [[ "${count}" -gt 0 ]]; then
      udid="$(find_simulator_udid_by_name "${requested_name}")"
    fi
  else
    udid="$(pick_first_simulator_legacy "")"
  fi

  if [[ -n "${udid}" ]]; then
    printf '%s\n' "${udid}"
    return 0
  fi

  local name_count
  name_count="$(find_simulator_candidates_count "")"
  if [[ "${name_count}" -gt 1 ]]; then
    echo "Multiple simulators found. Specify SIMULATOR_NAME or SIMULATOR_UDID explicitly."
    echo "Available simulators:"
    print_simulator_candidates "" | sed -n '1,20p'
    return 1
  fi

  if [[ "${AUTO_SELECT_SIMULATOR}" == "1" ]]; then
    udid="$(pick_first_simulator_legacy "${requested_name}")"
    if [[ -n "${udid}" ]]; then
      printf '%s\n' "${udid}"
      return 0
    fi
    echo "No simulator matched. Check available devices:"
    print_simulator_candidates "${requested_name}" | sed -n '1,20p'
    return 1
  fi

  return 1
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
  if ! SIMULATOR_UDID="$(choose_simulator_udid "${SIMULATOR_NAME}" "")"; then
    exit 1
  fi
fi

if [[ -z "${SIMULATOR_UDID}" ]]; then
  echo "No available iOS simulator found."
  echo "Check with: xcrun simctl list devices available"
  exit 1
fi

cd "${PROJECT_DIR}"
maybe_generate_xcodeproj

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
  "PRODUCT_BUNDLE_IDENTIFIER=${APP_BUNDLE_ID}"
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

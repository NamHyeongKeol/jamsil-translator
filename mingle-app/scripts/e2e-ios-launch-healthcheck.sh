#!/usr/bin/env bash
set -euo pipefail

if ! command -v xcrun >/dev/null 2>&1; then
  echo "[ios-e2e] xcrun not found"
  exit 2
fi

UDID="${MINGLE_TEST_IOS_UDID:-}"
BUNDLE_ID="${MINGLE_TEST_IOS_BUNDLE_ID:-com.minglelabs.app}"
INSTALL_APP="${MINGLE_TEST_IOS_INSTALL:-0}"
APP_PATH="${MINGLE_TEST_IOS_APP_PATH:-}"

if [[ -z "${UDID}" ]]; then
  echo "[ios-e2e] MINGLE_TEST_IOS_UDID is required"
  exit 2
fi

if [[ "${INSTALL_APP}" == "1" ]]; then
  if [[ -z "${APP_PATH}" ]]; then
    echo "[ios-e2e] MINGLE_TEST_IOS_APP_PATH is required when MINGLE_TEST_IOS_INSTALL=1"
    exit 2
  fi
  if [[ ! -d "${APP_PATH}" ]]; then
    echo "[ios-e2e] app path not found: ${APP_PATH}"
    exit 2
  fi

  echo "[ios-e2e] installing app via devicectl"
  xcrun devicectl device install app --device "${UDID}" "${APP_PATH}"
fi

echo "[ios-e2e] launching via devicectl"
set +e
xcrun devicectl device process launch --device "${UDID}" "${BUNDLE_ID}"
launch_status=$?
set -e

if [[ ${launch_status} -eq 0 ]]; then
  echo "[ios-e2e] launch success via devicectl"
  exit 0
fi

if ! command -v xctrace >/dev/null 2>&1; then
  echo "[ios-e2e] launch failed via devicectl and xctrace is unavailable"
  exit ${launch_status}
fi

TRACE_OUTPUT="${MINGLE_TEST_IOS_XCTRACE_OUTPUT:-/tmp/mingle-ios-healthcheck-$(date +%s).trace}"

echo "[ios-e2e] launch fallback via xctrace"
set +e
xcrun xctrace record --template 'Blank' --time-limit 3s --device "${UDID}" --launch "${BUNDLE_ID}" --output "${TRACE_OUTPUT}" >/dev/null 2>&1
fallback_status=$?
set -e

if [[ ${fallback_status} -ne 0 ]]; then
  echo "[ios-e2e] launch failed via xctrace fallback"
  exit ${fallback_status}
fi

echo "[ios-e2e] launch success via xctrace fallback"

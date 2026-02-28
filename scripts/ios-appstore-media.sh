#!/usr/bin/env bash
set -euo pipefail

# Generate App Store screenshots and preview videos from iOS simulator captures.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPSTORE_MEDIA_ROOT="${APPSTORE_MEDIA_ROOT:-$REPO_ROOT/mingle-app/rn/appstore-media}"

OUT_DIR="${OUT_DIR:-$APPSTORE_MEDIA_ROOT/generated}"
APP_ID="${APP_ID:-com.minglelabs.mingle.rn}"
WORKSPACE="${WORKSPACE:-$REPO_ROOT/mingle-app/rn/ios/mingle.xcworkspace}"
SCHEME="${SCHEME:-mingle}"
XCCONFIG="${XCCONFIG:-$REPO_ROOT/mingle-app/rn/ios/devbox.runtime.xcconfig}"
DERIVED_DATA="${DERIVED_DATA:-$OUT_DIR/derived}"

IPHONE_NAME="${IPHONE_NAME:-iPhone 17 Pro Max}"
IPAD_NAME="${IPAD_NAME:-iPad Pro 13-inch (M5)}"

BUILD_APP=1
SKIP_STATUS_BAR_CLEAR=0

usage() {
  cat <<EOF
Usage: scripts/ios-appstore-media.sh [options]

Options:
  --no-build                  Skip xcodebuild and reuse existing built app.
  --out-dir <path>            Output directory (default: $OUT_DIR)
  --iphone-name <name>        iPhone simulator name (default: $IPHONE_NAME)
  --ipad-name <name>          iPad simulator name (default: $IPAD_NAME)
  --app-id <bundle-id>        App bundle identifier (default: $APP_ID)
  --workspace <path>          Xcode workspace path
  --scheme <name>             Xcode scheme name
  --xcconfig <path>           Runtime xcconfig path
  --skip-status-bar-clear     Keep status bar overrides after generation
  -h, --help                  Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build)
      BUILD_APP=0
      shift
      ;;
    --out-dir)
      OUT_DIR="$2"
      shift 2
      ;;
    --iphone-name)
      IPHONE_NAME="$2"
      shift 2
      ;;
    --ipad-name)
      IPAD_NAME="$2"
      shift 2
      ;;
    --app-id)
      APP_ID="$2"
      shift 2
      ;;
    --workspace)
      WORKSPACE="$2"
      shift 2
      ;;
    --scheme)
      SCHEME="$2"
      shift 2
      ;;
    --xcconfig)
      XCCONFIG="$2"
      shift 2
      ;;
    --skip-status-bar-clear)
      SKIP_STATUS_BAR_CLEAR=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

for cmd in xcrun xcodebuild ffmpeg ffprobe; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing command: $cmd" >&2
    exit 1
  fi
done

if [[ ! -f "$WORKSPACE/contents.xcworkspacedata" ]]; then
  echo "Workspace not found: $WORKSPACE" >&2
  exit 1
fi

if [[ ! -f "$XCCONFIG" ]]; then
  echo "xcconfig not found: $XCCONFIG" >&2
  exit 1
fi

udid_for_name() {
  local name="$1"
  local udid
  udid="$(xcrun simctl list devices available | \
    rg -F "$name (" | head -n1 | sed -E 's/.*\(([0-9A-F-]+)\).*/\1/' || true)"
  if [[ -z "$udid" ]]; then
    echo "Unable to find available simulator: $name" >&2
    exit 1
  fi
  echo "$udid"
}

IPHONE_UDID="$(udid_for_name "$IPHONE_NAME")"
IPAD_UDID="$(udid_for_name "$IPAD_NAME")"

RAW_DIR="$OUT_DIR/raw"
FINAL_IPHONE_DIR="$OUT_DIR/final/iphone-69"
FINAL_IPAD_DIR="$OUT_DIR/final/ipad-13"
PREVIEW_DIR="$OUT_DIR/preview"
mkdir -p "$RAW_DIR" "$FINAL_IPHONE_DIR" "$FINAL_IPAD_DIR" "$PREVIEW_DIR"

if [[ "$BUILD_APP" -eq 1 ]]; then
  xcrun simctl boot "$IPHONE_UDID" || true
  xcodebuild \
    -workspace "$WORKSPACE" \
    -scheme "$SCHEME" \
    -configuration Release \
    -destination "id=$IPHONE_UDID" \
    -derivedDataPath "$DERIVED_DATA" \
    -xcconfig "$XCCONFIG" \
    build
fi

APP_PATH="$DERIVED_DATA/Build/Products/Release-iphonesimulator/$SCHEME.app"
FALLBACK_APP_PATH="$REPO_ROOT/.devbox-cache/ios/appstore-sim/Build/Products/Release-iphonesimulator/$SCHEME.app"
if [[ ! -d "$APP_PATH" && -d "$FALLBACK_APP_PATH" ]]; then
  APP_PATH="$FALLBACK_APP_PATH"
fi
if [[ ! -d "$APP_PATH" ]]; then
  echo "Built app not found: $APP_PATH" >&2
  exit 1
fi

xcrun simctl boot "$IPHONE_UDID" || true
xcrun simctl boot "$IPAD_UDID" || true
xcrun simctl install "$IPHONE_UDID" "$APP_PATH" || true
xcrun simctl install "$IPAD_UDID" "$APP_PATH" || true

# Stabilize status bar for App Store screenshots.
for udid in "$IPHONE_UDID" "$IPAD_UDID"; do
  xcrun simctl status_bar "$udid" override \
    --time "9:41" \
    --dataNetwork wifi \
    --wifiMode active \
    --wifiBars 3 \
    --batteryState charged \
    --batteryLevel 100 || true
done

xcrun simctl terminate "$IPHONE_UDID" "$APP_ID" || true
xcrun simctl launch "$IPHONE_UDID" "$APP_ID" >/dev/null || true
sleep 2
xcrun simctl io "$IPHONE_UDID" screenshot "$RAW_DIR/iphone-base-login-clean.png"

xcrun simctl terminate "$IPAD_UDID" "$APP_ID" || true
xcrun simctl launch "$IPAD_UDID" "$APP_ID" >/dev/null || true
sleep 5
xcrun simctl io "$IPAD_UDID" screenshot "$RAW_DIR/ipad-base-login-clean.png"

FONT="/System/Library/Fonts/Supplemental/Arial Bold.ttf"
BASE_I="$RAW_DIR/iphone-base-login-clean.png"
BASE_P="$RAW_DIR/ipad-base-login-clean.png"

gen_shot() {
  local in="$1"
  local out="$2"
  local title="$3"
  local subtitle="$4"
  local title_size="$5"
  local subtitle_size="$6"
  local title_y="$7"
  local subtitle_y="$8"

  ffmpeg -y -hide_banner -loglevel error -i "$in" \
    -vf "drawbox=x=0:y=0:w=iw:h=360:color=0x111111@0.62:t=fill,\
drawtext=fontfile=${FONT}:text='${title}':fontcolor=white:fontsize=${title_size}:x=(w-text_w)/2:y=${title_y},\
drawtext=fontfile=${FONT}:text='${subtitle}':fontcolor=0xE8E8E8:fontsize=${subtitle_size}:x=(w-text_w)/2:y=${subtitle_y}" \
    "$out"
}

SHOT_LINES=(
  "01|Real-time Speech Translation|Start speaking and see results instantly"
  "02|Voice-First Conversation|Built for quick, natural interactions"
  "03|Easy Sign-in Options|Use Apple or Google to get started"
  "04|Low-Latency Experience|Optimized for live use on mobile"
  "05|Ready for Multiple Languages|Switch languages while you talk"
)

for line in "${SHOT_LINES[@]}"; do
  IFS='|' read -r num title subtitle <<<"$line"
  gen_shot "$BASE_I" "$FINAL_IPHONE_DIR/${num}-${title// /-}.png" "$title" "$subtitle" 74 44 92 188
  gen_shot "$BASE_P" "$FINAL_IPAD_DIR/${num}-${title// /-}.png" "$title" "$subtitle" 88 50 92 202
done

make_preview() {
  local in_dir="$1"
  local out_file="$2"
  local list_file
  list_file="$(mktemp)"

  for f in "$in_dir"/01-*.png "$in_dir"/02-*.png "$in_dir"/03-*.png "$in_dir"/04-*.png "$in_dir"/05-*.png; do
    echo "file '$f'" >>"$list_file"
    echo "duration 3" >>"$list_file"
  done
  echo "file '$in_dir/05-Ready-for-Multiple-Languages.png'" >>"$list_file"

  ffmpeg -y -hide_banner -loglevel error \
    -f concat -safe 0 -i "$list_file" \
    -vf "fps=30,format=yuv420p" \
    -t 18 \
    -c:v libx264 -profile:v high -level 4.1 -movflags +faststart \
    "$out_file"

  rm -f "$list_file"
}

make_preview "$FINAL_IPHONE_DIR" "$PREVIEW_DIR/mingle-preview-iphone-69.mov"
make_preview "$FINAL_IPAD_DIR" "$PREVIEW_DIR/mingle-preview-ipad-13.mov"

if [[ "$SKIP_STATUS_BAR_CLEAR" -eq 0 ]]; then
  xcrun simctl status_bar "$IPHONE_UDID" clear || true
  xcrun simctl status_bar "$IPAD_UDID" clear || true
fi

echo
echo "Done."
echo "iPhone screenshots: $FINAL_IPHONE_DIR"
echo "iPad screenshots:   $FINAL_IPAD_DIR"
echo "Previews:           $PREVIEW_DIR"
echo
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,duration \
  -of default=noprint_wrappers=1 "$PREVIEW_DIR/mingle-preview-iphone-69.mov"
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,duration \
  -of default=noprint_wrappers=1 "$PREVIEW_DIR/mingle-preview-ipad-13.mov"

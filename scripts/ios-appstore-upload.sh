#!/usr/bin/env bash
set -euo pipefail

API_KEY_JSON="${API_KEY_JSON:-/tmp/asc_api_key.json}"
APP_IDENTIFIER="${APP_IDENTIFIER:-com.minglelabs.mingle.rn}"
MEDIA_DIR="${MEDIA_DIR:-/tmp/mingle-appstore-upload}"
LOCALE="${LOCALE:-en-US}"

usage() {
  cat <<'EOF'
Usage: scripts/ios-appstore-upload.sh [options]

Options:
  --api-key-json <path>   App Store Connect API key JSON path (default: /tmp/asc_api_key.json)
  --app-id <bundle-id>    App bundle identifier (default: com.minglelabs.mingle.rn)
  --media-dir <dir>       Media root dir (default: /tmp/mingle-appstore-upload)
  --locale <locale>       Locale dir under media dir (default: en-US)
  -h, --help              Show help

Environment overrides:
  API_KEY_JSON, APP_IDENTIFIER, MEDIA_DIR, LOCALE
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-key-json)
      API_KEY_JSON="$2"
      shift 2
      ;;
    --app-id)
      APP_IDENTIFIER="$2"
      shift 2
      ;;
    --media-dir)
      MEDIA_DIR="$2"
      shift 2
      ;;
    --locale)
      LOCALE="$2"
      shift 2
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

if [[ ! -f "$API_KEY_JSON" ]]; then
  echo "Missing API key JSON: $API_KEY_JSON" >&2
  exit 1
fi

if [[ ! -d "$MEDIA_DIR/$LOCALE" ]]; then
  echo "Missing locale media directory: $MEDIA_DIR/$LOCALE" >&2
  exit 1
fi

if ! command -v fastlane >/dev/null 2>&1; then
  echo "fastlane is required but not found." >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required but not found." >&2
  exit 1
fi

prepare_preview_mp4() {
  local mov_path="$1"
  local mp4_path="$2"

  if [[ -f "$mp4_path" ]]; then
    return
  fi
  if [[ ! -f "$mov_path" ]]; then
    return
  fi

  echo "Transcoding preview: $(basename "$mov_path") -> $(basename "$mp4_path")"
  ffmpeg -y \
    -i "$mov_path" \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
    -shortest \
    -c:v libx264 \
    -pix_fmt yuv420p \
    -r 30 \
    -profile:v high \
    -c:a aac \
    -b:a 192k \
    -ar 44100 \
    -ac 2 \
    -movflags +faststart \
    "$mp4_path" >/dev/null 2>&1
}

prepare_preview_mp4 \
  "$MEDIA_DIR/$LOCALE/iphone-preview.mov" \
  "$MEDIA_DIR/$LOCALE/iphone-preview.mp4"
prepare_preview_mp4 \
  "$MEDIA_DIR/$LOCALE/ipad-preview.mov" \
  "$MEDIA_DIR/$LOCALE/ipad-preview.mp4"

TMP_RUN_DIR="$(mktemp -d /tmp/ios-appstore-upload.XXXXXX)"
trap 'rm -rf "$TMP_RUN_DIR"' EXIT
mkdir -p "$TMP_RUN_DIR/fastlane/metadata"

cat > "$TMP_RUN_DIR/fastlane/Deliverfile" <<EOF
app_identifier("${APP_IDENTIFIER}")
skip_metadata(true)
skip_binary_upload(true)
skip_app_version_update(true)
overwrite_screenshots(true)
force(true)
EOF

echo "Uploading screenshots via fastlane deliver..."
(
  cd "$TMP_RUN_DIR"
  FASTLANE_DISABLE_COLORS=1 FASTLANE_SKIP_UPDATE_CHECK=1 \
    fastlane deliver run \
    --api_key_path "$API_KEY_JSON" \
    --app_identifier "$APP_IDENTIFIER" \
    --screenshots_path "$MEDIA_DIR" \
    --skip_metadata true \
    --skip_binary_upload true \
    --skip_app_version_update true \
    --overwrite_screenshots true \
    --force true \
    --run_precheck_before_submit false
)

echo "Uploading app previews via Spaceship API..."
PATH="/opt/homebrew/opt/ruby/bin:/opt/homebrew/Cellar/fastlane/2.232.2/libexec/bin:$PATH" \
GEM_HOME="${FASTLANE_GEM_HOME:-$HOME/.local/share/fastlane/4.0.0}" \
GEM_PATH="${FASTLANE_GEM_HOME:-$HOME/.local/share/fastlane/4.0.0}:/opt/homebrew/Cellar/fastlane/2.232.2/libexec" \
APP_IDENTIFIER="$APP_IDENTIFIER" MEDIA_DIR="$MEDIA_DIR" LOCALE="$LOCALE" API_KEY_JSON="$API_KEY_JSON" \
ruby - <<'RUBY'
require 'json'
require 'spaceship'

api = JSON.parse(File.read(ENV.fetch('API_KEY_JSON')))
Spaceship::ConnectAPI.token = Spaceship::ConnectAPI::Token.create(
  key_id: api['key_id'],
  issuer_id: api['issuer_id'],
  key: api['key'],
  duration: 1200,
  in_house: api['in_house']
)

app = Spaceship::ConnectAPI::App.find(ENV.fetch('APP_IDENTIFIER'))
raise "app not found: #{ENV['APP_IDENTIFIER']}" unless app

version = app.get_edit_app_store_version(platform: Spaceship::ConnectAPI::Platform::IOS)
raise "editable iOS version not found for #{ENV['APP_IDENTIFIER']}" unless version

locale = ENV.fetch('LOCALE')
loc = version.get_app_store_version_localizations.find { |l| l.locale == locale }
raise "localization not found: #{locale}" unless loc

rel_url = "https://api.appstoreconnect.apple.com/v1/appStoreVersionLocalizations/#{loc.id}/relationships/appPreviewSets"
rel_resp = Spaceship::ConnectAPI.client.tunes_request_client.get(rel_url)
set_ids = (rel_resp.body['data'] || []).map { |x| x['id'] }
sets = set_ids.map { |id| Spaceship::ConnectAPI::AppPreviewSet.get(app_preview_set_id: id, includes: 'appPreviews') }

specs = {
  Spaceship::ConnectAPI::AppPreviewSet::PreviewType::IPHONE_67 => File.join(ENV.fetch('MEDIA_DIR'), locale, 'iphone-preview.mp4'),
  Spaceship::ConnectAPI::AppPreviewSet::PreviewType::IPAD_PRO_3GEN_129 => File.join(ENV.fetch('MEDIA_DIR'), locale, 'ipad-preview.mp4')
}

uploaded_ids = []
specs.each do |ptype, path|
  next unless File.exist?(path)

  set = sets.find { |s| s.preview_type == ptype }
  set ||= loc.create_app_preview_set(attributes: { previewType: ptype })
  set = Spaceship::ConnectAPI::AppPreviewSet.get(app_preview_set_id: set.id, includes: 'appPreviews')

  (set.app_previews || []).each(&:delete!)

  preview = set.upload_preview(path: path, wait_for_processing: false)
  uploaded_ids << preview.id
  puts "uploaded #{File.basename(path)} -> #{ptype} (#{preview.id})"
end

sleep 15

uploaded_ids.each do |id|
  preview = Spaceship::ConnectAPI::AppPreview.get(app_preview_id: id)
  state = (preview.asset_delivery_state || {})['state']
  errors = ((preview.asset_delivery_state || {})['errors'] || []).map { |e| e['code'] }.join(',')
  puts "preview #{id}: state=#{state} errors=#{errors}"
end
RUBY

echo "Done."

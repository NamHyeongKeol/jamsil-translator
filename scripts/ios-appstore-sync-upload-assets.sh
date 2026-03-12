#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UPLOAD_DIR="${UPLOAD_DIR:-$REPO_ROOT/mingle-app/rn/appstore-connect-info/upload}"
API_KEY_JSON="${API_KEY_JSON:-/tmp/asc_api_key.json}"
APP_IDENTIFIER="${APP_IDENTIFIER:-com.minglelabs.mingle.rn}"
PRESERVE_LOCALES="${PRESERVE_LOCALES:-ko,en-US}"
PREFERRED_SCREENSHOT_TYPES="${PREFERRED_SCREENSHOT_TYPES:-APP_IPHONE_67,APP_IPHONE_65,APP_IPHONE_61,APP_IPHONE_58}"

usage() {
  cat <<EOF
Usage: scripts/ios-appstore-sync-upload-assets.sh [options]

Options:
  --upload-dir <dir>         Upload root dir (default: $UPLOAD_DIR)
  --api-key-json <path>      App Store Connect API key JSON path (default: $API_KEY_JSON)
  --app-id <bundle-id>       App bundle identifier (default: $APP_IDENTIFIER)
  --preserve-locales <list>  Comma-separated locales to skip downloading (default: $PRESERVE_LOCALES)
  --screenshot-types <list>  Preferred screenshot display types, in order (default: $PREFERRED_SCREENSHOT_TYPES)
  -h, --help                 Show help

Environment overrides:
  UPLOAD_DIR, API_KEY_JSON, APP_IDENTIFIER, PRESERVE_LOCALES, PREFERRED_SCREENSHOT_TYPES
  ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --upload-dir)
      UPLOAD_DIR="${2:-}"
      shift 2
      ;;
    --api-key-json)
      API_KEY_JSON="${2:-}"
      shift 2
      ;;
    --app-id)
      APP_IDENTIFIER="${2:-}"
      shift 2
      ;;
    --preserve-locales)
      PRESERVE_LOCALES="${2:-}"
      shift 2
      ;;
    --screenshot-types)
      PREFERRED_SCREENSHOT_TYPES="${2:-}"
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

[[ -d "$UPLOAD_DIR" ]] || {
  echo "Missing upload directory: $UPLOAD_DIR" >&2
  exit 1
}

if [[ ! -f "$API_KEY_JSON" ]]; then
  [[ -n "${ASC_KEY_ID:-}" ]] || { echo "Missing ASC_KEY_ID and API key JSON: $API_KEY_JSON" >&2; exit 1; }
  [[ -n "${ASC_ISSUER_ID:-}" ]] || { echo "Missing ASC_ISSUER_ID and API key JSON: $API_KEY_JSON" >&2; exit 1; }
  [[ -n "${ASC_KEY_PATH:-}" ]] || { echo "Missing ASC_KEY_PATH and API key JSON: $API_KEY_JSON" >&2; exit 1; }
  [[ -f "${ASC_KEY_PATH:-}" ]] || { echo "Missing ASC key file: ${ASC_KEY_PATH:-}" >&2; exit 1; }

  python3 - <<'PY' > "$API_KEY_JSON"
from pathlib import Path
import json
import os

payload = {
    "key_id": os.environ["ASC_KEY_ID"],
    "issuer_id": os.environ["ASC_ISSUER_ID"],
    "key": Path(os.environ["ASC_KEY_PATH"]).read_text(),
    "in_house": False,
}
print(json.dumps(payload))
PY
fi

find "$UPLOAD_DIR" -type f \( -name '*.mp4' -o -name '*.mov' -o -name '*-aac.mp4' \) -delete

PATH="/opt/homebrew/opt/ruby/bin:/opt/homebrew/Cellar/fastlane/2.232.2/libexec/bin:$PATH" \
GEM_HOME="${FASTLANE_GEM_HOME:-$HOME/.local/share/fastlane/4.0.0}" \
GEM_PATH="${FASTLANE_GEM_HOME:-$HOME/.local/share/fastlane/4.0.0}:/opt/homebrew/Cellar/fastlane/2.232.2/libexec" \
API_KEY_JSON="$API_KEY_JSON" APP_IDENTIFIER="$APP_IDENTIFIER" UPLOAD_DIR="$UPLOAD_DIR" PRESERVE_LOCALES="$PRESERVE_LOCALES" PREFERRED_SCREENSHOT_TYPES="$PREFERRED_SCREENSHOT_TYPES" \
ruby - <<'RUBY'
require 'fileutils'
require 'json'
require 'open-uri'
require 'set'
require 'spaceship'

api = JSON.parse(File.read(ENV.fetch('API_KEY_JSON')))
Spaceship::ConnectAPI.token = Spaceship::ConnectAPI::Token.create(
  key_id: api.fetch('key_id'),
  issuer_id: api.fetch('issuer_id'),
  key: api.fetch('key'),
  duration: 1200,
  in_house: api['in_house']
)

def choose_version(client, app)
  editable = app.get_edit_app_store_version(platform: Spaceship::ConnectAPI::Platform::IOS)
  return editable if editable

  versions = client.get("https://api.appstoreconnect.apple.com/v1/apps/#{app.id}/appStoreVersions?filter[platform]=IOS&limit=50").body['data'] || []
  preferred = %w[READY_FOR_SALE PENDING_DEVELOPER_RELEASE PRE_ORDER_READY_FOR_SALE PREPARE_FOR_SUBMISSION]
  versions.sort_by! do |version|
    attrs = version['attributes'] || {}
    state = attrs['appStoreState'].to_s
    preferred_index = preferred.index(state) || preferred.length
    created_at = attrs['createdDate'].to_s
    [preferred_index, created_at.empty? ? '' : created_at]
  end
  selected = versions.reverse.find do |version|
    attrs = version['attributes'] || {}
    preferred.include?(attrs['appStoreState'].to_s)
  end || versions.last
  raise "no iOS App Store version found" unless selected
  selected['id']
end

def download_url(attrs)
  image_asset = attrs['imageAsset'].is_a?(Hash) ? attrs['imageAsset'] : {}
  template_url = image_asset['templateUrl'].to_s
  width = image_asset['width']
  height = image_asset['height']
  file_name = attrs['fileName'].to_s
  ext = File.extname(file_name).delete('.')
  ext = 'png' if ext.empty?
  template_url
    .gsub('{w}', width.to_s)
    .gsub('{h}', height.to_s)
    .gsub('{f}', ext)
end

def unique_output_path(locale_dir, file_name, display_type)
  base = file_name.strip
  base = 'screenshot.png' if base.empty?
  path = File.join(locale_dir, base)
  return path unless File.exist?(path)

  path = File.join(locale_dir, "#{display_type.downcase}-#{base}")
  return path unless File.exist?(path)

  stem = File.basename(base, '.*')
  ext = File.extname(base)
  index = 2
  loop do
    candidate = File.join(locale_dir, "#{display_type.downcase}-#{stem}-#{index}#{ext}")
    return candidate unless File.exist?(candidate)
    index += 1
  end
end

def choose_screenshot_set(set_payloads, preferred_types)
  preferred_types.each do |ptype|
    match = set_payloads.find { |payload| payload[:display_type] == ptype }
    return match if match
  end

  iphone_fallback = set_payloads.find { |payload| payload[:display_type].start_with?('APP_IPHONE_') }
  iphone_fallback || set_payloads.first
end

client = Spaceship::ConnectAPI.client.tunes_request_client
app = Spaceship::ConnectAPI::App.find(ENV.fetch('APP_IDENTIFIER'))
raise "app not found: #{ENV['APP_IDENTIFIER']}" unless app

version_ref = choose_version(client, app)
version_id = version_ref.respond_to?(:id) ? version_ref.id : version_ref.to_s
raise 'version id missing' if version_id.empty?

upload_dir = ENV.fetch('UPLOAD_DIR')
preserve_locales = ENV.fetch('PRESERVE_LOCALES').split(',').map(&:strip).reject(&:empty?).to_set

loc_refs = client.get("https://api.appstoreconnect.apple.com/v1/appStoreVersions/#{version_id}/relationships/appStoreVersionLocalizations").body['data'] || []

loc_refs.each do |ref|
  loc = client.get("https://api.appstoreconnect.apple.com/v1/appStoreVersionLocalizations/#{ref['id']}").body['data']
  locale = loc.dig('attributes', 'locale').to_s
  next if locale.empty?

  locale_dir = File.join(upload_dir, locale)
  FileUtils.mkdir_p(locale_dir)

  if preserve_locales.include?(locale)
    puts "[preserve] #{locale}"
    next
  end

  Dir.glob(File.join(locale_dir, '*')).each do |path|
    next if File.directory?(path)
    next if File.basename(path) == '.gitkeep'
    if %w[.png .jpg .jpeg].include?(File.extname(path).downcase)
      File.delete(path)
    end
  end

  set_refs = client.get("https://api.appstoreconnect.apple.com/v1/appStoreVersionLocalizations/#{ref['id']}/relationships/appScreenshotSets").body['data'] || []
  preferred_types = ENV.fetch('PREFERRED_SCREENSHOT_TYPES').split(',').map(&:strip).reject(&:empty?)
  set_payloads = set_refs.map do |set_ref|
    set = client.get("https://api.appstoreconnect.apple.com/v1/appScreenshotSets/#{set_ref['id']}").body['data']
    {
      id: set_ref['id'],
      display_type: set.dig('attributes', 'screenshotDisplayType').to_s
    }
  end
  selected_set = choose_screenshot_set(set_payloads, preferred_types)
  downloaded = 0

  if selected_set
    display_type = selected_set[:display_type]
    shot_refs = client.get("https://api.appstoreconnect.apple.com/v1/appScreenshotSets/#{selected_set[:id]}/relationships/appScreenshots").body['data'] || []

    shot_refs.each do |shot_ref|
      shot = client.get("https://api.appstoreconnect.apple.com/v1/appScreenshots/#{shot_ref['id']}").body['data']
      attrs = shot['attributes'].is_a?(Hash) ? shot['attributes'] : {}
      next unless attrs.dig('assetDeliveryState', 'state') == 'COMPLETE'

      url = download_url(attrs)
      next if url.empty?

      output_path = unique_output_path(locale_dir, attrs['fileName'].to_s, display_type)
      URI.open(url) do |remote|
        File.binwrite(output_path, remote.read)
      end
      downloaded += 1
    end
  end

  selected_type = selected_set ? selected_set[:display_type] : 'none'
  puts "[downloaded] #{locale} screenshots=#{downloaded} display_type=#{selected_type}"
end
RUBY

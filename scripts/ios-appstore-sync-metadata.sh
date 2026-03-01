#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COPY_JSON="${COPY_JSON:-$REPO_ROOT/mingle-app/rn/appstore-media/copy/screenshot-copy.i18n.json}"
API_KEY_JSON="${API_KEY_JSON:-/tmp/asc_api_key.json}"
APP_IDENTIFIER="${APP_IDENTIFIER:-com.minglelabs.mingle.rn}"
DRY_RUN=false
NO_FALLBACK=false

usage() {
  cat <<EOF
Usage: scripts/ios-appstore-sync-metadata.sh [options]

Options:
  --json <path>           i18n JSON path (default: $COPY_JSON)
  --api-key-json <path>   App Store Connect API key JSON path (default: $API_KEY_JSON)
  --app-id <bundle-id>    App bundle identifier (default: $APP_IDENTIFIER)
  --dry-run               Print planned updates only (no ASC write)
  --no-fallback           Do not fallback metadata locale when target locale is missing
  -h, --help              Show help

JSON source:
  Uses title/subtitle and appStore metadata from screenshot-copy.i18n.json
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      COPY_JSON="${2:-}"
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
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --no-fallback)
      NO_FALLBACK=true
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

[[ -f "$COPY_JSON" ]] || { echo "Missing JSON: $COPY_JSON" >&2; exit 1; }
[[ -f "$API_KEY_JSON" ]] || { echo "Missing API key JSON: $API_KEY_JSON" >&2; exit 1; }

if ! command -v ruby >/dev/null 2>&1; then
  echo "ruby is required but not found." >&2
  exit 1
fi

PATH="/opt/homebrew/opt/ruby/bin:/opt/homebrew/Cellar/fastlane/2.232.2/libexec/bin:$PATH" \
GEM_HOME="${FASTLANE_GEM_HOME:-$HOME/.local/share/fastlane/4.0.0}" \
GEM_PATH="${FASTLANE_GEM_HOME:-$HOME/.local/share/fastlane/4.0.0}:/opt/homebrew/Cellar/fastlane/2.232.2/libexec" \
COPY_JSON="$COPY_JSON" API_KEY_JSON="$API_KEY_JSON" APP_IDENTIFIER="$APP_IDENTIFIER" DRY_RUN="$DRY_RUN" NO_FALLBACK="$NO_FALLBACK" \
ruby - <<'RUBY'
require 'json'
require 'spaceship'

def presence(value)
  return nil if value.nil?
  if value.is_a?(String)
    text = value.strip
    return nil if text.empty?
    return text
  end
  value
end

copy_json = ENV.fetch('COPY_JSON')
api_key_json = ENV.fetch('API_KEY_JSON')
app_identifier = ENV.fetch('APP_IDENTIFIER')
dry_run = ENV.fetch('DRY_RUN') == 'true'
no_fallback = ENV.fetch('NO_FALLBACK') == 'true'

payload = JSON.parse(File.read(copy_json))
title_map = payload.fetch('title', {})
subtitle_map = payload.fetch('subtitle', {})
app_store = payload.fetch('appStore', {})
metadata_map = app_store.fetch('metadata', {})
default_metadata_locale = no_fallback ? nil : presence(app_store['defaultMetadataLocale']) || 'en'
expected_version = presence(app_store['version'])
copyright_value = presence(app_store['copyright'])

api = JSON.parse(File.read(api_key_json))
Spaceship::ConnectAPI.token = Spaceship::ConnectAPI::Token.create(
  key_id: api.fetch('key_id'),
  issuer_id: api.fetch('issuer_id'),
  key: api.fetch('key'),
  duration: 1200,
  in_house: api['in_house']
)

def json_locale_key_for_asc(locale)
  normalized = locale.to_s.strip.downcase
  return '' if normalized.empty?

  explicit = {
    'en-us' => 'en',
    'ko' => 'ko',
    'ja' => 'ja',
    'zh-hans' => 'zh-cn',
    'zh-hant' => 'zh-tw',
    'de-de' => 'de',
    'es-es' => 'es',
    'fr-fr' => 'fr',
    'fr-ca' => 'fr',
    'it' => 'it',
    'pt-br' => 'pt',
    'pt-pt' => 'pt',
    'ru' => 'ru',
    'ar-sa' => 'ar',
    'hi' => 'hi',
    'th' => 'th',
    'vi' => 'vi'
  }
  return explicit.fetch(normalized, normalized.split('-').first.to_s)
end

client = Spaceship::ConnectAPI.client.tunes_request_client
app = Spaceship::ConnectAPI::App.find(app_identifier)
raise "app not found: #{app_identifier}" unless app

version = app.get_edit_app_store_version(platform: Spaceship::ConnectAPI::Platform::IOS)
raise "editable iOS version not found for #{app_identifier}" unless version

if expected_version && version.version_string != expected_version
  raise "editable version mismatch: expected #{expected_version}, actual #{version.version_string}"
end

version_loc_updates = 0
app_info_loc_updates = 0

version.get_app_store_version_localizations.each do |loc|
  asc_locale = loc.locale
  locale_key = json_locale_key_for_asc(asc_locale)
  metadata = metadata_map[locale_key]
  if metadata.nil? && default_metadata_locale
    metadata = metadata_map[default_metadata_locale]
  end
  metadata ||= {}

  attributes = {}
  if metadata.key?('promotionalText')
    attributes[:promotionalText] = metadata['promotionalText'].to_s
  end
  if metadata.key?('description')
    attributes[:description] = metadata['description'].to_s
  end
  if metadata.key?('keywords')
    raw_keywords = metadata['keywords']
    attributes[:keywords] = raw_keywords.is_a?(Array) ? raw_keywords.map(&:to_s).join(',') : raw_keywords.to_s
  end
  if metadata.key?('supportUrl')
    attributes[:supportUrl] = metadata['supportUrl'].to_s
  end
  if metadata.key?('marketingUrl')
    attributes[:marketingUrl] = metadata['marketingUrl'].to_s
  end

  attributes.delete_if { |_k, v| v.nil? }
  next if attributes.empty?

  puts "[version-loc] #{asc_locale} <- #{locale_key} #{attributes.keys.join(',')}"
  unless dry_run
    client.patch(
      "https://api.appstoreconnect.apple.com/v1/appStoreVersionLocalizations/#{loc.id}",
      {
        data: {
          type: 'appStoreVersionLocalizations',
          id: loc.id,
          attributes: attributes
        }
      }
    )
  end
  version_loc_updates += 1
end

app_infos = client.get("https://api.appstoreconnect.apple.com/v1/apps/#{app.id}/appInfos").body['data'] || []
app_info_id = app_infos.first&.dig('id')
raise "appInfo not found for app #{app.id}" unless app_info_id

app_info_loc_refs = client.get(
  "https://api.appstoreconnect.apple.com/v1/appInfos/#{app_info_id}/relationships/appInfoLocalizations"
).body['data'] || []

app_info_loc_refs.each do |ref|
  loc_id = ref['id']
  instance = client.get("https://api.appstoreconnect.apple.com/v1/appInfoLocalizations/#{loc_id}").body['data']
  asc_locale = instance.dig('attributes', 'locale').to_s
  locale_key = json_locale_key_for_asc(asc_locale)

  name = title_map[locale_key] || title_map['en']
  subtitle = subtitle_map[locale_key] || subtitle_map['en']

  attributes = {}
  attributes[:name] = name if name
  attributes[:subtitle] = subtitle if subtitle
  next if attributes.empty?

  puts "[app-info-loc] #{asc_locale} <- #{locale_key} #{attributes.keys.join(',')}"
  unless dry_run
    client.patch(
      "https://api.appstoreconnect.apple.com/v1/appInfoLocalizations/#{loc_id}",
      {
        data: {
          type: 'appInfoLocalizations',
          id: loc_id,
          attributes: attributes
        }
      }
    )
  end
  app_info_loc_updates += 1
end

if copyright_value
  puts "[version] set copyright on #{version.version_string}"
  unless dry_run
    client.patch(
      "https://api.appstoreconnect.apple.com/v1/appStoreVersions/#{version.id}",
      {
        data: {
          type: 'appStoreVersions',
          id: version.id,
          attributes: {
            copyright: copyright_value
          }
        }
      }
    )
  end
end

puts "done: version_localizations=#{version_loc_updates}, app_info_localizations=#{app_info_loc_updates}, dry_run=#{dry_run}"
RUBY

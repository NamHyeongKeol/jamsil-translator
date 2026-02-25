import { NextRequest, NextResponse } from 'next/server'

type VersionTuple = [number, number, number]
type VersionPolicyAction = 'force_update' | 'recommend_update' | 'none'
type SupportedLocale = 'ko' | 'en' | 'ja'

const DEFAULT_MIN_SUPPORTED_VERSION = '1.0.0'

const FORCE_MESSAGES: Record<SupportedLocale, string> = {
  ko: '현재 버전에서는 서비스를 사용할 수 없습니다. 최신 버전으로 업데이트해 주세요.',
  en: 'This version is no longer supported. Please update to the latest version.',
  ja: 'このバージョンはサポートされていません。最新バージョンにアップデートしてください。',
}

const RECOMMEND_MESSAGES: Record<SupportedLocale, string> = {
  ko: '새 버전이 출시되었습니다. 더 안정적인 사용을 위해 업데이트를 권장합니다.',
  en: 'A new version is available. We recommend updating for a better experience.',
  ja: '新しいバージョンが利用可能です。より安定した利用のためにアップデートをお勧めします。',
}

const FORCE_UPDATE_TITLE: Record<SupportedLocale, string> = {
  ko: '업데이트 필요',
  en: 'Update Required',
  ja: 'アップデートが必要です',
}

const RECOMMEND_UPDATE_TITLE: Record<SupportedLocale, string> = {
  ko: '업데이트 권장',
  en: 'Update Recommended',
  ja: 'アップデート推奨',
}

const UPDATE_BUTTON_LABEL: Record<SupportedLocale, string> = {
  ko: '업데이트',
  en: 'Update',
  ja: 'アップデート',
}

const LATER_BUTTON_LABEL: Record<SupportedLocale, string> = {
  ko: '나중에',
  en: 'Later',
  ja: 'あとで',
}

const SUPPORTED_LOCALES = new Set<SupportedLocale>(['ko', 'en', 'ja'])
const DEFAULT_LOCALE: SupportedLocale = 'en'

function resolveLocale(raw: unknown): SupportedLocale {
  if (typeof raw !== 'string') return DEFAULT_LOCALE
  const normalized = raw.trim().split(/[-_]/)[0]?.toLowerCase() || ''
  if (SUPPORTED_LOCALES.has(normalized as SupportedLocale)) return normalized as SupportedLocale
  return DEFAULT_LOCALE
}

function normalizeVersionString(raw: string): string {
  return raw.trim().replace(/^v/i, '')
}

function parseSemver3(raw: string): VersionTuple | null {
  const normalized = normalizeVersionString(raw)
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) return null

  const parts = normalized.split('.').map(part => Number.parseInt(part, 10))
  if (parts.length !== 3) return null
  if (parts.some(part => !Number.isFinite(part) || part < 0)) return null
  return [parts[0], parts[1], parts[2]]
}

function formatVersion(version: VersionTuple): string {
  return `${version[0]}.${version[1]}.${version[2]}`
}

function compareVersion(a: VersionTuple, b: VersionTuple): number {
  if (a[0] !== b[0]) return a[0] > b[0] ? 1 : -1
  if (a[1] !== b[1]) return a[1] > b[1] ? 1 : -1
  if (a[2] !== b[2]) return a[2] > b[2] ? 1 : -1
  return 0
}

function readRequiredVersionFromEnv(key: string, fallback: string): VersionTuple {
  const parsed = parseSemver3(process.env[key] || '')
  if (parsed) return parsed
  const fallbackParsed = parseSemver3(fallback)
  if (!fallbackParsed) {
    throw new Error(`invalid fallback semver: ${fallback}`)
  }
  return fallbackParsed
}

function readOptionalVersionFromEnv(key: string): VersionTuple | null {
  const raw = process.env[key] || ''
  if (!raw.trim()) return null
  return parseSemver3(raw)
}

function resolvePolicy(args: {
  clientVersion: VersionTuple | null
  minSupportedVersion: VersionTuple
  recommendBelowVersion: VersionTuple | null
}): VersionPolicyAction {
  if (!args.clientVersion) return 'force_update'
  if (compareVersion(args.clientVersion, args.minSupportedVersion) < 0) return 'force_update'
  if (args.recommendBelowVersion && compareVersion(args.clientVersion, args.recommendBelowVersion) < 0) {
    return 'recommend_update'
  }
  return 'none'
}

export async function handleIosClientVersionPolicy(
  request: NextRequest,
): Promise<NextResponse> {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    // tolerate empty/invalid body and treat as missing client version
  }

  const locale = resolveLocale(body.locale)
  const clientVersionRaw = typeof body.clientVersion === 'string' ? body.clientVersion : ''
  const clientBuildRaw = typeof body.clientBuild === 'string' ? body.clientBuild.trim() : ''
  const clientVersion = parseSemver3(clientVersionRaw)
  const minSupportedVersion = readRequiredVersionFromEnv(
    'IOS_CLIENT_MIN_SUPPORTED_VERSION',
    DEFAULT_MIN_SUPPORTED_VERSION,
  )
  const recommendedVersion = readOptionalVersionFromEnv('IOS_CLIENT_RECOMMENDED_BELOW_VERSION')
  const latestVersion = readOptionalVersionFromEnv('IOS_CLIENT_LATEST_VERSION')
    || recommendedVersion
    || minSupportedVersion

  const action = resolvePolicy({
    clientVersion,
    minSupportedVersion,
    recommendBelowVersion: recommendedVersion,
  })

  const envForceMessage = process.env.IOS_CLIENT_FORCE_UPDATE_MESSAGE?.trim()
  const envRecommendMessage = process.env.IOS_CLIENT_RECOMMEND_UPDATE_MESSAGE?.trim()

  const message = action === 'force_update'
    ? (envForceMessage || FORCE_MESSAGES[locale])
    : action === 'recommend_update'
      ? (envRecommendMessage || RECOMMEND_MESSAGES[locale])
      : ''

  const title = action === 'force_update'
    ? FORCE_UPDATE_TITLE[locale]
    : action === 'recommend_update'
      ? RECOMMEND_UPDATE_TITLE[locale]
      : ''

  const responseBody = {
    action,
    locale,
    clientVersion: clientVersion ? formatVersion(clientVersion) : normalizeVersionString(clientVersionRaw),
    clientBuild: clientBuildRaw,
    minSupportedVersion: formatVersion(minSupportedVersion),
    recommendedBelowVersion: recommendedVersion ? formatVersion(recommendedVersion) : '',
    latestVersion: formatVersion(latestVersion),
    updateUrl: process.env.IOS_APPSTORE_URL || '',
    title,
    message,
    updateButtonLabel: UPDATE_BUTTON_LABEL[locale],
    laterButtonLabel: LATER_BUTTON_LABEL[locale],
  }

  return NextResponse.json(responseBody, { status: 200 })
}

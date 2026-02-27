import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type VersionTuple = [number, number, number]
type VersionPolicyAction = 'force_update' | 'recommend_update' | 'none'
type SupportedLocale =
  | 'ko'
  | 'en'
  | 'ja'
  | 'zh-CN'
  | 'zh-TW'
  | 'fr'
  | 'de'
  | 'es'
  | 'pt'
  | 'it'
  | 'ru'
  | 'ar'
  | 'hi'
  | 'th'
  | 'vi'

type VersionPolicySnapshot = {
  minSupportedVersion: VersionTuple
  recommendBelowVersion: VersionTuple | null
  latestVersion: VersionTuple
  updateUrl: string
}

type VersionPolicySource =
  | 'db'
  | 'fallback_no_policy'
  | 'fallback_invalid'
  | 'fallback_error'

type VersionPolicyReadResult = {
  snapshot: VersionPolicySnapshot
  source: VersionPolicySource
}

const DEFAULT_MIN_SUPPORTED_VERSION: VersionTuple = [1, 0, 0]

const FORCE_MESSAGES: Record<SupportedLocale, string> = {
  ko: '현재 버전에서는 서비스를 사용할 수 없습니다. 최신 버전으로 업데이트해 주세요.',
  en: 'This version is no longer supported. Please update to the latest version.',
  ja: 'このバージョンはサポートされていません。最新バージョンにアップデートしてください。',
  'zh-CN': '当前版本已不再受支持。请更新到最新版本。',
  'zh-TW': '目前版本已不再支援。請更新至最新版本。',
  fr: 'Cette version n\'est plus prise en charge. Veuillez mettre à jour vers la dernière version.',
  de: 'Diese Version wird nicht mehr unterstützt. Bitte aktualisieren Sie auf die neueste Version.',
  es: 'Esta versión ya no es compatible. Actualiza a la última versión.',
  pt: 'Esta versão não é mais compatível. Atualize para a versão mais recente.',
  it: 'Questa versione non è più supportata. Aggiorna all\'ultima versione.',
  ru: 'Эта версия больше не поддерживается. Обновите приложение до последней версии.',
  ar: 'هذا الإصدار لم يعد مدعومًا. يرجى التحديث إلى أحدث إصدار.',
  hi: 'यह संस्करण अब समर्थित नहीं है। कृपया नवीनतम संस्करण में अपडेट करें।',
  th: 'เวอร์ชันนี้ไม่รองรับแล้ว กรุณาอัปเดตเป็นเวอร์ชันล่าสุด',
  vi: 'Phiên bản này không còn được hỗ trợ. Vui lòng cập nhật lên phiên bản mới nhất.',
}

const RECOMMEND_MESSAGES: Record<SupportedLocale, string> = {
  ko: '새 버전이 출시되었습니다. 더 안정적인 사용을 위해 업데이트를 권장합니다.',
  en: 'A new version is available. We recommend updating for a better experience.',
  ja: '新しいバージョンが利用可能です。より安定した利用のためにアップデートをお勧めします。',
  'zh-CN': '新版本已发布，建议更新以获得更稳定的体验。',
  'zh-TW': '新版本已推出，建議更新以獲得更穩定的體驗。',
  fr: 'Une nouvelle version est disponible. Nous vous recommandons de mettre à jour pour une meilleure stabilité.',
  de: 'Eine neue Version ist verfügbar. Wir empfehlen ein Update für eine stabilere Nutzung.',
  es: 'Hay una nueva versión disponible. Recomendamos actualizar para una experiencia más estable.',
  pt: 'Há uma nova versão disponível. Recomendamos atualizar para uma experiência mais estável.',
  it: 'È disponibile una nuova versione. Ti consigliamo di aggiornare per un\'esperienza più stabile.',
  ru: 'Доступна новая версия. Рекомендуем обновить приложение для более стабильной работы.',
  ar: 'يتوفر إصدار جديد. نوصي بالتحديث للحصول على تجربة أكثر استقرارًا.',
  hi: 'नया संस्करण उपलब्ध है। अधिक स्थिर अनुभव के लिए अपडेट करने की सलाह दी जाती है।',
  th: 'มีเวอร์ชันใหม่พร้อมใช้งาน แนะนำให้อัปเดตเพื่อการใช้งานที่เสถียรยิ่งขึ้น',
  vi: 'Đã có phiên bản mới. Chúng tôi khuyên bạn nên cập nhật để có trải nghiệm ổn định hơn.',
}

const FORCE_UPDATE_TITLE: Record<SupportedLocale, string> = {
  ko: '업데이트 필요',
  en: 'Update Required',
  ja: 'アップデートが必要です',
  'zh-CN': '更新必需',
  'zh-TW': '必須更新',
  fr: 'Mise à jour requise',
  de: 'Update erforderlich',
  es: 'Actualización obligatoria',
  pt: 'Atualização obrigatória',
  it: 'Aggiornamento obbligatorio',
  ru: 'Требуется обновление',
  ar: 'التحديث مطلوب',
  hi: 'अपडेट आवश्यक',
  th: 'จำเป็นต้องอัปเดต',
  vi: 'Cần cập nhật',
}

const RECOMMEND_UPDATE_TITLE: Record<SupportedLocale, string> = {
  ko: '업데이트 권장',
  en: 'Update Recommended',
  ja: 'アップデート推奨',
  'zh-CN': '建议更新',
  'zh-TW': '建議更新',
  fr: 'Mise à jour recommandée',
  de: 'Update empfohlen',
  es: 'Actualización recomendada',
  pt: 'Atualização recomendada',
  it: 'Aggiornamento consigliato',
  ru: 'Рекомендуется обновление',
  ar: 'يوصى بالتحديث',
  hi: 'अपडेट की अनुशंसा',
  th: 'แนะนำให้อัปเดต',
  vi: 'Khuyến nghị cập nhật',
}

const UPDATE_BUTTON_LABEL: Record<SupportedLocale, string> = {
  ko: '업데이트',
  en: 'Update',
  ja: 'アップデート',
  'zh-CN': '更新',
  'zh-TW': '更新',
  fr: 'Mettre à jour',
  de: 'Aktualisieren',
  es: 'Actualizar',
  pt: 'Atualizar',
  it: 'Aggiorna',
  ru: 'Обновить',
  ar: 'تحديث',
  hi: 'अपडेट करें',
  th: 'อัปเดต',
  vi: 'Cập nhật',
}

const LATER_BUTTON_LABEL: Record<SupportedLocale, string> = {
  ko: '나중에',
  en: 'Later',
  ja: 'あとで',
  'zh-CN': '稍后',
  'zh-TW': '稍後',
  fr: 'Plus tard',
  de: 'Später',
  es: 'Más tarde',
  pt: 'Mais tarde',
  it: 'Più tardi',
  ru: 'Позже',
  ar: 'لاحقًا',
  hi: 'बाद में',
  th: 'ภายหลัง',
  vi: 'Để sau',
}

const SUPPORTED_LOCALES = new Set<SupportedLocale>([
  'ko',
  'en',
  'ja',
  'zh-CN',
  'zh-TW',
  'fr',
  'de',
  'es',
  'pt',
  'it',
  'ru',
  'ar',
  'hi',
  'th',
  'vi',
])
const LOCALE_ALIAS_MAP: Record<string, SupportedLocale> = {
  ko: 'ko',
  en: 'en',
  ja: 'ja',
  fr: 'fr',
  de: 'de',
  es: 'es',
  pt: 'pt',
  it: 'it',
  ru: 'ru',
  ar: 'ar',
  hi: 'hi',
  th: 'th',
  vi: 'vi',
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-sg': 'zh-CN',
  'zh-tw': 'zh-TW',
  'zh-hant': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-mo': 'zh-TW',
}
const DEFAULT_LOCALE: SupportedLocale = 'en'

function resolveLocale(raw: unknown): SupportedLocale {
  if (typeof raw !== 'string') return DEFAULT_LOCALE
  const normalized = raw.trim().replace(/_/g, '-').toLowerCase()
  if (!normalized) return DEFAULT_LOCALE

  const directMatch = LOCALE_ALIAS_MAP[normalized]
  if (directMatch && SUPPORTED_LOCALES.has(directMatch)) return directMatch

  if (normalized.startsWith('zh-')) {
    if (normalized.includes('-tw') || normalized.includes('-hant') || normalized.includes('-hk') || normalized.includes('-mo')) {
      return 'zh-TW'
    }
    return 'zh-CN'
  }

  const base = normalized.split('-')[0] || ''
  const baseMatch = LOCALE_ALIAS_MAP[base]
  if (baseMatch && SUPPORTED_LOCALES.has(baseMatch)) return baseMatch

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

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code === 'P2002'
}

function buildFallbackPolicySnapshot(
  source: Exclude<VersionPolicySource, 'db'>,
): VersionPolicyReadResult {
  return {
    source,
    snapshot: {
      minSupportedVersion: DEFAULT_MIN_SUPPORTED_VERSION,
      recommendBelowVersion: null,
      latestVersion: DEFAULT_MIN_SUPPORTED_VERSION,
      updateUrl: '',
    },
  }
}

async function insertClientVersionIfMissing(clientVersion: VersionTuple | null): Promise<void> {
  if (!clientVersion) return

  try {
    await prisma.appClientVersion.create({
      data: {
        version: formatVersion(clientVersion),
        major: clientVersion[0],
        minor: clientVersion[1],
        patch: clientVersion[2],
      },
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) return
    console.error('[client-version-policy] app client version insert failed', error)
  }
}

async function readActiveVersionPolicy(now: Date): Promise<VersionPolicyReadResult> {

  try {
    const record = await prisma.appClientVersionPolicy.findFirst({
      where: {
        effectiveFrom: {
          lte: now,
        },
      },
      orderBy: [
        { effectiveFrom: 'desc' },
        { createdAt: 'desc' },
      ],
      select: {
        minSupportedVersion: true,
        recommendedBelowVersion: true,
        latestVersion: true,
        updateUrl: true,
      },
    })

    if (!record) {
      console.error('[client-version-policy] no active policy row found')
      return buildFallbackPolicySnapshot('fallback_no_policy')
    }

    const minSupportedVersion = parseSemver3(record.minSupportedVersion)
    if (!minSupportedVersion) {
      console.error('[client-version-policy] active policy has invalid min_supported_version', {
        minSupportedVersion: record.minSupportedVersion,
      })
      return buildFallbackPolicySnapshot('fallback_invalid')
    }

    const recommendBelowVersion = record.recommendedBelowVersion
      ? parseSemver3(record.recommendedBelowVersion)
      : null

    if (record.recommendedBelowVersion && !recommendBelowVersion) {
      console.error('[client-version-policy] active policy has invalid recommended_below_version', {
        recommendedBelowVersion: record.recommendedBelowVersion,
      })
    }

    const latestVersionFromPolicy = record.latestVersion
      ? parseSemver3(record.latestVersion)
      : null

    if (record.latestVersion && !latestVersionFromPolicy) {
      console.error('[client-version-policy] active policy has invalid latest_version', {
        latestVersion: record.latestVersion,
      })
    }

    const latestVersion = latestVersionFromPolicy || recommendBelowVersion || minSupportedVersion
    return {
      source: 'db',
      snapshot: {
        minSupportedVersion,
        recommendBelowVersion,
        latestVersion,
        updateUrl: record.updateUrl?.trim() || '',
      },
    }
  } catch (error) {
    console.error('[client-version-policy] active policy query failed', error)
    return buildFallbackPolicySnapshot('fallback_error')
  }
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

  const now = new Date()
  const [policyRead] = await Promise.all([
    readActiveVersionPolicy(now),
    insertClientVersionIfMissing(clientVersion),
  ])

  const action = policyRead.source === 'db'
    ? resolvePolicy({
      clientVersion,
      minSupportedVersion: policyRead.snapshot.minSupportedVersion,
      recommendBelowVersion: policyRead.snapshot.recommendBelowVersion,
    })
    : 'force_update'

  const message = action === 'force_update'
    ? FORCE_MESSAGES[locale]
    : action === 'recommend_update'
      ? RECOMMEND_MESSAGES[locale]
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
    minSupportedVersion: formatVersion(policyRead.snapshot.minSupportedVersion),
    recommendedBelowVersion: policyRead.snapshot.recommendBelowVersion ? formatVersion(policyRead.snapshot.recommendBelowVersion) : '',
    latestVersion: formatVersion(policyRead.snapshot.latestVersion),
    updateUrl: policyRead.snapshot.updateUrl,
    title,
    message,
    updateButtonLabel: UPDATE_BUTTON_LABEL[locale],
    laterButtonLabel: LATER_BUTTON_LABEL[locale],
  }

  return NextResponse.json(responseBody, { status: 200 })
}

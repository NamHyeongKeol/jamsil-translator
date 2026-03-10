import { NextRequest, NextResponse } from 'next/server'
import {
  resolveDictionaryLocale,
  resolveSupportedLocaleTag,
  type AppLocale,
  type TranslatedAppLocale,
} from '@/i18n'
import {
  generatedVersionPolicyCopy,
  type VersionPolicyCopy,
} from '@/i18n/generated-version-policy-copy'
import { prisma } from '@/lib/prisma'

type VersionTuple = [number, number, number]
type VersionPolicyAction = 'force_update' | 'recommend_update' | 'none'
type ClientPlatform = 'ios' | 'android'

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
  policyPlatform: ClientPlatform
}

const DEFAULT_MIN_SUPPORTED_VERSION: VersionTuple = [1, 0, 0]
const DEFAULT_CLIENT_PLATFORM: ClientPlatform = 'ios'
const CLIENT_PLATFORM_ALIASES: Record<string, ClientPlatform> = {
  ios: 'ios',
  iphone: 'ios',
  ipad: 'ios',
  android: 'android',
  aos: 'android',
}

const VERSION_POLICY_COPY = {
  ko: {
    forceMessage: '현재 버전에서는 서비스를 사용할 수 없습니다. 최신 버전으로 업데이트해 주세요.',
    recommendMessage: '새 버전이 출시되었습니다. 더 안정적인 사용을 위해 업데이트를 권장합니다.',
    forceTitle: '업데이트 필요',
    recommendTitle: '업데이트 권장',
    updateButtonLabel: '업데이트',
    laterButtonLabel: '나중에',
  },
  en: {
    forceMessage: 'This version is no longer supported. Please update to the latest version.',
    recommendMessage: 'A new version is available. We recommend updating for a better experience.',
    forceTitle: 'Update Required',
    recommendTitle: 'Update Recommended',
    updateButtonLabel: 'Update',
    laterButtonLabel: 'Later',
  },
  ja: {
    forceMessage: 'このバージョンはサポートされていません。最新バージョンにアップデートしてください。',
    recommendMessage: '新しいバージョンが利用可能です。より安定した利用のためにアップデートをお勧めします。',
    forceTitle: 'アップデートが必要です',
    recommendTitle: 'アップデート推奨',
    updateButtonLabel: 'アップデート',
    laterButtonLabel: 'あとで',
  },
  'zh-CN': {
    forceMessage: '当前版本已不再受支持。请更新到最新版本。',
    recommendMessage: '新版本已发布，建议更新以获得更稳定的体验。',
    forceTitle: '更新必需',
    recommendTitle: '建议更新',
    updateButtonLabel: '更新',
    laterButtonLabel: '稍后',
  },
  'zh-TW': {
    forceMessage: '目前版本已不再支援。請更新至最新版本。',
    recommendMessage: '新版本已推出，建議更新以獲得更穩定的體驗。',
    forceTitle: '必須更新',
    recommendTitle: '建議更新',
    updateButtonLabel: '更新',
    laterButtonLabel: '稍後',
  },
  fr: {
    forceMessage: 'Cette version n\'est plus prise en charge. Veuillez mettre à jour vers la dernière version.',
    recommendMessage: 'Une nouvelle version est disponible. Nous vous recommandons de mettre à jour pour une meilleure stabilité.',
    forceTitle: 'Mise à jour requise',
    recommendTitle: 'Mise à jour recommandée',
    updateButtonLabel: 'Mettre à jour',
    laterButtonLabel: 'Plus tard',
  },
  de: {
    forceMessage: 'Diese Version wird nicht mehr unterstützt. Bitte aktualisieren Sie auf die neueste Version.',
    recommendMessage: 'Eine neue Version ist verfügbar. Wir empfehlen ein Update für eine stabilere Nutzung.',
    forceTitle: 'Update erforderlich',
    recommendTitle: 'Update empfohlen',
    updateButtonLabel: 'Aktualisieren',
    laterButtonLabel: 'Später',
  },
  es: {
    forceMessage: 'Esta versión ya no es compatible. Actualiza a la última versión.',
    recommendMessage: 'Hay una nueva versión disponible. Recomendamos actualizar para una experiencia más estable.',
    forceTitle: 'Actualización obligatoria',
    recommendTitle: 'Actualización recomendada',
    updateButtonLabel: 'Actualizar',
    laterButtonLabel: 'Más tarde',
  },
  pt: {
    forceMessage: 'Esta versão não é mais compatível. Atualize para a versão mais recente.',
    recommendMessage: 'Há uma nova versão disponível. Recomendamos atualizar para uma experiência mais estável.',
    forceTitle: 'Atualização obrigatória',
    recommendTitle: 'Atualização recomendada',
    updateButtonLabel: 'Atualizar',
    laterButtonLabel: 'Mais tarde',
  },
  it: {
    forceMessage: 'Questa versione non è più supportata. Aggiorna all\'ultima versione.',
    recommendMessage: 'È disponibile una nuova versione. Ti consigliamo di aggiornare per un\'esperienza più stabile.',
    forceTitle: 'Aggiornamento obbligatorio',
    recommendTitle: 'Aggiornamento consigliato',
    updateButtonLabel: 'Aggiorna',
    laterButtonLabel: 'Più tardi',
  },
  ru: {
    forceMessage: 'Эта версия больше не поддерживается. Обновите приложение до последней версии.',
    recommendMessage: 'Доступна новая версия. Рекомендуем обновить приложение для более стабильной работы.',
    forceTitle: 'Требуется обновление',
    recommendTitle: 'Рекомендуется обновление',
    updateButtonLabel: 'Обновить',
    laterButtonLabel: 'Позже',
  },
  ar: {
    forceMessage: 'هذا الإصدار لم يعد مدعومًا. يرجى التحديث إلى أحدث إصدار.',
    recommendMessage: 'يتوفر إصدار جديد. نوصي بالتحديث للحصول على تجربة أكثر استقرارًا.',
    forceTitle: 'التحديث مطلوب',
    recommendTitle: 'يوصى بالتحديث',
    updateButtonLabel: 'تحديث',
    laterButtonLabel: 'لاحقًا',
  },
  hi: {
    forceMessage: 'यह संस्करण अब समर्थित नहीं है। कृपया नवीनतम संस्करण में अपडेट करें।',
    recommendMessage: 'नया संस्करण उपलब्ध है। अधिक स्थिर अनुभव के लिए अपडेट करने की सलाह दी जाती है।',
    forceTitle: 'अपडेट आवश्यक',
    recommendTitle: 'अपडेट की अनुशंसा',
    updateButtonLabel: 'अपडेट करें',
    laterButtonLabel: 'बाद में',
  },
  th: {
    forceMessage: 'เวอร์ชันนี้ไม่รองรับแล้ว กรุณาอัปเดตเป็นเวอร์ชันล่าสุด',
    recommendMessage: 'มีเวอร์ชันใหม่พร้อมใช้งาน แนะนำให้อัปเดตเพื่อการใช้งานที่เสถียรยิ่งขึ้น',
    forceTitle: 'จำเป็นต้องอัปเดต',
    recommendTitle: 'แนะนำให้อัปเดต',
    updateButtonLabel: 'อัปเดต',
    laterButtonLabel: 'ภายหลัง',
  },
  vi: {
    forceMessage: 'Phiên bản này không còn được hỗ trợ. Vui lòng cập nhật lên phiên bản mới nhất.',
    recommendMessage: 'Đã có phiên bản mới. Chúng tôi khuyên bạn nên cập nhật để có trải nghiệm ổn định hơn.',
    forceTitle: 'Cần cập nhật',
    recommendTitle: 'Khuyến nghị cập nhật',
    updateButtonLabel: 'Cập nhật',
    laterButtonLabel: 'Để sau',
  },
  ...generatedVersionPolicyCopy,
} satisfies Record<TranslatedAppLocale, VersionPolicyCopy>

const DEFAULT_LOCALE: AppLocale = 'en'

function resolveLocale(raw: unknown): AppLocale {
  if (typeof raw !== 'string') return DEFAULT_LOCALE
  return resolveSupportedLocaleTag(raw) || DEFAULT_LOCALE
}

function resolveClientPlatform(raw: unknown): ClientPlatform {
  if (typeof raw !== 'string') return DEFAULT_CLIENT_PLATFORM
  const normalized = raw.trim().toLowerCase()
  if (!normalized) return DEFAULT_CLIENT_PLATFORM
  return CLIENT_PLATFORM_ALIASES[normalized] || DEFAULT_CLIENT_PLATFORM
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
  policyPlatform: ClientPlatform,
): VersionPolicyReadResult {
  return {
    source,
    policyPlatform,
    snapshot: {
      minSupportedVersion: DEFAULT_MIN_SUPPORTED_VERSION,
      recommendBelowVersion: null,
      latestVersion: DEFAULT_MIN_SUPPORTED_VERSION,
      updateUrl: '',
    },
  }
}

async function insertClientVersionIfMissing(
  clientVersion: VersionTuple | null,
  platform: ClientPlatform,
): Promise<void> {
  if (!clientVersion) return

  try {
    await prisma.appClientVersion.create({
      data: {
        platform,
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

type ActivePolicyRecord = {
  minSupportedVersion: string
  recommendedBelowVersion: string | null
  latestVersion: string | null
  updateUrl: string | null
}

async function readActiveVersionPolicyForPlatform(
  platform: ClientPlatform,
): Promise<ActivePolicyRecord | null> {
  const rows = await prisma.$queryRaw<ActivePolicyRecord[]>`
    SELECT
      "min_supported_version" AS "minSupportedVersion",
      "recommended_below_version" AS "recommendedBelowVersion",
      "latest_version" AS "latestVersion",
      "update_url" AS "updateUrl"
    FROM "app"."app_client_version_policies"
    WHERE "platform" = ${platform}
      AND "effective_from" <= CURRENT_TIMESTAMP
    ORDER BY "effective_from" DESC, "created_at" DESC
    LIMIT 1
  `

  return rows[0] ?? null
}

async function readActiveVersionPolicy(
  requestedPlatform: ClientPlatform,
): Promise<VersionPolicyReadResult> {
  try {
    let policyPlatform: ClientPlatform = requestedPlatform
    let record = await readActiveVersionPolicyForPlatform(policyPlatform)

    if (!record && requestedPlatform !== DEFAULT_CLIENT_PLATFORM) {
      policyPlatform = DEFAULT_CLIENT_PLATFORM
      record = await readActiveVersionPolicyForPlatform(policyPlatform)
      if (record) {
        console.warn('[client-version-policy] fallback to ios policy row', {
          requestedPlatform,
        })
      }
    }

    if (!record) {
      console.error('[client-version-policy] no active policy row found', {
        requestedPlatform,
      })
      return buildFallbackPolicySnapshot('fallback_no_policy', requestedPlatform)
    }

    const minSupportedVersion = parseSemver3(record.minSupportedVersion)
    if (!minSupportedVersion) {
      console.error('[client-version-policy] active policy has invalid min_supported_version', {
        policyPlatform,
        minSupportedVersion: record.minSupportedVersion,
      })
      return buildFallbackPolicySnapshot('fallback_invalid', policyPlatform)
    }

    const recommendBelowVersion = record.recommendedBelowVersion
      ? parseSemver3(record.recommendedBelowVersion)
      : null

    if (record.recommendedBelowVersion && !recommendBelowVersion) {
      console.error('[client-version-policy] active policy has invalid recommended_below_version', {
        policyPlatform,
        recommendedBelowVersion: record.recommendedBelowVersion,
      })
    }

    const latestVersionFromPolicy = record.latestVersion
      ? parseSemver3(record.latestVersion)
      : null

    if (record.latestVersion && !latestVersionFromPolicy) {
      console.error('[client-version-policy] active policy has invalid latest_version', {
        policyPlatform,
        latestVersion: record.latestVersion,
      })
    }

    const latestVersion = latestVersionFromPolicy || recommendBelowVersion || minSupportedVersion
    return {
      source: 'db',
      policyPlatform,
      snapshot: {
        minSupportedVersion,
        recommendBelowVersion,
        latestVersion,
        updateUrl: record.updateUrl?.trim() || '',
      },
    }
  } catch (error) {
    console.error('[client-version-policy] active policy query failed', {
      requestedPlatform,
      error,
    })
    return buildFallbackPolicySnapshot('fallback_error', requestedPlatform)
  }
}

type HandleClientVersionPolicyOptions = {
  platformOverride?: ClientPlatform
}

export async function handleClientVersionPolicy(
  request: NextRequest,
  options?: HandleClientVersionPolicyOptions,
): Promise<NextResponse> {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    // tolerate empty/invalid body and treat as missing client version
  }

  const locale = resolveLocale(body.locale)
  const localizedLocale = resolveDictionaryLocale(locale)
  const clientPlatform = options?.platformOverride || resolveClientPlatform(body.platform)
  const clientVersionRaw = typeof body.clientVersion === 'string' ? body.clientVersion : ''
  const clientBuildRaw = typeof body.clientBuild === 'string' ? body.clientBuild.trim() : ''
  const clientVersion = parseSemver3(clientVersionRaw)

  const [policyRead] = await Promise.all([
    readActiveVersionPolicy(clientPlatform),
    insertClientVersionIfMissing(clientVersion, clientPlatform),
  ])

  const action = policyRead.source === 'db'
    ? resolvePolicy({
      clientVersion,
      minSupportedVersion: policyRead.snapshot.minSupportedVersion,
      recommendBelowVersion: policyRead.snapshot.recommendBelowVersion,
    })
    : 'force_update'

  const message = action === 'force_update'
    ? VERSION_POLICY_COPY[localizedLocale].forceMessage
    : action === 'recommend_update'
      ? VERSION_POLICY_COPY[localizedLocale].recommendMessage
      : ''

  const title = action === 'force_update'
    ? VERSION_POLICY_COPY[localizedLocale].forceTitle
    : action === 'recommend_update'
      ? VERSION_POLICY_COPY[localizedLocale].recommendTitle
      : ''

  const responseBody = {
    action,
    platform: clientPlatform,
    policyPlatform: policyRead.policyPlatform,
    locale,
    clientVersion: clientVersion ? formatVersion(clientVersion) : normalizeVersionString(clientVersionRaw),
    clientBuild: clientBuildRaw,
    minSupportedVersion: formatVersion(policyRead.snapshot.minSupportedVersion),
    recommendedBelowVersion: policyRead.snapshot.recommendBelowVersion ? formatVersion(policyRead.snapshot.recommendBelowVersion) : '',
    latestVersion: formatVersion(policyRead.snapshot.latestVersion),
    updateUrl: policyRead.snapshot.updateUrl,
    title,
    message,
    updateButtonLabel: VERSION_POLICY_COPY[localizedLocale].updateButtonLabel,
    laterButtonLabel: VERSION_POLICY_COPY[localizedLocale].laterButtonLabel,
  }

  return NextResponse.json(responseBody, { status: 200 })
}

export async function handleIosClientVersionPolicy(
  request: NextRequest,
): Promise<NextResponse> {
  return handleClientVersionPolicy(request, { platformOverride: 'ios' })
}

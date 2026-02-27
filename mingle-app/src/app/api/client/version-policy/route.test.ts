import { beforeEach, describe, expect, it, vi } from 'vitest'

const appClientVersionCreateMock = vi.fn()
const appClientVersionPolicyFindFirstMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appClientVersion: {
      create: appClientVersionCreateMock,
    },
    appClientVersionPolicy: {
      findFirst: appClientVersionPolicyFindFirstMock,
    },
  },
}))

function makeRequest(version: string, locale?: string): Request {
  return new Request('http://localhost:3000/api/client/version-policy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientVersion: version, clientBuild: '123', locale: locale || 'ko' }),
  })
}

async function loadLegacyRoutePost() {
  vi.resetModules()
  const mod = await import('@/app/api/client/version-policy/route')
  return mod.POST
}

const FORCE_LOCALIZATION_CASES = [
  { locale: 'ko', title: '업데이트 필요', updateButtonLabel: '업데이트', laterButtonLabel: '나중에' },
  { locale: 'en', title: 'Update Required', updateButtonLabel: 'Update', laterButtonLabel: 'Later' },
  { locale: 'ja', title: 'アップデートが必要です', updateButtonLabel: 'アップデート', laterButtonLabel: 'あとで' },
  { locale: 'zh-CN', title: '更新必需', updateButtonLabel: '更新', laterButtonLabel: '稍后' },
  { locale: 'zh-TW', title: '必須更新', updateButtonLabel: '更新', laterButtonLabel: '稍後' },
  { locale: 'fr', title: 'Mise à jour requise', updateButtonLabel: 'Mettre à jour', laterButtonLabel: 'Plus tard' },
  { locale: 'de', title: 'Update erforderlich', updateButtonLabel: 'Aktualisieren', laterButtonLabel: 'Später' },
  { locale: 'es', title: 'Actualización obligatoria', updateButtonLabel: 'Actualizar', laterButtonLabel: 'Más tarde' },
  { locale: 'pt', title: 'Atualização obrigatória', updateButtonLabel: 'Atualizar', laterButtonLabel: 'Mais tarde' },
  { locale: 'it', title: 'Aggiornamento obbligatorio', updateButtonLabel: 'Aggiorna', laterButtonLabel: 'Più tardi' },
  { locale: 'ru', title: 'Требуется обновление', updateButtonLabel: 'Обновить', laterButtonLabel: 'Позже' },
  { locale: 'ar', title: 'التحديث مطلوب', updateButtonLabel: 'تحديث', laterButtonLabel: 'لاحقًا' },
  { locale: 'hi', title: 'अपडेट आवश्यक', updateButtonLabel: 'अपडेट करें', laterButtonLabel: 'बाद में' },
  { locale: 'th', title: 'จำเป็นต้องอัปเดต', updateButtonLabel: 'อัปเดต', laterButtonLabel: 'ภายหลัง' },
  { locale: 'vi', title: 'Cần cập nhật', updateButtonLabel: 'Cập nhật', laterButtonLabel: 'Để sau' },
] as const

describe('/api/client/version-policy route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    appClientVersionCreateMock.mockResolvedValue({ id: 'ver_1' })
    appClientVersionPolicyFindFirstMock.mockResolvedValue({
      minSupportedVersion: '1.0.0',
      recommendedBelowVersion: '1.2.0',
      latestVersion: '1.3.0',
      updateUrl: 'https://apps.apple.com/app/id1234567890',
    })
  })

  it('returns force_update when client version is below supported minimum', async () => {
    const POST = await loadLegacyRoutePost()
    const response = await POST(makeRequest('0.9.9', 'ko') as never)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.action).toBe('force_update')
    expect(json.locale).toBe('ko')
    expect(json.minSupportedVersion).toBe('1.0.0')
    expect(json.latestVersion).toBe('1.3.0')
    expect(json.updateUrl).toBe('https://apps.apple.com/app/id1234567890')
    expect(json.title).toBe('업데이트 필요')
    expect(json.message).toContain('최신 버전으로 업데이트')
    expect(json.updateButtonLabel).toBe('업데이트')
    expect(json.laterButtonLabel).toBe('나중에')
    expect(appClientVersionCreateMock).toHaveBeenCalledWith({
      data: {
        version: '0.9.9',
        major: 0,
        minor: 9,
        patch: 9,
      },
    })
  })

  it('returns recommend_update when client version is supported but below recommended threshold', async () => {
    const POST = await loadLegacyRoutePost()
    const response = await POST(makeRequest('1.1.5') as never)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.action).toBe('recommend_update')
    expect(json.recommendedBelowVersion).toBe('1.2.0')
  })

  it('returns none when client version is already up to date enough', async () => {
    const POST = await loadLegacyRoutePost()
    const response = await POST(makeRequest('1.3.0') as never)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.action).toBe('none')
    expect(json.message).toBe('')
    expect(json.title).toBe('')
  })

  it.each(FORCE_LOCALIZATION_CASES)(
    'returns localized force_update copy for %s',
    async ({ locale, title, updateButtonLabel, laterButtonLabel }) => {
      const POST = await loadLegacyRoutePost()
      const response = await POST(makeRequest('0.9.9', locale) as never)
      const json = await response.json()

      expect(json.action).toBe('force_update')
      expect(json.locale).toBe(locale)
      expect(json.title).toBe(title)
      expect(json.message).toBeTruthy()
      expect(json.updateButtonLabel).toBe(updateButtonLabel)
      expect(json.laterButtonLabel).toBe(laterButtonLabel)
    },
  )

  it('normalizes Chinese locale aliases to zh-CN/zh-TW', async () => {
    const POST = await loadLegacyRoutePost()
    const zhHant = await POST(makeRequest('0.9.9', 'zh-Hant') as never)
    const zhHantJson = await zhHant.json()
    const zhGeneric = await POST(makeRequest('0.9.9', 'zh') as never)
    const zhGenericJson = await zhGeneric.json()

    expect(zhHantJson.locale).toBe('zh-TW')
    expect(zhHantJson.title).toBe('必須更新')
    expect(zhGenericJson.locale).toBe('zh-CN')
    expect(zhGenericJson.title).toBe('更新必需')
  })

  it('returns recommend_update with localized titles and labels', async () => {
    const POST = await loadLegacyRoutePost()
    const response = await POST(makeRequest('1.1.5', 'fr') as never)
    const json = await response.json()

    expect(json.action).toBe('recommend_update')
    expect(json.locale).toBe('fr')
    expect(json.title).toBe('Mise à jour recommandée')
    expect(json.updateButtonLabel).toBe('Mettre à jour')
    expect(json.laterButtonLabel).toBe('Plus tard')
  })

  it('falls back to English when locale is unsupported', async () => {
    const POST = await loadLegacyRoutePost()
    const response = await POST(makeRequest('0.9.9', 'xx-YY') as never)
    const json = await response.json()

    expect(json.locale).toBe('en')
    expect(json.title).toBe('Update Required')
  })

  it('returns force_update when client version format is invalid', async () => {
    const POST = await loadLegacyRoutePost()
    const response = await POST(makeRequest('1.0') as never)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.action).toBe('force_update')
    expect(appClientVersionCreateMock).not.toHaveBeenCalled()
  })

  it('ignores duplicate client version insert errors', async () => {
    appClientVersionCreateMock.mockRejectedValueOnce({ code: 'P2002' })
    const POST = await loadLegacyRoutePost()

    const response = await POST(makeRequest('1.2.3', 'en') as never)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.action).toBe('none')
  })

  it('falls back to default policy when no active policy history exists', async () => {
    appClientVersionPolicyFindFirstMock.mockResolvedValueOnce(null)
    const POST = await loadLegacyRoutePost()

    const response = await POST(makeRequest('1.0.0', 'en') as never)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.action).toBe('none')
    expect(json.minSupportedVersion).toBe('1.0.0')
    expect(json.recommendedBelowVersion).toBe('')
    expect(json.latestVersion).toBe('1.0.0')
    expect(json.updateUrl).toBe('')
  })
})

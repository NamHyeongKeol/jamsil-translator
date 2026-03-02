import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGenerateContent = vi.fn()
const mockGetGenerativeModel = vi.fn(() => ({
  generateContent: mockGenerateContent,
}))
const ensureTrackingContextMock = vi.fn()

vi.mock('@/lib/app-analytics', () => {
  const sanitizeNonNegativeInt = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const floored = Math.floor(value)
      return floored >= 0 ? floored : null
    }
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed)) return null
      return parsed >= 0 ? parsed : null
    }
    return null
  }

  return {
    ensureTrackingContext: ensureTrackingContextMock,
    sanitizeNonNegativeInt,
  }
})

vi.mock('@google/generative-ai', () => {
  class GoogleGenerativeAI {
    getGenerativeModel(config: unknown) {
      return mockGetGenerativeModel(config)
    }
  }

  return {
    GoogleGenerativeAI,
    SchemaType: {
      STRING: 'STRING',
      OBJECT: 'OBJECT',
    },
  }
})

function buildBase64Audio(prefix: 'mpeg' | 'wav' = 'mpeg'): string {
  const bytes = prefix === 'mpeg'
    ? Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00])
    : Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00])
  return bytes.toString('base64')
}

async function importRouteWithEnv() {
  vi.resetModules()
  process.env.GEMINI_API_KEY = 'test-gemini-key'
  process.env.INWORLD_RUNTIME_BASE64_CREDENTIAL = 'ZmFrZTpmYWtl'
  process.env.INWORLD_TTS_DEFAULT_VOICE_ID = 'Ashley'
  process.env.INWORLD_TTS_MODEL_ID = 'inworld-tts-1.5-mini'

  const mod = await import('@/app/api/translate/finalize/route')
  return mod.POST
}

function makeJsonRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/translate/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
  })
}

describe('/api/translate/finalize route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureTrackingContextMock.mockReturnValue({
      sessionKey: 'sess_test',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns translations and inline TTS audio when finalize succeeds', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '{"ko":"안녕하세요"}',
        usageMetadata: {
          promptTokenCount: 11,
          candidatesTokenCount: 22,
          totalTokenCount: 33,
        },
      },
    })

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ voices: [{ voiceId: 'KoVoice' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          audioContent: `data:audio/mpeg;base64,${buildBase64Audio('mpeg')}`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))

    vi.stubGlobal('fetch', fetchMock)
    const POST = await importRouteWithEnv()

    const res = await POST(makeJsonRequest({
      text: 'hello',
      sourceLanguage: 'en',
      targetLanguages: ['ko'],
      tts: {
        enabled: true,
        language: 'ko',
      },
    }) as never)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.translations).toEqual({ ko: '안녕하세요' })
    expect(json.provider).toBe('gemini')
    expect(json.ttsLanguage).toBe('ko')
    expect(json.ttsVoiceId).toBe('KoVoice')
    expect(typeof json.ttsAudioBase64).toBe('string')
    expect(json.ttsAudioMime).toBe('audio/mpeg')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses previous-state fallback when provider returns empty response', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '',
        usageMetadata: {},
      },
    })

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ voices: [{ voiceId: 'KoVoice' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          audioContent: `data:audio/mpeg;base64,${buildBase64Audio('mpeg')}`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))

    vi.stubGlobal('fetch', fetchMock)
    const POST = await importRouteWithEnv()

    const res = await POST(makeJsonRequest({
      text: 'hello',
      sourceLanguage: 'en',
      targetLanguages: ['ko'],
      currentTurnPreviousState: {
        sourceLanguage: 'en',
        sourceText: 'hello',
        translations: {
          ko: '이전 번역',
        },
      },
      tts: {
        enabled: true,
        language: 'ko',
      },
    }) as never)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.usedFallbackFromPreviousState).toBe(true)
    expect(json.translations).toEqual({ ko: '이전 번역' })
    expect(typeof json.ttsAudioBase64).toBe('string')
    expect(json.ttsAudioMime).toBe('audio/mpeg')
  })

  it('returns 400 when text is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const POST = await importRouteWithEnv()

    const res = await POST(makeJsonRequest({
      text: '   ',
      sourceLanguage: 'en',
      targetLanguages: ['ko'],
    }) as never)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json).toEqual({ error: 'text is required' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('supports provider_empty fault mode for e2e fallback checks', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '{"ko":"정상 번역"}',
        usageMetadata: {},
      },
    })

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const POST = await importRouteWithEnv()

    const res = await POST(makeJsonRequest({
      text: 'hello',
      sourceLanguage: 'en',
      targetLanguages: ['ko'],
      __testFaultMode: 'provider_empty',
      currentTurnPreviousState: {
        sourceLanguage: 'en',
        sourceText: 'hello',
        translations: {
          ko: 'fallback-value',
        },
      },
    }, {
      'x-mingle-live-test': '1',
    }) as never)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.usedFallbackFromPreviousState).toBe(true)
    expect(json.translations).toEqual({ ko: 'fallback-value' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('supports target_miss fault mode for e2e fallback checks', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '{"ko":"정상 번역"}',
        usageMetadata: {},
      },
    })

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const POST = await importRouteWithEnv()

    const res = await POST(makeJsonRequest({
      text: 'hello',
      sourceLanguage: 'en',
      targetLanguages: ['ko', 'ja'],
      __testFaultMode: 'target_miss',
      currentTurnPreviousState: {
        sourceLanguage: 'en',
        sourceText: 'hello',
        translations: {
          ko: 'fallback-ko',
          ja: 'fallback-ja',
        },
      },
    }, {
      'x-mingle-live-test': '1',
    }) as never)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.usedFallbackFromPreviousState).toBe(true)
    expect(json.translations).toEqual({
      ko: 'fallback-ko',
      ja: 'fallback-ja',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('builds compact prompt with previous state first and no recent-turns section', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '{"ko":"안녕하세요"}',
        usageMetadata: {},
      },
    })

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const POST = await importRouteWithEnv()

    const res = await POST(makeJsonRequest({
      text: 'hello',
      sourceLanguage: 'en',
      targetLanguages: ['ko'],
      currentTurnPreviousState: {
        sourceLanguage: 'en',
        sourceText: 'hello-before',
        translations: {
          ko: '이전 번역',
        },
      },
      immediatePreviousTurn: {
        sourceLanguage: 'en',
        sourceText: 'just before this',
        translations: {
          ko: '직전 번역',
        },
        ageMs: 3000,
      },
      recentTurns: [
        {
          sourceLanguage: 'en',
          sourceText: 'old recent context should be ignored',
          translations: { ko: '무시됨' },
          ageMs: 2000,
        },
      ],
    }) as never)

    expect(res.status).toBe(200)

    const userPrompt = String(mockGenerateContent.mock.calls[0]?.[0] ?? '')
    const previousStateIndex = userPrompt.indexOf('Previous state of current turn:')
    const immediateIndex = userPrompt.indexOf('Immediate previous turn (~3s ago):')

    expect(previousStateIndex).toBeGreaterThanOrEqual(0)
    expect(immediateIndex).toBeGreaterThanOrEqual(0)
    expect(previousStateIndex).toBeLessThan(immediateIndex)
    expect(userPrompt).not.toContain('Recent turns (last 10s):')
    expect(userPrompt).not.toContain('Context reliability:')
    expect(userPrompt).toContain('  Translations:')
    expect(userPrompt).not.toContain('old recent context should be ignored')

    const modelConfig = mockGetGenerativeModel.mock.calls[0]?.[0] as { systemInstruction?: string }
    expect(modelConfig.systemInstruction).toBe([
      'You are an expert live-conversation translator.',
      'Return ONLY strict JSON with keys exactly matching target language codes.',
      'No explanations, no markdown, no extra keys.',
    ].join('\n'))
  })

  it('omits immediate previous turn when age exceeds 5 seconds', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '{"ko":"안녕하세요"}',
        usageMetadata: {},
      },
    })

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const POST = await importRouteWithEnv()

    const res = await POST(makeJsonRequest({
      text: 'hello',
      sourceLanguage: 'en',
      targetLanguages: ['ko'],
      immediatePreviousTurn: {
        sourceLanguage: 'en',
        sourceText: 'too old turn',
        translations: {
          ko: '오래된 턴',
        },
        ageMs: 6001,
      },
    }) as never)

    expect(res.status).toBe(200)

    const userPrompt = String(mockGenerateContent.mock.calls[0]?.[0] ?? '')
    expect(userPrompt).not.toContain('Immediate previous turn')
  })

  it('omits immediate previous turn when ageMs is missing', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '{"ko":"안녕하세요"}',
        usageMetadata: {},
      },
    })

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const POST = await importRouteWithEnv()

    const res = await POST(makeJsonRequest({
      text: 'hello',
      sourceLanguage: 'en',
      targetLanguages: ['ko'],
      immediatePreviousTurn: {
        sourceLanguage: 'en',
        sourceText: 'turn without age',
        translations: {
          ko: 'age 없는 턴',
        },
      },
    }) as never)

    expect(res.status).toBe(200)

    const userPrompt = String(mockGenerateContent.mock.calls[0]?.[0] ?? '')
    expect(userPrompt).not.toContain('Immediate previous turn')
    expect(userPrompt).not.toContain('turn without age')
  })
})

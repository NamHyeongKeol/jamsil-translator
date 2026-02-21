import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai'
import {
  ensureTrackingContext,
  sanitizeNonNegativeInt,
} from '@/lib/app-analytics'
import {
  buildFallbackTranslationsFromCurrentTurnPreviousState,
  normalizeLang,
  normalizeTargetLanguages,
  parseCurrentTurnPreviousState,
  parseRecentTurns,
  parseTranslations,
  type CurrentTurnPreviousState,
  type RecentTurnContext,
} from './utils'

export const runtime = 'nodejs'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const DEFAULT_MODEL = process.env.DEMO_TRANSLATE_MODEL || 'gemini-2.5-flash-lite'
const INWORLD_API_BASE = 'https://api.inworld.ai'
const DEFAULT_TTS_MODEL_ID = process.env.INWORLD_TTS_MODEL_ID || 'inworld-tts-1.5-mini'
const DEFAULT_TTS_VOICE_ID = process.env.INWORLD_TTS_DEFAULT_VOICE_ID || 'Ashley'
const DEFAULT_TTS_SPEAKING_RATE = Number(process.env.INWORLD_TTS_SPEAKING_RATE || '1.3')
const VOICE_CACHE_TTL_MS = 1000 * 60 * 30

const LANG_NAMES: Record<string, string> = {
  en: 'English', ko: 'Korean', zh: 'Chinese', ja: 'Japanese',
  es: 'Spanish', fr: 'French', de: 'German', ru: 'Russian',
  pt: 'Portuguese', ar: 'Arabic', hi: 'Hindi', vi: 'Vietnamese',
  it: 'Italian', id: 'Indonesian', tr: 'Turkish', pl: 'Polish',
  nl: 'Dutch', sv: 'Swedish', th: 'Thai', ms: 'Malay',
}

interface InworldVoiceItem {
  id?: string
  voiceId?: string
  name?: string
}

type TranslationUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

type TranslationEngineResult = {
  translations: Record<string, string>
  provider: 'gemini'
  model: string
  usage?: TranslationUsage
}

type FinalizeTestFaultMode = 'provider_empty' | 'target_miss' | 'provider_error'

type TranslateContext = {
  text: string
  sourceLanguage: string
  targetLanguages: string[]
  recentTurns: RecentTurnContext[]
  currentTurnPreviousState: CurrentTurnPreviousState | null
}

type GeminiUsageMetadata = {
  promptTokenCount?: unknown
  candidatesTokenCount?: unknown
  totalTokenCount?: unknown
}

type GeminiResponseLike = {
  text: () => string
  usageMetadata?: GeminiUsageMetadata
  promptFeedback?: unknown
  candidates?: Array<{
    finishReason?: unknown
    safetyRatings?: unknown
  }>
}

const voiceCache = new Map<string, { voiceId: string, expiresAt: number }>()

function parseFinalizeTestFaultMode(value: unknown): FinalizeTestFaultMode | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'provider_empty') return normalized
  if (normalized === 'target_miss') return normalized
  if (normalized === 'provider_error') return normalized
  return null
}

function formatRecentTurnsForPrompt(turns: RecentTurnContext[]): string {
  if (turns.length === 0) return 'None'

  return turns.map((turn, index) => {
    const translationLines = Object.entries(turn.translations)
      .map(([language, translatedText]) => `    - ${language}: "${translatedText}"`)
      .join('\n')
    const ageSuffix = typeof turn.ageMs === 'number'
      ? ` (~${Math.round(turn.ageMs / 1000)}s ago)`
      : ''

    return [
      `Turn ${index + 1}${ageSuffix}`,
      `  Original [${turn.sourceLanguage}]: "${turn.sourceText}"`,
      '  Prior translations:',
      translationLines || '    - (no translation captured)',
    ].join('\n')
  }).join('\n\n')
}

function formatCurrentTurnPreviousStateForPrompt(state: CurrentTurnPreviousState | null): string {
  if (!state) return 'None'
  const translationLines = Object.entries(state.translations)
    .map(([language, translatedText]) => `    - ${language}: "${translatedText}"`)
    .join('\n')

  return [
    `  Source [${state.sourceLanguage}]: "${state.sourceText}"`,
    '  Prior translations from same turn:',
    translationLines || '    - (none)',
  ].join('\n')
}

function buildPrompt(ctx: TranslateContext): { systemPrompt: string, userPrompt: string } {
  const recentTurns = formatRecentTurnsForPrompt(ctx.recentTurns)
  const currentTurnPreviousState = formatCurrentTurnPreviousStateForPrompt(ctx.currentTurnPreviousState)
  const targetLangCodes = ctx.targetLanguages.join(', ')
  return {
    systemPrompt: 'You are a translator. Translate the current turn into each requested target language.',
    userPrompt: [
      'Current turn:',
      `source=${ctx.sourceLanguage}`,
      `targets=${targetLangCodes}`,
      `text="${ctx.text}"`,
      '',
      'Recent turns (last 10s):',
      recentTurns,
      '',
      'Previous state of current turn:',
      currentTurnPreviousState,
    ].join('\n'),
  }
}

function normalizeUsage(raw: {
  prompt?: unknown
  completion?: unknown
  total?: unknown
}): TranslationUsage | undefined {
  const promptTokens = sanitizeNonNegativeInt(raw.prompt)
  const completionTokens = sanitizeNonNegativeInt(raw.completion)
  const totalTokens = sanitizeNonNegativeInt(raw.total)

  if (promptTokens === null && completionTokens === null && totalTokens === null) {
    return undefined
  }

  const usage: TranslationUsage = {}
  if (promptTokens !== null) usage.promptTokens = promptTokens
  if (completionTokens !== null) usage.completionTokens = completionTokens
  if (totalTokens !== null) usage.totalTokens = totalTokens
  return usage
}

function buildGeminiResponseSchema(targetLanguages: string[]): ResponseSchema {
  const properties: Record<string, ResponseSchema> = {}
  for (const language of targetLanguages) {
    properties[language] = {
      type: SchemaType.STRING,
      description: `Translated text in ${LANG_NAMES[language] || language}.`,
    }
  }

  return {
    type: SchemaType.OBJECT,
    properties,
    required: [...targetLanguages],
  }
}

async function translateWithGemini(ctx: TranslateContext): Promise<TranslationEngineResult | null> {
  if (!GEMINI_API_KEY) return null

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const { systemPrompt, userPrompt } = buildPrompt(ctx)
  const responseSchema = buildGeminiResponseSchema(ctx.targetLanguages)
  const model = genAI.getGenerativeModel({
    model: DEFAULT_MODEL,
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
    },
  })

  const result = await model.generateContent(userPrompt)
  const response = result.response as unknown as GeminiResponseLike
  const rawContent = response.text() || ''
  // console.info([
  //   '[translate/finalize] gemini_raw_response',
  //   rawContent,
  // ].join('\n'))
  const content = rawContent.trim()
  const usageMetadata = response.usageMetadata
  const promptTokens = sanitizeNonNegativeInt(usageMetadata?.promptTokenCount)
  const completionTokens = sanitizeNonNegativeInt(usageMetadata?.candidatesTokenCount)
  const totalTokens = sanitizeNonNegativeInt(usageMetadata?.totalTokenCount)
  const candidateMeta = Array.isArray(response.candidates)
    ? response.candidates.map((candidate, index) => ({
      index,
      finishReason: candidate.finishReason ?? null,
      safetyRatings: candidate.safetyRatings ?? null,
    }))
    : []

  if (!content) {
    console.error('[translate/finalize] gemini_empty_text', {
      sourceLanguage: ctx.sourceLanguage,
      targetLanguages: ctx.targetLanguages,
      textPreview: ctx.text.slice(0, 120),
      recentTurnsCount: ctx.recentTurns.length,
      promptFeedback: response.promptFeedback ?? null,
      candidates: candidateMeta,
      usage: {
        input_tokens: promptTokens,
        output_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    })
    return null
  }

  const translations = parseTranslations(content)
  if (Object.keys(translations).length === 0) {
    console.error('[translate/finalize] gemini_unparseable_json', {
      sourceLanguage: ctx.sourceLanguage,
      targetLanguages: ctx.targetLanguages,
      textPreview: ctx.text.slice(0, 120),
      recentTurnsCount: ctx.recentTurns.length,
      promptFeedback: response.promptFeedback ?? null,
      candidates: candidateMeta,
      responseTextLength: content.length,
      responseTextPreview: content.slice(0, 2000),
      usage: {
        input_tokens: promptTokens,
        output_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    })
    return null
  }

  return {
    translations,
    provider: 'gemini',
    model: DEFAULT_MODEL,
    usage: normalizeUsage({
      prompt: promptTokens,
      completion: completionTokens,
      total: totalTokens,
    }),
  }
}

function getAuthHeaderValue(): string | null {
  const jwtToken = process.env.INWORLD_JWT?.trim()
  if (jwtToken) {
    if (jwtToken.startsWith('Bearer ')) return jwtToken
    return `Bearer ${jwtToken}`
  }

  const basicCredential = (
    process.env.INWORLD_BASIC
    || process.env.INWORLD_BASIC_KEY
    || process.env.INWORLD_RUNTIME_BASE64_CREDENTIAL
    || process.env.INWORLD_BASIC_CREDENTIAL
    || ''
  ).trim()
  if (basicCredential) {
    if (basicCredential.startsWith('Basic ')) return basicCredential
    return `Basic ${basicCredential}`
  }

  const apiKey = process.env.INWORLD_API_KEY?.trim()
  const apiSecret = process.env.INWORLD_API_SECRET?.trim()
  if (apiKey && !apiSecret) {
    if (apiKey.startsWith('Basic ')) return apiKey
    return `Basic ${apiKey}`
  }
  if (apiKey && apiSecret) {
    const credential = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')
    return `Basic ${credential}`
  }
  return null
}

function pickVoiceId(item: InworldVoiceItem): string | null {
  if (item.voiceId && typeof item.voiceId === 'string') return item.voiceId
  if (item.id && typeof item.id === 'string') return item.id
  if (item.name && typeof item.name === 'string') return item.name
  return null
}

async function resolveVoiceId(authHeader: string, language: string | null): Promise<string> {
  if (!language) return DEFAULT_TTS_VOICE_ID

  const now = Date.now()
  const cached = voiceCache.get(language)
  if (cached && cached.expiresAt > now) {
    return cached.voiceId
  }

  try {
    const url = `${INWORLD_API_BASE}/tts/v1/voices?filter=${encodeURIComponent(`language=${language}`)}`
    const response = await fetch(url, {
      headers: { Authorization: authHeader },
      cache: 'no-store',
    })
    if (!response.ok) {
      return DEFAULT_TTS_VOICE_ID
    }

    const data = await response.json() as { voices?: InworldVoiceItem[], items?: InworldVoiceItem[] }
    const voices = Array.isArray(data.voices) ? data.voices : (Array.isArray(data.items) ? data.items : [])
    const resolved = voices
      .map(pickVoiceId)
      .find((id): id is string => Boolean(id))
    const voiceId = resolved || DEFAULT_TTS_VOICE_ID
    voiceCache.set(language, { voiceId, expiresAt: now + VOICE_CACHE_TTL_MS })
    return voiceId
  } catch {
    return DEFAULT_TTS_VOICE_ID
  }
}

function decodeAudioContent(audioContent?: string): Buffer | null {
  if (!audioContent || typeof audioContent !== 'string') return null
  const cleaned = audioContent.replace(/^data:audio\/[a-zA-Z0-9.+-]+;base64,/, '').trim()
  if (!cleaned) return null
  try {
    return Buffer.from(cleaned, 'base64')
  } catch {
    return null
  }
}

function detectAudioMime(audioBuffer: Buffer): string {
  if (audioBuffer.length < 4) return 'application/octet-stream'
  const b = audioBuffer
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'audio/wav'
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg'
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg'
  return 'application/octet-stream'
}

async function synthesizeTtsInline(args: {
  text: string
  language: string
  requestedVoiceId?: string
}): Promise<{ audioBase64: string, audioMime: string, voiceId: string } | null> {
  if (!args.text.trim() || !args.language.trim()) return null
  const authHeader = getAuthHeaderValue()
  if (!authHeader) return null

  const resolvedVoiceId = args.requestedVoiceId?.trim() || await resolveVoiceId(authHeader, args.language)
  try {
    const response = await fetch(`${INWORLD_API_BASE}/tts/v1/voice`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: args.text,
        voiceId: resolvedVoiceId,
        modelId: DEFAULT_TTS_MODEL_ID,
        audioConfig: {
          speakingRate: Number.isFinite(DEFAULT_TTS_SPEAKING_RATE) && DEFAULT_TTS_SPEAKING_RATE > 0
            ? DEFAULT_TTS_SPEAKING_RATE
            : 1.3,
        },
      }),
      cache: 'no-store',
    })

    if (!response.ok) return null
    const data = await response.json() as { audioContent?: string }
    const audioBuffer = decodeAudioContent(data.audioContent)
    if (!audioBuffer) return null

    return {
      audioBase64: audioBuffer.toString('base64'),
      audioMime: detectAudioMime(audioBuffer),
      voiceId: resolvedVoiceId,
    }
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch((): Record<string, unknown> => ({}))
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const sourceLanguageRaw = normalizeLang(typeof body.sourceLanguage === 'string' ? body.sourceLanguage : '')
  const sourceLanguage = sourceLanguageRaw || 'unknown'
  const targetLanguagesRaw: unknown[] = Array.isArray(body.targetLanguages) ? body.targetLanguages : []
  const ttsPayload = (typeof body.tts === 'object' && body.tts !== null) ? body.tts as Record<string, unknown> : null
  const ttsLanguage = normalizeLang(typeof ttsPayload?.language === 'string' ? ttsPayload.language : '')
  const ttsVoiceId = typeof ttsPayload?.voiceId === 'string' ? ttsPayload.voiceId.trim() : ''
  const enableTts = ttsPayload?.enabled === true
  const currentTurnPreviousState = parseCurrentTurnPreviousState(body.currentTurnPreviousState)
  const sessionKeyHint = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : null
  const isLocalLiveTestRequest = request.headers.get('x-mingle-live-test') === '1'
  const allowTestFaults = process.env.NODE_ENV !== 'production' && isLocalLiveTestRequest
  const testFaultMode = allowTestFaults ? parseFinalizeTestFaultMode(body.__testFaultMode) : null

  if (!GEMINI_API_KEY) {
    const response = NextResponse.json({ error: 'No translation API key configured' }, { status: 500 })
    ensureTrackingContext(request, response, { sessionKeyHint })
    return response
  }

  const targetLanguages = normalizeTargetLanguages(targetLanguagesRaw, sourceLanguage)

  if (!text) {
    const response = NextResponse.json({ error: 'text is required' }, { status: 400 })
    ensureTrackingContext(request, response, { sessionKeyHint })
    return response
  }

  if (targetLanguages.length === 0) {
    const response = NextResponse.json({ translations: {} })
    ensureTrackingContext(request, response, { sessionKeyHint })
    return response
  }

  const recentTurns = parseRecentTurns(body.recentTurns)
  const ctx: TranslateContext = {
    text,
    sourceLanguage,
    targetLanguages,
    recentTurns,
    currentTurnPreviousState,
  }
  // const { systemPrompt, userPrompt } = buildPrompt(ctx)
  // console.info([
  //   '[translate/finalize] input_prompt',
  //   `sourceLanguage=${sourceLanguage}`,
  //   `targetLanguages=${targetLanguages.join(',')}`,
  //   '--- systemPrompt ---',
  //   systemPrompt,
  //   '--- userPrompt ---',
  //   userPrompt,
  // ].join('\n'))

  try {
    const fallbackTranslations = buildFallbackTranslationsFromCurrentTurnPreviousState(
      currentTurnPreviousState,
      targetLanguages,
    )
    const buildResponseWithOptionalTts = async (
      translations: Record<string, string>,
      meta: { provider: string, model: string, usedFallbackFromPreviousState?: boolean },
    ): Promise<NextResponse> => {
      const responsePayload: Record<string, unknown> = {
        translations,
        provider: meta.provider,
        model: meta.model,
      }
      if (meta.usedFallbackFromPreviousState) {
        responsePayload.usedFallbackFromPreviousState = true
      }

      if (enableTts && ttsLanguage && targetLanguages.includes(ttsLanguage)) {
        const ttsText = (translations[ttsLanguage] || '').trim()
        if (ttsText) {
          const ttsResult = await synthesizeTtsInline({
            text: ttsText,
            language: ttsLanguage,
            requestedVoiceId: ttsVoiceId,
          })

          if (ttsResult) {
            responsePayload.ttsLanguage = ttsLanguage
            responsePayload.ttsAudioBase64 = ttsResult.audioBase64
            responsePayload.ttsAudioMime = ttsResult.audioMime
            responsePayload.ttsVoiceId = ttsResult.voiceId
          }
        }
      }

      const response = NextResponse.json(responsePayload)
      ensureTrackingContext(request, response, { sessionKeyHint })
      return response
    }

    let selectedResult: TranslationEngineResult | null = null
    let geminiRequestFailed = false
    try {
      if (testFaultMode === 'provider_empty') {
        selectedResult = null
      } else if (testFaultMode === 'target_miss') {
        selectedResult = {
          provider: 'gemini',
          model: DEFAULT_MODEL,
          translations: {
            zz: 'forced_target_miss',
          },
        }
      } else if (testFaultMode === 'provider_error') {
        throw new Error('forced_provider_error_for_e2e')
      } else {
        selectedResult = await translateWithGemini(ctx)
      }
    } catch (error) {
      geminiRequestFailed = true
      const errorPayload = error instanceof Error
        ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
        : { raw: String(error) }
      console.error('[translate/finalize] provider_error', {
        provider: 'gemini',
        sourceLanguage,
        targetLanguages,
        error: errorPayload,
      })
    }

    if (!selectedResult || Object.keys(selectedResult.translations).length === 0) {
      console.error('[translate/finalize] provider_empty_response', {
        provider: 'gemini',
        sourceLanguage,
        targetLanguages,
        textPreview: text.slice(0, 120),
        recentTurnsCount: recentTurns.length,
      })
      if (!geminiRequestFailed && Object.keys(fallbackTranslations).length > 0) {
        console.warn('[translate/finalize] fallback_from_current_turn_previous_state', {
          sourceLanguage,
          targetLanguages,
          fallbackLanguages: Object.keys(fallbackTranslations),
          reason: 'provider_empty_response',
        })
        return await buildResponseWithOptionalTts(fallbackTranslations, {
          provider: 'gemini',
          model: DEFAULT_MODEL,
          usedFallbackFromPreviousState: true,
        })
      }
      const response = NextResponse.json({ error: 'empty_translation_response' }, { status: 502 })
      ensureTrackingContext(request, response, { sessionKeyHint })
      return response
    }

    // console.info([
    //   '[translate/finalize] response_usage',
    //   `provider=${selectedResult.provider}`,
    //   `model=${selectedResult.model}`,
    //   `input_tokens=${selectedResult.usage?.promptTokens ?? 'unknown'}`,
    //   `output_tokens=${selectedResult.usage?.completionTokens ?? 'unknown'}`,
    //   `total_tokens=${selectedResult.usage?.totalTokens ?? 'unknown'}`,
    // ].join(' '))

    const translations: Record<string, string> = {}
    for (const lang of targetLanguages) {
      if (selectedResult.translations[lang]) {
        translations[lang] = selectedResult.translations[lang]
      }
    }

    if (Object.keys(translations).length === 0) {
      console.error('[translate/finalize] target_language_miss', {
        provider: selectedResult.provider,
        sourceLanguage,
        targetLanguages,
        returnedLanguages: Object.keys(selectedResult.translations),
        textPreview: text.slice(0, 120),
      })
      if (Object.keys(fallbackTranslations).length > 0) {
        console.warn('[translate/finalize] fallback_from_current_turn_previous_state', {
          sourceLanguage,
          targetLanguages,
          fallbackLanguages: Object.keys(fallbackTranslations),
          reason: 'target_language_miss',
        })
        return await buildResponseWithOptionalTts(fallbackTranslations, {
          provider: selectedResult.provider,
          model: selectedResult.model,
          usedFallbackFromPreviousState: true,
        })
      }
      const response = NextResponse.json({ error: 'empty_translation_response' }, { status: 502 })
      ensureTrackingContext(request, response, { sessionKeyHint })
      return response
    }

    return await buildResponseWithOptionalTts(translations, {
      provider: selectedResult.provider,
      model: selectedResult.model,
    })
  } catch (error) {
    console.error('Finalize translation route error:', error)
    const response = NextResponse.json({ error: 'finalize_translation_failed' }, { status: 500 })
    ensureTrackingContext(request, response, { sessionKeyHint })
    return response
  }
}

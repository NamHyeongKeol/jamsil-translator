import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import {
  ensureTrackingContext,
  sanitizeNonNegativeInt,
} from '@/lib/app-analytics'

export const runtime = 'nodejs'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || ''
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
  provider: 'gemini' | 'openai' | 'claude'
  model: string
  usage?: TranslationUsage
}

type RecentTurnContext = {
  sourceLanguage: string
  sourceText: string
  translations: Record<string, string>
  ageMs?: number
}

type TranslateContext = {
  text: string
  sourceLanguage: string
  targetLanguages: string[]
  recentTurns: RecentTurnContext[]
}

const voiceCache = new Map<string, { voiceId: string, expiresAt: number }>()

function normalizeLang(input: string): string {
  return input.trim().replace('_', '-').toLowerCase().split('-')[0] || ''
}

function parseTranslations(raw: string): Record<string, string> {
  const base = raw.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')
  let parsed: Record<string, unknown> | null = null

  try {
    parsed = JSON.parse(base) as Record<string, unknown>
  } catch {
    const start = base.indexOf('{')
    const end = base.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const sliced = base.slice(start, end + 1)
      try {
        parsed = JSON.parse(sliced) as Record<string, unknown>
      } catch {
        parsed = null
      }
    }
  }

  if (!parsed) return {}
  const output: Record<string, string> = {}

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') continue
    const cleaned = value.replace(/<\/?end>/gi, '').trim()
    if (!cleaned) continue
    output[key] = cleaned
  }
  return output
}

function parseRecentTurns(raw: unknown): RecentTurnContext[] {
  if (!Array.isArray(raw)) return []
  const items = raw.slice(-12)
  const turns: RecentTurnContext[] = []

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const payload = item as Record<string, unknown>
    const sourceText = typeof payload.sourceText === 'string'
      ? payload.sourceText.replace(/<\/?end>/gi, '').trim()
      : ''
    if (!sourceText) continue
    const sourceLanguage = normalizeLang(typeof payload.sourceLanguage === 'string' ? payload.sourceLanguage : '') || 'unknown'

    const translationsPayload = (
      typeof payload.translations === 'object'
      && payload.translations !== null
    ) ? payload.translations as Record<string, unknown> : {}
    const translations: Record<string, string> = {}
    for (const [language, translatedText] of Object.entries(translationsPayload)) {
      if (typeof translatedText !== 'string') continue
      const normalizedLanguage = normalizeLang(language)
      if (!normalizedLanguage) continue
      const cleaned = translatedText.replace(/<\/?end>/gi, '').trim()
      if (!cleaned) continue
      translations[normalizedLanguage] = cleaned
    }

    const ageMs = sanitizeNonNegativeInt(payload.ageMs)
    turns.push({
      sourceLanguage,
      sourceText,
      translations,
      ...(ageMs !== null ? { ageMs } : {}),
    })
  }

  return turns
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

function buildPrompt(ctx: TranslateContext): { systemPrompt: string, userPrompt: string } {
  const langList = ctx.targetLanguages.map((lang) => `${lang} (${LANG_NAMES[lang] || lang})`).join(', ')
  const recentTurns = formatRecentTurnsForPrompt(ctx.recentTurns)
  return {
    systemPrompt: [
      'You are a professional live conversation translator.',
      'Translate the current turn naturally and accurately.',
      'Use recent turns and their prior translations as context to improve phrasing, tone, and disambiguation.',
      'Keep the translation grounded in the current turn while reflecting conversation flow naturally.',
      'Respond ONLY with strict JSON mapping language codes to translated strings. No markdown, no explanations.',
    ].join(' '),
    userPrompt: [
      'Current turn to translate:',
      `- Source language: ${ctx.sourceLanguage}`,
      `- Target languages: ${langList}`,
      `- Text: "${ctx.text}"`,
      '',
      'Recent turns from the last 10 seconds (use these to make the current-turn translation more natural):',
      recentTurns,
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

async function translateWithGemini(ctx: TranslateContext): Promise<TranslationEngineResult | null> {
  if (!GEMINI_API_KEY) return null

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const { systemPrompt, userPrompt } = buildPrompt(ctx)
  const model = genAI.getGenerativeModel({
    model: DEFAULT_MODEL,
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: 'application/json',
    },
  })

  const result = await model.generateContent(userPrompt)
  const content = result.response.text()?.trim() || ''
  if (!content) return null

  const translations = parseTranslations(content)
  if (Object.keys(translations).length === 0) return null

  const usageMetadata = (result.response as unknown as {
    usageMetadata?: {
      promptTokenCount?: unknown
      candidatesTokenCount?: unknown
      totalTokenCount?: unknown
    }
  }).usageMetadata

  return {
    translations,
    provider: 'gemini',
    model: DEFAULT_MODEL,
    usage: normalizeUsage({
      prompt: usageMetadata?.promptTokenCount,
      completion: usageMetadata?.candidatesTokenCount,
      total: usageMetadata?.totalTokenCount,
    }),
  }
}

async function translateWithOpenAI(ctx: TranslateContext): Promise<TranslationEngineResult | null> {
  if (!OPENAI_API_KEY) return null

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY })
  const { systemPrompt, userPrompt } = buildPrompt(ctx)

  const response = await openai.chat.completions.create({
    model: 'gpt-5-nano',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.1,
  })

  const content = response.choices[0]?.message?.content?.trim() || ''
  if (!content) return null

  const translations = parseTranslations(content)
  if (Object.keys(translations).length === 0) return null

  return {
    translations,
    provider: 'openai',
    model: 'gpt-5-nano',
    usage: normalizeUsage({
      prompt: response.usage?.prompt_tokens,
      completion: response.usage?.completion_tokens,
      total: response.usage?.total_tokens,
    }),
  }
}

async function translateWithClaude(ctx: TranslateContext): Promise<TranslationEngineResult | null> {
  if (!CLAUDE_API_KEY) return null

  const anthropic = new Anthropic({ apiKey: CLAUDE_API_KEY })
  const { systemPrompt, userPrompt } = buildPrompt(ctx)

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const block = response.content[0]
  if (!block || block.type !== 'text') return null

  const content = block.text.trim()
  if (!content) return null

  const translations = parseTranslations(content)
  if (Object.keys(translations).length === 0) return null

  return {
    translations,
    provider: 'claude',
    model: 'claude-haiku-4-5-20251001',
    usage: normalizeUsage({
      prompt: response.usage?.input_tokens,
      completion: response.usage?.output_tokens,
      total: (
        sanitizeNonNegativeInt(response.usage?.input_tokens) ?? 0
      ) + (
        sanitizeNonNegativeInt(response.usage?.output_tokens) ?? 0
      ),
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
  const sessionKeyHint = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : null

  if (!GEMINI_API_KEY && !OPENAI_API_KEY && !CLAUDE_API_KEY) {
    const response = NextResponse.json({ error: 'No translation API key configured' }, { status: 500 })
    ensureTrackingContext(request, response, { sessionKeyHint })
    return response
  }

  const targetLanguagesSet = new Set<string>()
  for (const item of targetLanguagesRaw) {
    if (typeof item !== 'string') continue
    const normalized = normalizeLang(item)
    if (!normalized || normalized === sourceLanguage) continue
    targetLanguagesSet.add(normalized)
  }
  const targetLanguages = Array.from(targetLanguagesSet)

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
  }
  const { systemPrompt, userPrompt } = buildPrompt(ctx)
  console.info([
    '[translate/finalize] input_prompt',
    `sourceLanguage=${sourceLanguage}`,
    `targetLanguages=${targetLanguages.join(',')}`,
    '--- systemPrompt ---',
    systemPrompt,
    '--- userPrompt ---',
    userPrompt,
  ].join('\n'))

  try {
    let selectedResult: TranslationEngineResult | null = null
    const translators = [translateWithGemini, translateWithOpenAI, translateWithClaude]

    for (const translator of translators) {
      try {
        const translated = await translator(ctx)
        if (translated && Object.keys(translated.translations).length > 0) {
          selectedResult = translated
          break
        }
      } catch {
        // Continue to next provider.
      }
    }

    if (!selectedResult) {
      const response = NextResponse.json({ error: 'empty_translation_response' }, { status: 502 })
      ensureTrackingContext(request, response, { sessionKeyHint })
      return response
    }

    console.info([
      '[translate/finalize] response_usage',
      `provider=${selectedResult.provider}`,
      `model=${selectedResult.model}`,
      `input_tokens=${selectedResult.usage?.promptTokens ?? 'unknown'}`,
      `output_tokens=${selectedResult.usage?.completionTokens ?? 'unknown'}`,
      `total_tokens=${selectedResult.usage?.totalTokens ?? 'unknown'}`,
    ].join(' '))

    const translations: Record<string, string> = {}
    for (const lang of targetLanguages) {
      if (selectedResult.translations[lang]) {
        translations[lang] = selectedResult.translations[lang]
      }
    }

    if (Object.keys(translations).length === 0) {
      const response = NextResponse.json({ error: 'empty_translation_response' }, { status: 502 })
      ensureTrackingContext(request, response, { sessionKeyHint })
      return response
    }

    const responsePayload: Record<string, unknown> = {
      translations,
      provider: selectedResult.provider,
      model: selectedResult.model,
    }

    if (ttsLanguage && targetLanguages.includes(ttsLanguage)) {
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
  } catch (error) {
    console.error('Finalize translation route error:', error)
    const response = NextResponse.json({ error: 'finalize_translation_failed' }, { status: 500 })
    ensureTrackingContext(request, response, { sessionKeyHint })
    return response
  }
}

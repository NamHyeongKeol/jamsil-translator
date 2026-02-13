import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || ''
const DEFAULT_MODEL = process.env.DEMO_TRANSLATE_MODEL || 'gemini-2.5-flash-lite'

const LANG_NAMES: Record<string, string> = {
  en: 'English', ko: 'Korean', zh: 'Chinese', ja: 'Japanese',
  es: 'Spanish', fr: 'French', de: 'German', ru: 'Russian',
  pt: 'Portuguese', ar: 'Arabic', hi: 'Hindi', vi: 'Vietnamese',
  it: 'Italian', id: 'Indonesian', tr: 'Turkish', pl: 'Polish',
  nl: 'Dutch', sv: 'Swedish', th: 'Thai', ms: 'Malay',
}

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

type TranslateContext = {
  text: string
  targetLanguages: string[]
}

function buildPrompt(ctx: TranslateContext): { systemPrompt: string, userPrompt: string } {
  const langList = ctx.targetLanguages.map((lang) => `${lang} (${LANG_NAMES[lang] || lang})`).join(', ')
  return {
    systemPrompt: 'You are a translator. Respond ONLY with JSON mapping language codes to translations. No extra text.',
    userPrompt: `Translate to ${langList}:\n"${ctx.text}"`,
  }
}

async function translateWithGemini(ctx: TranslateContext): Promise<Record<string, string>> {
  if (!GEMINI_API_KEY) return {}
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
  if (!content) return {}
  return parseTranslations(content)
}

async function translateWithOpenAI(ctx: TranslateContext): Promise<Record<string, string>> {
  if (!OPENAI_API_KEY) return {}
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
  if (!content) return {}
  return parseTranslations(content)
}

async function translateWithClaude(ctx: TranslateContext): Promise<Record<string, string>> {
  if (!CLAUDE_API_KEY) return {}
  const anthropic = new Anthropic({ apiKey: CLAUDE_API_KEY })
  const { systemPrompt, userPrompt } = buildPrompt(ctx)
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const block = response.content[0]
  if (!block || block.type !== 'text') return {}
  const content = block.text.trim()
  if (!content) return {}
  return parseTranslations(content)
}

// ===== Inworld TTS integration (optional, piggybacks on finalize call) =====
const INWORLD_API_BASE = 'https://api.inworld.ai'
const INWORLD_TTS_MODEL_ID = process.env.INWORLD_TTS_MODEL_ID || 'inworld-tts-1.5-mini'
const INWORLD_TTS_DEFAULT_VOICE_ID = process.env.INWORLD_TTS_DEFAULT_VOICE_ID || 'Ashley'
const INWORLD_TTS_SPEAKING_RATE = Number(process.env.INWORLD_TTS_SPEAKING_RATE || '1.2')
const TTS_VOICE_CACHE = new Map<string, { voiceId: string, expiresAt: number }>()

function getInworldAuth(): string | null {
  const jwt = process.env.INWORLD_JWT?.trim()
  if (jwt) return jwt.startsWith('Bearer ') ? jwt : `Bearer ${jwt}`
  const basic = (process.env.INWORLD_BASIC || process.env.INWORLD_BASIC_KEY || process.env.INWORLD_RUNTIME_BASE64_CREDENTIAL || process.env.INWORLD_BASIC_CREDENTIAL || '').trim()
  if (basic) return basic.startsWith('Basic ') ? basic : `Basic ${basic}`
  const apiKey = process.env.INWORLD_API_KEY?.trim()
  const apiSecret = process.env.INWORLD_API_SECRET?.trim()
  if (apiKey && !apiSecret) return apiKey.startsWith('Basic ') ? apiKey : `Basic ${apiKey}`
  if (apiKey && apiSecret) return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`
  return null
}

async function resolveVoice(auth: string, lang: string): Promise<string> {
  const now = Date.now()
  const cached = TTS_VOICE_CACHE.get(lang)
  if (cached && cached.expiresAt > now) return cached.voiceId
  try {
    const res = await fetch(`${INWORLD_API_BASE}/tts/v1/voices?filter=${encodeURIComponent(`language=${lang}`)}`, {
      headers: { Authorization: auth }, cache: 'no-store',
    })
    if (!res.ok) return INWORLD_TTS_DEFAULT_VOICE_ID
    const data = await res.json() as { voices?: { voiceId?: string, id?: string, name?: string }[] }
    const voices = Array.isArray(data.voices) ? data.voices : []
    const voiceId = voices.map(v => v.voiceId || v.id || v.name || '').find(Boolean) || INWORLD_TTS_DEFAULT_VOICE_ID
    TTS_VOICE_CACHE.set(lang, { voiceId, expiresAt: now + 30 * 60 * 1000 })
    return voiceId
  } catch { return INWORLD_TTS_DEFAULT_VOICE_ID }
}

async function synthesizeTts(text: string, language: string): Promise<{ audioBase64: string } | null> {
  const auth = getInworldAuth()
  if (!auth) return null
  const voiceId = await resolveVoice(auth, language)
  try {
    const res = await fetch(`${INWORLD_API_BASE}/tts/v1/voice`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text, voiceId, modelId: INWORLD_TTS_MODEL_ID,
        audioConfig: { speakingRate: INWORLD_TTS_SPEAKING_RATE > 0 ? INWORLD_TTS_SPEAKING_RATE : 1.2 },
      }),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json() as { audioContent?: string }
    if (!data.audioContent) return null
    const cleaned = data.audioContent.replace(/^data:audio\/[a-zA-Z0-9.+-]+;base64,/, '').trim()
    if (!cleaned) return null
    const buf = Buffer.from(cleaned, 'base64')
    let mime = 'application/octet-stream'
    if (buf.length >= 4) {
      if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) mime = 'audio/wav'
      else if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) mime = 'audio/mpeg'
      else if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) mime = 'audio/mpeg'
    }
    return { audioBase64: `data:${mime};base64,${cleaned}` }
  } catch { return null }
}

export async function POST(request: NextRequest) {
  if (!GEMINI_API_KEY && !OPENAI_API_KEY && !CLAUDE_API_KEY) {
    return NextResponse.json({ error: 'No translation API key configured' }, { status: 500 })
  }

  const body = await request.json().catch((): Record<string, unknown> => ({}))
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const sourceLanguage = normalizeLang(typeof body.sourceLanguage === 'string' ? body.sourceLanguage : '')
  const targetLanguagesRaw: unknown[] = Array.isArray(body.targetLanguages) ? body.targetLanguages : []

  // Optional TTS: { language: string }
  const ttsLang = body.tts && typeof (body.tts as Record<string, unknown>).language === 'string'
    ? normalizeLang((body.tts as Record<string, unknown>).language as string)
    : null

  const targetLanguagesSet = new Set<string>()
  for (const item of targetLanguagesRaw) {
    if (typeof item !== 'string') continue
    const normalized = normalizeLang(item)
    if (!normalized || normalized === sourceLanguage) continue
    targetLanguagesSet.add(normalized)
  }
  const targetLanguages = Array.from(targetLanguagesSet)

  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }
  if (targetLanguages.length === 0) {
    return NextResponse.json({ translations: {} })
  }

  const ctx: TranslateContext = { text, targetLanguages }

  try {
    let allTranslations: Record<string, string> = {}
    const translators = [translateWithGemini, translateWithOpenAI, translateWithClaude]
    for (const translator of translators) {
      try {
        allTranslations = await translator(ctx)
      } catch {
        allTranslations = {}
      }
      if (Object.keys(allTranslations).length > 0) break
    }

    const translations: Record<string, string> = {}
    for (const lang of targetLanguages) {
      if (allTranslations[lang]) translations[lang] = allTranslations[lang]
    }

    if (Object.keys(translations).length === 0) {
      return NextResponse.json({ error: 'empty_translation_response' }, { status: 502 })
    }

    // If TTS requested and translated text available, synthesize in same request.
    let ttsAudio: string | undefined
    let ttsLanguage: string | undefined
    if (ttsLang && translations[ttsLang]) {
      const result = await synthesizeTts(translations[ttsLang], ttsLang)
      if (result) {
        ttsAudio = result.audioBase64
        ttsLanguage = ttsLang
      }
    }

    return NextResponse.json({ translations, ...(ttsAudio ? { ttsAudio, ttsLanguage } : {}) })
  } catch (error) {
    console.error('Finalize translation route error:', error)
    return NextResponse.json({ error: 'finalize_translation_failed' }, { status: 500 })
  }
}


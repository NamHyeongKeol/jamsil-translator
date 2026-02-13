import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const runtime = 'nodejs'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
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

export async function POST(request: NextRequest) {
  if (!GEMINI_API_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is required' }, { status: 500 })
  }

  const body = await request.json().catch((): Record<string, unknown> => ({}))
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const sourceLanguage = normalizeLang(typeof body.sourceLanguage === 'string' ? body.sourceLanguage : '')
  const targetLanguagesRaw: unknown[] = Array.isArray(body.targetLanguages) ? body.targetLanguages : []

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

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const langList = targetLanguages.map((lang) => `${lang} (${LANG_NAMES[lang] || lang})`).join(', ')
  const systemPrompt = 'You are a translator. Respond ONLY with JSON mapping language codes to translations. No extra text.'
  const userPrompt = `Translate to ${langList}:\n"${text}"`

  try {
    const model = genAI.getGenerativeModel({
      model: DEFAULT_MODEL,
      systemInstruction: systemPrompt,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    })
    const result = await model.generateContent(userPrompt)
    const content = result.response.text()?.trim() || ''
    if (!content) {
      return NextResponse.json({ error: 'empty_translation_response' }, { status: 502 })
    }

    const allTranslations = parseTranslations(content)
    const translations: Record<string, string> = {}
    for (const lang of targetLanguages) {
      if (allTranslations[lang]) translations[lang] = allTranslations[lang]
    }

    return NextResponse.json({ translations })
  } catch (error) {
    console.error('Finalize translation route error:', error)
    return NextResponse.json({ error: 'finalize_translation_failed' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || ''
const DEFAULT_MODEL = process.env.DEMO_TRANSLATE_MODEL || 'gemini-2.5-flash-lite'

let translateRequestCount = 0

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
  const usage = result.response.usageMetadata
  console.log(`[Gemini] model=${DEFAULT_MODEL} | response=${content}`)
  if (usage) {
    console.log(`[Gemini] tokens: input=${usage.promptTokenCount}, output=${usage.candidatesTokenCount}, total=${usage.totalTokenCount}`)
  }
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

export async function POST(request: NextRequest) {
  if (!GEMINI_API_KEY && !OPENAI_API_KEY && !CLAUDE_API_KEY) {
    return NextResponse.json({ error: 'No translation API key configured' }, { status: 500 })
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

  const ctx: TranslateContext = { text, targetLanguages }
  translateRequestCount++
  console.log(`[Translate #${translateRequestCount}] text="${text.slice(0, 80)}" src=${sourceLanguage} targets=${targetLanguages.join(',')}`)

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

    return NextResponse.json({ translations })
  } catch (error) {
    console.error('Finalize translation route error:', error)
    return NextResponse.json({ error: 'finalize_translation_failed' }, { status: 500 })
  }
}

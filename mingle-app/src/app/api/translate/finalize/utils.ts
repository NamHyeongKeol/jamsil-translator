export type RecentTurnContext = {
  sourceLanguage: string
  sourceText: string
  translations: Record<string, string>
  ageMs?: number
}

export type CurrentTurnPreviousState = {
  sourceLanguage: string
  sourceText: string
  translations: Record<string, string>
}

function sanitizeNonNegativeInt(value: unknown): number | null {
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

function sanitizeMarkerText(raw: string): string {
  return raw.replace(/<\/?(?:end|fin)>/gi, '').trim()
}

function parseTranslationsPayload(raw: unknown, sourceLanguage: string): Record<string, string> {
  const payload = (
    typeof raw === 'object'
    && raw !== null
  ) ? raw as Record<string, unknown> : {}

  const translations: Record<string, string> = {}
  for (const [language, translatedText] of Object.entries(payload)) {
    if (typeof translatedText !== 'string') continue
    const normalizedLanguage = normalizeLang(language)
    if (!normalizedLanguage || normalizedLanguage === sourceLanguage) continue
    const cleaned = sanitizeMarkerText(translatedText)
    if (!cleaned) continue
    translations[normalizedLanguage] = cleaned
  }

  return translations
}

export function normalizeLang(input: string): string {
  return input.trim().replace('_', '-').toLowerCase().split('-')[0] || ''
}

export function normalizeTargetLanguages(raw: unknown[], sourceLanguage: string): string[] {
  const targets = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const normalized = normalizeLang(item)
    if (!normalized || normalized === sourceLanguage) continue
    targets.add(normalized)
  }
  return Array.from(targets)
}

export function parseTranslations(raw: string): Record<string, string> {
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
    const cleaned = sanitizeMarkerText(value)
    if (!cleaned) continue
    output[key] = cleaned
  }
  return output
}

export function parseRecentTurns(raw: unknown): RecentTurnContext[] {
  if (!Array.isArray(raw)) return []
  const items = raw.slice(-12)
  const turns: RecentTurnContext[] = []

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const payload = item as Record<string, unknown>
    const sourceText = typeof payload.sourceText === 'string'
      ? sanitizeMarkerText(payload.sourceText)
      : ''
    if (!sourceText) continue
    const sourceLanguage = normalizeLang(typeof payload.sourceLanguage === 'string' ? payload.sourceLanguage : '') || 'unknown'
    const translations = parseTranslationsPayload(payload.translations, sourceLanguage)
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

export function parseCurrentTurnPreviousState(raw: unknown): CurrentTurnPreviousState | null {
  if (!raw || typeof raw !== 'object') return null
  const payload = raw as Record<string, unknown>

  const sourceLanguage = normalizeLang(typeof payload.sourceLanguage === 'string' ? payload.sourceLanguage : '')
  const sourceText = typeof payload.sourceText === 'string'
    ? sanitizeMarkerText(payload.sourceText)
    : ''
  if (!sourceLanguage || !sourceText) return null

  const translations = parseTranslationsPayload(payload.translations, sourceLanguage)

  return {
    sourceLanguage,
    sourceText,
    translations,
  }
}

export function buildFallbackTranslationsFromCurrentTurnPreviousState(
  state: CurrentTurnPreviousState | null,
  targetLanguages: string[],
): Record<string, string> {
  if (!state) return {}
  const output: Record<string, string> = {}
  for (const language of targetLanguages) {
    const candidate = state.translations[language]?.trim()
    if (!candidate) continue
    output[language] = candidate
  }
  return output
}

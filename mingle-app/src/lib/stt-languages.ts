import {
  TRANSLATION_LANGUAGES,
  canonicalizeTranslationLanguageCode,
  type TranslationLanguageCode,
} from '@/lib/translation-languages'

export type SttLanguageCode = TranslationLanguageCode

export const DEFAULT_STT_LANGUAGES = ['en', 'ko', 'ja'] as const satisfies readonly SttLanguageCode[]

export const STT_LANGUAGE_OPTIONS = TRANSLATION_LANGUAGES

export const STT_LANGUAGE_CODES = STT_LANGUAGE_OPTIONS.map(({ code }) => code)

export const STT_LANGUAGE_NAME_MAP: Record<SttLanguageCode, string> = Object.fromEntries(
  STT_LANGUAGE_OPTIONS.map(({ code, englishName }) => [code, englishName]),
) as Record<SttLanguageCode, string>

export function canonicalizeSttLanguageCode(rawValue: string): SttLanguageCode | '' {
  return canonicalizeTranslationLanguageCode(rawValue)
}

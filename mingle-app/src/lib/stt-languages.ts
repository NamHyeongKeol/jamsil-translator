import {
  TRANSLATION_LANGUAGES,
  canonicalizeTranslationLanguageCode,
  type TranslationLanguageCode,
} from '@/lib/translation-languages'

export type SttLanguageCode = TranslationLanguageCode
export type SttLanguageOption = {
  code: SttLanguageCode
  englishName: string
  flag: string
}

export const DEFAULT_STT_LANGUAGES = ['en', 'ko', 'ja'] as const satisfies readonly SttLanguageCode[]

const STT_LANGUAGE_FLAG_MAP: Record<SttLanguageCode, string> = {
  af: '🇿🇦',
  sq: '🇦🇱',
  ar: '🇸🇦',
  az: '🇦🇿',
  eu: '🇪🇸',
  be: '🇧🇾',
  bn: '🇧🇩',
  bs: '🇧🇦',
  bg: '🇧🇬',
  ca: '🇪🇸',
  zh: '🇨🇳',
  hr: '🇭🇷',
  cs: '🇨🇿',
  da: '🇩🇰',
  nl: '🇳🇱',
  en: '🇺🇸',
  et: '🇪🇪',
  fi: '🇫🇮',
  fr: '🇫🇷',
  gl: '🇪🇸',
  de: '🇩🇪',
  el: '🇬🇷',
  gu: '🇮🇳',
  he: '🇮🇱',
  hi: '🇮🇳',
  hu: '🇭🇺',
  id: '🇮🇩',
  it: '🇮🇹',
  ja: '🇯🇵',
  kn: '🇮🇳',
  kk: '🇰🇿',
  ko: '🇰🇷',
  lv: '🇱🇻',
  lt: '🇱🇹',
  mk: '🇲🇰',
  ms: '🇲🇾',
  ml: '🇮🇳',
  mr: '🇮🇳',
  no: '🇳🇴',
  fa: '🇮🇷',
  pl: '🇵🇱',
  pt: '🇵🇹',
  pa: '🇮🇳',
  ro: '🇷🇴',
  ru: '🇷🇺',
  sr: '🇷🇸',
  sk: '🇸🇰',
  sl: '🇸🇮',
  es: '🇪🇸',
  sw: '🇹🇿',
  sv: '🇸🇪',
  tl: '🇵🇭',
  ta: '🇮🇳',
  te: '🇮🇳',
  th: '🇹🇭',
  tr: '🇹🇷',
  uk: '🇺🇦',
  ur: '🇵🇰',
  vi: '🇻🇳',
  cy: '🇬🇧',
}

export const STT_LANGUAGE_OPTIONS: SttLanguageOption[] = TRANSLATION_LANGUAGES.map((language) => ({
  ...language,
  flag: STT_LANGUAGE_FLAG_MAP[language.code],
}))

export const STT_LANGUAGE_CODES = STT_LANGUAGE_OPTIONS.map(({ code }) => code)

export const STT_LANGUAGE_NAME_MAP: Record<SttLanguageCode, string> = Object.fromEntries(
  STT_LANGUAGE_OPTIONS.map(({ code, englishName }) => [code, englishName]),
) as Record<SttLanguageCode, string>

export function canonicalizeSttLanguageCode(rawValue: string): SttLanguageCode | '' {
  return canonicalizeTranslationLanguageCode(rawValue)
}

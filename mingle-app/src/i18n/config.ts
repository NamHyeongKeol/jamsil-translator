export const SUPPORTED_LOCALES = [
  "ko",
  "en",
  "ja",
  "zh-CN",
  "zh-TW",
  "fr",
  "de",
  "es",
  "pt",
  "it",
  "ru",
  "ar",
  "af",
  "sq",
  "az",
  "eu",
  "be",
  "bn",
  "bs",
  "bg",
  "ca",
  "hr",
  "cs",
  "da",
  "nl",
  "et",
  "fi",
  "gl",
  "el",
  "gu",
  "he",
  "hi",
  "hu",
  "id",
  "kn",
  "kk",
  "th",
  "lv",
  "lt",
  "mk",
  "ms",
  "ml",
  "mr",
  "no",
  "fa",
  "pl",
  "pa",
  "ro",
  "sr",
  "sk",
  "sl",
  "sw",
  "sv",
  "tl",
  "ta",
  "te",
  "tr",
  "uk",
  "ur",
  "vi",
  "cy",
] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const TRANSLATED_LOCALES = [
  "ko",
  "en",
  "ja",
  "zh-CN",
  "zh-TW",
  "fr",
  "de",
  "es",
  "pt",
  "it",
  "ru",
  "ar",
  "hi",
  "th",
  "vi",
] as const;

export type TranslatedAppLocale = (typeof TRANSLATED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "ko";

export function isSupportedLocale(value: string): value is AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale);
}

export function isTranslatedLocale(value: AppLocale): value is TranslatedAppLocale {
  return TRANSLATED_LOCALES.includes(value as TranslatedAppLocale);
}

const DICTIONARY_LOCALE_MAP: Record<AppLocale, TranslatedAppLocale> = {
  ko: "ko",
  en: "en",
  ja: "ja",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  fr: "fr",
  de: "de",
  es: "es",
  pt: "pt",
  it: "it",
  ru: "ru",
  ar: "ar",
  af: "en",
  sq: "en",
  az: "en",
  eu: "en",
  be: "en",
  bn: "en",
  bs: "en",
  bg: "en",
  ca: "en",
  hr: "en",
  cs: "en",
  da: "en",
  nl: "en",
  et: "en",
  fi: "en",
  gl: "en",
  el: "en",
  gu: "en",
  he: "en",
  hi: "hi",
  hu: "en",
  id: "en",
  kn: "en",
  kk: "en",
  th: "th",
  lv: "en",
  lt: "en",
  mk: "en",
  ms: "en",
  ml: "en",
  mr: "en",
  no: "en",
  fa: "en",
  pl: "en",
  pa: "en",
  ro: "en",
  sr: "en",
  sk: "en",
  sl: "en",
  sw: "en",
  sv: "en",
  tl: "en",
  ta: "en",
  te: "en",
  tr: "en",
  uk: "en",
  ur: "en",
  vi: "vi",
  cy: "en",
};

const LOCALE_ALIAS_MAP: Record<string, AppLocale> = {
  ko: "ko",
  en: "en",
  ja: "ja",
  fr: "fr",
  de: "de",
  es: "es",
  pt: "pt",
  it: "it",
  ru: "ru",
  ar: "ar",
  af: "af",
  sq: "sq",
  az: "az",
  eu: "eu",
  be: "be",
  bn: "bn",
  bs: "bs",
  bg: "bg",
  ca: "ca",
  hr: "hr",
  cs: "cs",
  da: "da",
  nl: "nl",
  et: "et",
  fi: "fi",
  gl: "gl",
  el: "el",
  gu: "gu",
  he: "he",
  hi: "hi",
  hu: "hu",
  id: "id",
  kn: "kn",
  kk: "kk",
  th: "th",
  lv: "lv",
  lt: "lt",
  mk: "mk",
  ms: "ms",
  ml: "ml",
  mr: "mr",
  no: "no",
  fa: "fa",
  pl: "pl",
  pa: "pa",
  ro: "ro",
  sr: "sr",
  sk: "sk",
  sl: "sl",
  sw: "sw",
  sv: "sv",
  tl: "tl",
  ta: "ta",
  te: "te",
  tr: "tr",
  uk: "uk",
  ur: "ur",
  vi: "vi",
  cy: "cy",
  fil: "tl",
  in: "id",
  iw: "he",
  nb: "no",
  nn: "no",
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-sg": "zh-CN",
  "zh-tw": "zh-TW",
  "zh-hant": "zh-TW",
  "zh-hk": "zh-TW",
  "zh-mo": "zh-TW",
};

function resolveZhLocale(normalized: string): AppLocale | null {
  if (normalized === "zh" || normalized.startsWith("zh-")) {
    if (
      normalized.includes("-tw")
      || normalized.includes("-hant")
      || normalized.includes("-hk")
      || normalized.includes("-mo")
    ) {
      return "zh-TW";
    }
    return "zh-CN";
  }
  return null;
}

export function resolveDictionaryLocale(locale: AppLocale): TranslatedAppLocale {
  return DICTIONARY_LOCALE_MAP[locale];
}

export function resolveSupportedLocaleTag(rawValue: string): AppLocale | null {
  const normalized = rawValue.trim().replace(/_/g, "-").toLowerCase();
  if (!normalized) return null;

  const directMatch = LOCALE_ALIAS_MAP[normalized];
  if (directMatch) {
    return directMatch;
  }

  const zhResolved = resolveZhLocale(normalized);
  if (zhResolved) {
    return zhResolved;
  }

  const base = normalized.split("-")[0];
  if (!base) return null;

  const baseMatch = LOCALE_ALIAS_MAP[base];
  if (baseMatch) {
    return baseMatch;
  }

  return null;
}

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

export const TRANSLATED_LOCALES = SUPPORTED_LOCALES;

export type TranslatedAppLocale = AppLocale;

export const LEGAL_DOCUMENT_LOCALES = SUPPORTED_LOCALES;

export type LegalDocumentLocale = AppLocale;

export const DEFAULT_LOCALE: AppLocale = "ko";

export function isSupportedLocale(value: string): value is AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale);
}

export function isTranslatedLocale(value: AppLocale): value is TranslatedAppLocale {
  return isSupportedLocale(value);
}

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
  return locale;
}

export function resolveLegalDocumentLocale(locale: AppLocale): LegalDocumentLocale {
  return locale;
}

export function resolveLegalDocumentPathSegment(locale: AppLocale): string {
  return locale.toLowerCase();
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

export const TRANSLATION_LANGUAGES = [
  { code: "af", englishName: "Afrikaans" },
  { code: "sq", englishName: "Albanian" },
  { code: "ar", englishName: "Arabic" },
  { code: "az", englishName: "Azerbaijani" },
  { code: "eu", englishName: "Basque" },
  { code: "be", englishName: "Belarusian" },
  { code: "bn", englishName: "Bengali" },
  { code: "bs", englishName: "Bosnian" },
  { code: "bg", englishName: "Bulgarian" },
  { code: "ca", englishName: "Catalan" },
  { code: "zh", englishName: "Chinese" },
  { code: "hr", englishName: "Croatian" },
  { code: "cs", englishName: "Czech" },
  { code: "da", englishName: "Danish" },
  { code: "nl", englishName: "Dutch" },
  { code: "en", englishName: "English" },
  { code: "et", englishName: "Estonian" },
  { code: "fi", englishName: "Finnish" },
  { code: "fr", englishName: "French" },
  { code: "gl", englishName: "Galician" },
  { code: "de", englishName: "German" },
  { code: "el", englishName: "Greek" },
  { code: "gu", englishName: "Gujarati" },
  { code: "he", englishName: "Hebrew" },
  { code: "hi", englishName: "Hindi" },
  { code: "hu", englishName: "Hungarian" },
  { code: "id", englishName: "Indonesian" },
  { code: "it", englishName: "Italian" },
  { code: "ja", englishName: "Japanese" },
  { code: "kn", englishName: "Kannada" },
  { code: "kk", englishName: "Kazakh" },
  { code: "ko", englishName: "Korean" },
  { code: "lv", englishName: "Latvian" },
  { code: "lt", englishName: "Lithuanian" },
  { code: "mk", englishName: "Macedonian" },
  { code: "ms", englishName: "Malay" },
  { code: "ml", englishName: "Malayalam" },
  { code: "mr", englishName: "Marathi" },
  { code: "no", englishName: "Norwegian" },
  { code: "fa", englishName: "Persian" },
  { code: "pl", englishName: "Polish" },
  { code: "pt", englishName: "Portuguese" },
  { code: "pa", englishName: "Punjabi" },
  { code: "ro", englishName: "Romanian" },
  { code: "ru", englishName: "Russian" },
  { code: "sr", englishName: "Serbian" },
  { code: "sk", englishName: "Slovak" },
  { code: "sl", englishName: "Slovenian" },
  { code: "es", englishName: "Spanish" },
  { code: "sw", englishName: "Swahili" },
  { code: "sv", englishName: "Swedish" },
  { code: "tl", englishName: "Tagalog" },
  { code: "ta", englishName: "Tamil" },
  { code: "te", englishName: "Telugu" },
  { code: "th", englishName: "Thai" },
  { code: "tr", englishName: "Turkish" },
  { code: "uk", englishName: "Ukrainian" },
  { code: "ur", englishName: "Urdu" },
  { code: "vi", englishName: "Vietnamese" },
  { code: "cy", englishName: "Welsh" },
] as const;

export type TranslationLanguageCode = (typeof TRANSLATION_LANGUAGES)[number]["code"];

const TRANSLATION_LANGUAGE_CODE_SET = new Set<TranslationLanguageCode>(
  TRANSLATION_LANGUAGES.map((language) => language.code),
);

const TRANSLATION_LANGUAGE_NAME_MAP: Record<TranslationLanguageCode, string> =
  Object.fromEntries(
    TRANSLATION_LANGUAGES.map((language) => [language.code, language.englishName]),
  ) as Record<TranslationLanguageCode, string>;

const TRANSLATION_LANGUAGE_ALIASES: Record<string, TranslationLanguageCode> = {
  fil: "tl",
  in: "id",
  iw: "he",
  nb: "no",
  nn: "no",
  "zh-cn": "zh",
  "zh-hans": "zh",
  "zh-hk": "zh",
  "zh-mo": "zh",
  "zh-sg": "zh",
  "zh-tw": "zh",
  "zh-hant": "zh",
};

export function getTranslationLanguageName(code: string): string | null {
  if (!isSupportedTranslationLanguageCode(code)) return null;
  return TRANSLATION_LANGUAGE_NAME_MAP[code];
}

export function canonicalizeTranslationLanguageCode(rawValue: string): TranslationLanguageCode | "" {
  const normalized = rawValue.trim().replace(/_/g, "-").toLowerCase();
  if (!normalized) return "";

  const directAlias = TRANSLATION_LANGUAGE_ALIASES[normalized];
  if (directAlias) return directAlias;

  if (TRANSLATION_LANGUAGE_CODE_SET.has(normalized as TranslationLanguageCode)) {
    return normalized as TranslationLanguageCode;
  }

  const base = normalized.split("-")[0] || "";
  if (!base) return "";

  const baseAlias = TRANSLATION_LANGUAGE_ALIASES[base];
  if (baseAlias) return baseAlias;

  if (TRANSLATION_LANGUAGE_CODE_SET.has(base as TranslationLanguageCode)) {
    return base as TranslationLanguageCode;
  }

  return "";
}

export function isSupportedTranslationLanguageCode(
  value: string,
): value is TranslationLanguageCode {
  return TRANSLATION_LANGUAGE_CODE_SET.has(value as TranslationLanguageCode);
}

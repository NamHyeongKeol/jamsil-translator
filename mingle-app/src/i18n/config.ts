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
  "hi",
  "th",
  "vi",
] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "ko";

export function isSupportedLocale(value: string): value is AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale);
}

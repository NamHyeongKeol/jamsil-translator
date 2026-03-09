import { DEFAULT_LOCALE, isSupportedLocale, type AppLocale } from "@/i18n";

const LEGACY_APP_LOCALE_ALIASES: Record<string, AppLocale> = {
  zh: "zh-CN",
};

export function normalizeAppLocale(rawLocale: string | null | undefined): AppLocale | null {
  if (typeof rawLocale !== "string") return null;

  const normalized = rawLocale.trim();
  if (!normalized) return null;

  const aliasMatch = LEGACY_APP_LOCALE_ALIASES[normalized];
  if (aliasMatch) {
    return aliasMatch;
  }

  if (isSupportedLocale(normalized)) {
    return normalized;
  }

  return null;
}

export function resolveAppLocale(
  rawLocale: string | null | undefined,
  fallbackLocale: AppLocale = DEFAULT_LOCALE,
): AppLocale {
  return normalizeAppLocale(rawLocale) ?? fallbackLocale;
}

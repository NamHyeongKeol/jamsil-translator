import { DEFAULT_LOCALE, resolveDictionaryLocale, type AppLocale } from "@/i18n/config";
import { localeDictionaries } from "@/i18n/dictionaries/catalog";
import type { AppDictionary } from "@/i18n/types";

export function getDictionary(locale: AppLocale): AppDictionary {
  return localeDictionaries[resolveDictionaryLocale(locale)] ?? localeDictionaries[DEFAULT_LOCALE];
}

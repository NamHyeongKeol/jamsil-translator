import { DEFAULT_LOCALE, type AppLocale } from "@/i18n/config";
import { enDictionary } from "@/i18n/dictionaries/en";
import { jaDictionary } from "@/i18n/dictionaries/ja";
import { koDictionary } from "@/i18n/dictionaries/ko";
import type { AppDictionary } from "@/i18n/types";

const dictionaries: Record<AppLocale, AppDictionary> = {
  ko: koDictionary,
  en: enDictionary,
  ja: jaDictionary,
};

export function getDictionary(locale: AppLocale): AppDictionary {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
}

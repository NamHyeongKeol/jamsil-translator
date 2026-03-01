import { DEFAULT_LOCALE, type AppLocale } from "@/i18n/config";
import { arDictionary } from "@/i18n/dictionaries/ar";
import { deDictionary } from "@/i18n/dictionaries/de";
import { enDictionary } from "@/i18n/dictionaries/en";
import { esDictionary } from "@/i18n/dictionaries/es";
import { frDictionary } from "@/i18n/dictionaries/fr";
import { hiDictionary } from "@/i18n/dictionaries/hi";
import { itDictionary } from "@/i18n/dictionaries/it";
import { jaDictionary } from "@/i18n/dictionaries/ja";
import { koDictionary } from "@/i18n/dictionaries/ko";
import { ptDictionary } from "@/i18n/dictionaries/pt";
import { ruDictionary } from "@/i18n/dictionaries/ru";
import { thDictionary } from "@/i18n/dictionaries/th";
import { viDictionary } from "@/i18n/dictionaries/vi";
import { zhCnDictionary } from "@/i18n/dictionaries/zh-cn";
import { zhTwDictionary } from "@/i18n/dictionaries/zh-tw";
import type { AppDictionary } from "@/i18n/types";

const dictionaries: Record<AppLocale, AppDictionary> = {
  ko: koDictionary,
  en: enDictionary,
  ja: jaDictionary,
  "zh-CN": zhCnDictionary,
  "zh-TW": zhTwDictionary,
  fr: frDictionary,
  de: deDictionary,
  es: esDictionary,
  pt: ptDictionary,
  it: itDictionary,
  ru: ruDictionary,
  ar: arDictionary,
  hi: hiDictionary,
  th: thDictionary,
  vi: viDictionary,
};

export function getDictionary(locale: AppLocale): AppDictionary {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
}

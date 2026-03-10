import type { AppLocale } from "@/i18n/config";
import { deDictionary } from "@/i18n/dictionaries/de";
import { enDictionary } from "@/i18n/dictionaries/en";
import { esDictionary } from "@/i18n/dictionaries/es";
import { frDictionary } from "@/i18n/dictionaries/fr";
import { generatedLocaleDictionaries } from "@/i18n/dictionaries/generated";
import { itDictionary } from "@/i18n/dictionaries/it";
import { jaDictionary } from "@/i18n/dictionaries/ja";
import { koDictionary } from "@/i18n/dictionaries/ko";
import { ptDictionary } from "@/i18n/dictionaries/pt";
import type { AppDictionary } from "@/i18n/types";

export const localeDictionaries = {
  ko: koDictionary,
  en: enDictionary,
  ja: jaDictionary,
  fr: frDictionary,
  de: deDictionary,
  es: esDictionary,
  pt: ptDictionary,
  it: itDictionary,
  ...generatedLocaleDictionaries,
} satisfies Record<AppLocale, AppDictionary>;

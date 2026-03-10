import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type AppLocale,
} from "@/i18n/config";
import { deDictionary } from "@/i18n/dictionaries/de";
import { draftScreenDictionaries } from "@/i18n/dictionaries/draft-screen-locales";
import { enDictionary } from "@/i18n/dictionaries/en";
import { esDictionary } from "@/i18n/dictionaries/es";
import { frDictionary } from "@/i18n/dictionaries/fr";
import { generatedLocaleDictionaries } from "@/i18n/dictionaries/generated";
import { itDictionary } from "@/i18n/dictionaries/it";
import { jaDictionary } from "@/i18n/dictionaries/ja";
import { koDictionary } from "@/i18n/dictionaries/ko";
import { ptDictionary } from "@/i18n/dictionaries/pt";
import type { AppDictionary, BaseAppDictionary } from "@/i18n/types";

const baseLocaleDictionaries = {
  ...generatedLocaleDictionaries,
  ko: koDictionary,
  en: enDictionary,
  ja: jaDictionary,
  fr: frDictionary,
  de: deDictionary,
  es: esDictionary,
  pt: ptDictionary,
  it: itDictionary,
} satisfies Partial<Record<AppLocale, BaseAppDictionary>>;

function withDraftScreens(
  locale: AppLocale,
  dictionary: BaseAppDictionary,
): AppDictionary {
  const draftScreens =
    draftScreenDictionaries[locale] ?? draftScreenDictionaries[DEFAULT_LOCALE]!;

  return {
    ...dictionary,
    ...draftScreens,
  };
}

export const localeDictionaries = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [
    locale,
    withDraftScreens(
      locale,
      baseLocaleDictionaries[locale] ?? baseLocaleDictionaries[DEFAULT_LOCALE]!,
    ),
  ]),
) as Record<AppLocale, AppDictionary>;

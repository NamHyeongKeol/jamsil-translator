import type { AppLocale } from "@/i18n/config";
import { draftScreenDictionaries } from "@/i18n/dictionaries/draft-screen-locales";
import { enDictionary } from "@/i18n/dictionaries/en";
import type { AppDictionary } from "@/i18n/types";

type ProfileOverrides = Partial<AppDictionary["profile"]>;

export function createProfileLocalizedDictionary(
  locale: AppLocale,
  profileOverrides: ProfileOverrides,
): AppDictionary {
  return {
    ...enDictionary,
    ...draftScreenDictionaries[locale],
    profile: {
      ...enDictionary.profile,
      ...profileOverrides,
    },
  };
}

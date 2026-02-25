import { enDictionary } from "@/i18n/dictionaries/en";
import type { AppDictionary } from "@/i18n/types";

type ProfileOverrides = Partial<AppDictionary["profile"]>;

export function createProfileLocalizedDictionary(profileOverrides: ProfileOverrides): AppDictionary {
  return {
    ...enDictionary,
    profile: {
      ...enDictionary.profile,
      ...profileOverrides,
    },
  };
}

export {
  DEFAULT_LOCALE,
  LEGAL_DOCUMENT_LOCALES,
  SUPPORTED_LOCALES,
  TRANSLATED_LOCALES,
  isSupportedLocale,
  isTranslatedLocale,
  resolveDictionaryLocale,
  resolveLegalDocumentLocale,
  resolveLegalDocumentPathSegment,
  resolveSupportedLocaleTag,
  type AppLocale,
  type LegalDocumentLocale,
  type TranslatedAppLocale,
} from "@/i18n/config";
export { getDictionary } from "@/i18n/get-dictionary";
export type { AppDictionary } from "@/i18n/types";

import { describe, expect, it } from "vitest";
import {
  LEGAL_DOCUMENT_LOCALES,
  SUPPORTED_LOCALES,
  TRANSLATED_LOCALES,
  resolveDictionaryLocale,
  resolveLegalDocumentLocale,
  resolveLegalDocumentPathSegment,
  resolveSupportedLocaleTag,
} from "@/i18n";

describe("i18n config", () => {
  it("supports the expanded locale catalog", () => {
    expect(SUPPORTED_LOCALES).toHaveLength(61);
    expect(SUPPORTED_LOCALES).toEqual(expect.arrayContaining([
      "ko",
      "en",
      "zh-CN",
      "zh-TW",
      "pl",
      "he",
      "tl",
      "uk",
      "cy",
    ]));
    expect(TRANSLATED_LOCALES).toEqual(SUPPORTED_LOCALES);
    expect(LEGAL_DOCUMENT_LOCALES).toHaveLength(15);
  });

  it("normalizes locale aliases into supported locale tags", () => {
    expect(resolveSupportedLocaleTag("pl-PL")).toBe("pl");
    expect(resolveSupportedLocaleTag("fil-PH")).toBe("tl");
    expect(resolveSupportedLocaleTag("iw-IL")).toBe("he");
    expect(resolveSupportedLocaleTag("zh-Hant-HK")).toBe("zh-TW");
    expect(resolveSupportedLocaleTag("zh-Hans-SG")).toBe("zh-CN");
    expect(resolveSupportedLocaleTag("")).toBeNull();
  });

  it("resolves full app dictionaries while keeping legal document fallback mapping", () => {
    expect(resolveDictionaryLocale("pl")).toBe("pl");
    expect(resolveDictionaryLocale("he")).toBe("he");
    expect(resolveDictionaryLocale("zh-TW")).toBe("zh-TW");
    expect(resolveLegalDocumentLocale("pl")).toBe("en");
    expect(resolveLegalDocumentLocale("hi")).toBe("hi");
    expect(resolveLegalDocumentPathSegment("pl")).toBe("en");
    expect(resolveLegalDocumentPathSegment("zh-CN")).toBe("zh-cn");
  });
});

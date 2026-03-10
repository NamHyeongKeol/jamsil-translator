import { describe, expect, it } from "vitest";
import {
  SUPPORTED_LOCALES,
  TRANSLATED_LOCALES,
  resolveDictionaryLocale,
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
    expect(TRANSLATED_LOCALES).toHaveLength(15);
  });

  it("normalizes locale aliases into supported locale tags", () => {
    expect(resolveSupportedLocaleTag("pl-PL")).toBe("pl");
    expect(resolveSupportedLocaleTag("fil-PH")).toBe("tl");
    expect(resolveSupportedLocaleTag("iw-IL")).toBe("he");
    expect(resolveSupportedLocaleTag("zh-Hant-HK")).toBe("zh-TW");
    expect(resolveSupportedLocaleTag("zh-Hans-SG")).toBe("zh-CN");
    expect(resolveSupportedLocaleTag("")).toBeNull();
  });

  it("maps untranslated locales to the nearest shipped dictionary", () => {
    expect(resolveDictionaryLocale("pl")).toBe("en");
    expect(resolveDictionaryLocale("he")).toBe("en");
    expect(resolveDictionaryLocale("hi")).toBe("hi");
    expect(resolveDictionaryLocale("zh-TW")).toBe("zh-TW");
  });
});

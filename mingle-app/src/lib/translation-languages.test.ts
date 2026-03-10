import { describe, expect, it } from "vitest";
import {
  TRANSLATION_LANGUAGES,
  canonicalizeTranslationLanguageCode,
  getTranslationLanguageName,
} from "@/lib/translation-languages";

describe("translation languages", () => {
  it("exposes the full 60-language catalog", () => {
    expect(TRANSLATION_LANGUAGES).toHaveLength(60);
    expect(TRANSLATION_LANGUAGES).toEqual(expect.arrayContaining([
      { code: "af", englishName: "Afrikaans" },
      { code: "zh", englishName: "Chinese" },
      { code: "he", englishName: "Hebrew" },
      { code: "tl", englishName: "Tagalog" },
      { code: "cy", englishName: "Welsh" },
    ]));
  });

  it("canonicalizes known aliases used by clients and model responses", () => {
    expect(canonicalizeTranslationLanguageCode("fil-PH")).toBe("tl");
    expect(canonicalizeTranslationLanguageCode("iw-IL")).toBe("he");
    expect(canonicalizeTranslationLanguageCode("zh-TW")).toBe("zh");
    expect(canonicalizeTranslationLanguageCode("nb-NO")).toBe("no");
    expect(canonicalizeTranslationLanguageCode("in-ID")).toBe("id");
  });

  it("returns display names for canonical codes", () => {
    expect(getTranslationLanguageName("tl")).toBe("Tagalog");
    expect(getTranslationLanguageName("he")).toBe("Hebrew");
    expect(getTranslationLanguageName("xx")).toBeNull();
  });
});

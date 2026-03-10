import { describe, expect, it } from "vitest";
import { getDictionary } from "@/i18n";
import { enDictionary } from "@/i18n/dictionaries/en";
import { hiDictionary } from "@/i18n/dictionaries/hi";
import { zhTwDictionary } from "@/i18n/dictionaries/zh-tw";

describe("getDictionary", () => {
  it("falls back to english for locales without a dedicated dictionary", () => {
    expect(getDictionary("pl")).toBe(enDictionary);
    expect(getDictionary("he")).toBe(enDictionary);
  });

  it("returns shipped dictionaries for translated locales", () => {
    expect(getDictionary("hi")).toBe(hiDictionary);
    expect(getDictionary("zh-TW")).toBe(zhTwDictionary);
  });
});

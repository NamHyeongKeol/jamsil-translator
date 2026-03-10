import { describe, expect, it } from "vitest";
import { getDictionary } from "@/i18n";

describe("getDictionary", () => {
  it("returns dedicated dictionaries for the expanded locale catalog", () => {
    expect(getDictionary("pl").account.title).toBe("Konto");
    expect(getDictionary("he").account.title).toBe("חשבון");
    expect(getDictionary("zh-TW").account.title).toBe("帳戶");
  });
});

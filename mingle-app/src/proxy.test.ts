import { describe, expect, it } from "vitest";
import { resolveSupportedLocaleTag } from "@/proxy";

describe("proxy locale resolver", () => {
  it("maps zh-Hant variants to zh-TW", () => {
    expect(resolveSupportedLocaleTag("zh-Hant-TW")).toBe("zh-TW");
    expect(resolveSupportedLocaleTag("zh-Hant-HK")).toBe("zh-TW");
  });

  it("maps zh-Hans variants to zh-CN", () => {
    expect(resolveSupportedLocaleTag("zh-Hans-CN")).toBe("zh-CN");
    expect(resolveSupportedLocaleTag("zh-Hans-SG")).toBe("zh-CN");
  });

  it("maps known non-Chinese locale tags", () => {
    expect(resolveSupportedLocaleTag("fr-FR")).toBe("fr");
    expect(resolveSupportedLocaleTag("en-US")).toBe("en");
  });
});

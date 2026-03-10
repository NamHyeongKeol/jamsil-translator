import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEGAL_DOCUMENT_LOCALES, resolveLegalDocumentPathSegment } from "@/i18n";

describe("legal document files", () => {
  it("has privacy and terms pages for every legal locale", () => {
    const legalRoot = fileURLToPath(new URL("../../public/legal", import.meta.url));

    for (const locale of LEGAL_DOCUMENT_LOCALES) {
      const pathSegment = resolveLegalDocumentPathSegment(locale);
      const privacyPath = path.resolve(
        legalRoot,
        pathSegment,
        "privacy-policy.html",
      );
      const termsPath = path.resolve(
        legalRoot,
        pathSegment,
        "terms-of-use.html",
      );

      expect(existsSync(privacyPath), `${locale} privacy-policy.html`).toBe(true);
      expect(existsSync(termsPath), `${locale} terms-of-use.html`).toBe(true);
    }
  });
});

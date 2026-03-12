import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function mapUploadLocaleToJsonLocale(uploadLocaleDirName: string): string {
  const normalized = uploadLocaleDirName.trim().toLowerCase();
  if (normalized.length === 0) {
    return normalized;
  }

  const explicit: Record<string, string> = {
    "en-us": "en",
    "zh-hans": "zh-cn",
    "zh-hant": "zh-tw",
    "de-de": "de",
    "es-es": "es",
    "fr-fr": "fr",
    "fr-ca": "fr",
    "pt-br": "pt",
    "pt-pt": "pt",
    "ar-sa": "ar",
  };

  return explicit[normalized] ?? normalized.split("-")[0];
}

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buffer = fs.readFileSync(filePath);
  const signature = buffer.subarray(0, 8).toString("hex");
  const pngSignature = "89504e470d0a1a0a";

  if (signature !== pngSignature) {
    throw new Error(`Not a PNG file: ${filePath}`);
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

const configJsonPath = path.resolve(
  process.cwd(),
  "rn/google-play-console-info/google-play-console-info.i18n.json",
);
const workspaceRoot = path.dirname(configJsonPath);
const payload = JSON.parse(fs.readFileSync(configJsonPath, "utf8")) as {
  googlePlay?: {
    appDetails?: {
      packageName?: unknown;
      defaultLanguage?: unknown;
      contactEmail?: unknown;
      contactPhone?: unknown;
      contactWebsite?: unknown;
    };
    assets?: {
      iconPath?: unknown;
      featureGraphicPath?: unknown;
      phoneScreenshotsDir?: unknown;
    };
    storeListing?: {
      defaultMetadataLocale?: unknown;
      title?: Record<string, unknown>;
      shortDescription?: Record<string, unknown>;
      fullDescription?: Record<string, unknown>;
    };
    manualOnly?: {
      privacyPolicyUrl?: unknown;
      termsOfUseUrl?: unknown;
    };
  };
};

describe("google-play-console-info contract", () => {
  it("includes Play app details and screenshot workspace paths", () => {
    const appDetails = payload.googlePlay?.appDetails;
    const assets = payload.googlePlay?.assets;

    expect(isNonEmptyString(appDetails?.packageName)).toBe(true);
    expect(isNonEmptyString(appDetails?.defaultLanguage)).toBe(true);
    expect(isNonEmptyString(appDetails?.contactEmail)).toBe(true);
    expect(isNonEmptyString(appDetails?.contactWebsite)).toBe(true);
    expect(typeof appDetails?.contactPhone === "string").toBe(true);
    expect(isNonEmptyString(assets?.iconPath)).toBe(true);
    expect(isNonEmptyString(assets?.phoneScreenshotsDir)).toBe(true);
  });

  it("keeps a 512x512 Play icon asset in the workspace", () => {
    const iconPath = payload.googlePlay?.assets?.iconPath as string;
    const resolvedPath = path.resolve(workspaceRoot, iconPath);

    expect(fs.existsSync(resolvedPath)).toBe(true);

    const dimensions = readPngDimensions(resolvedPath);
    expect(dimensions.width).toBe(512);
    expect(dimensions.height).toBe(512);
  });

  it("keeps listing text and screenshots aligned for every Play upload locale", () => {
    const assets = payload.googlePlay?.assets;
    const storeListing = payload.googlePlay?.storeListing;
    const screenshotRoot = path.resolve(
      workspaceRoot,
      assets?.phoneScreenshotsDir as string,
    );
    const uploadLocales = fs
      .readdirSync(screenshotRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(uploadLocales.length).toBeGreaterThan(0);

    for (const uploadLocale of uploadLocales) {
      const copyLocale = mapUploadLocaleToJsonLocale(uploadLocale);
      expect(
        isNonEmptyString(storeListing?.title?.[copyLocale]),
        `missing title for Play locale ${uploadLocale} (${copyLocale})`,
      ).toBe(true);
      expect(
        isNonEmptyString(storeListing?.shortDescription?.[copyLocale]),
        `missing shortDescription for Play locale ${uploadLocale} (${copyLocale})`,
      ).toBe(true);
      expect(
        isNonEmptyString(storeListing?.fullDescription?.[copyLocale]),
        `missing fullDescription for Play locale ${uploadLocale} (${copyLocale})`,
      ).toBe(true);

      const imageFiles = fs
        .readdirSync(path.join(screenshotRoot, uploadLocale), { withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .filter((fileName) => /\.(png|jpg|jpeg)$/i.test(fileName));

      expect(
        imageFiles.length,
        `missing phone screenshots for Play locale: ${uploadLocale}`,
      ).toBeGreaterThan(0);
    }
  });

  it("tracks console-only Play policy fields in the same JSON", () => {
    const manualOnly = payload.googlePlay?.manualOnly;
    expect(isNonEmptyString(manualOnly?.privacyPolicyUrl)).toBe(true);
    expect(isNonEmptyString(manualOnly?.termsOfUseUrl)).toBe(true);
  });
});

#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_CONFIG_JSON = path.join(
  REPO_ROOT,
  "mingle-app/rn/google-play-console-info/google-play-console-info.i18n.json",
);
const DEFAULT_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const ANDROID_PUBLISHER_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const ANDROID_PUBLISHER_UPLOAD_BASE =
  "https://androidpublisher.googleapis.com/upload/androidpublisher/v3";

function printUsage() {
  console.log(`Usage: scripts/google-play-console-sync.mjs [options]

Options:
  --json <path>                  Play metadata JSON path
  --service-account-json <path>  Google service account JSON file path
  --package-name <name>          Override Android package name
  --languages <csv>              Limit upload to specific Play listing locales
  --dry-run                      Print upload plan without calling Google APIs
  --validate-only                Create and validate an edit without committing it
  --skip-details                 Skip app details sync
  --skip-listings                Skip localized listing text sync
  --skip-images                  Skip all graphic asset uploads
  --skip-icon                    Skip icon upload
  --skip-feature-graphic         Skip feature graphic upload
  --skip-screenshots             Skip phone screenshot upload
  -h, --help                     Show help

Environment:
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH  Path to a Google service account JSON file
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON       Raw service account JSON payload

Notes:
  - The Play app must already exist and have had at least one binary uploaded once via Play Console.
  - Legal consents and other Play Console-only sections cannot be filled through the Publishing API.
`);
}

function parseArgs(argv) {
  const options = {
    configJson: DEFAULT_CONFIG_JSON,
    serviceAccountJsonPath:
      process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH ?? "",
    packageName: "",
    languages: [],
    dryRun: false,
    validateOnly: false,
    skipDetails: false,
    skipListings: false,
    skipImages: false,
    skipIcon: false,
    skipFeatureGraphic: false,
    skipScreenshots: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--json":
        options.configJson = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--service-account-json":
        options.serviceAccountJsonPath = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--package-name":
        options.packageName = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--languages":
        options.languages = (argv[index + 1] ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--validate-only":
        options.validateOnly = true;
        break;
      case "--skip-details":
        options.skipDetails = true;
        break;
      case "--skip-listings":
        options.skipListings = true;
        break;
      case "--skip-images":
        options.skipImages = true;
        break;
      case "--skip-icon":
        options.skipIcon = true;
        break;
      case "--skip-feature-graphic":
        options.skipFeatureGraphic = true;
        break;
      case "--skip-screenshots":
        options.skipScreenshots = true;
        break;
      case "-h":
      case "--help":
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function mapUploadLocaleToCopyLocale(uploadLocaleDirName) {
  const normalized = uploadLocaleDirName.trim().toLowerCase();
  if (normalized.length === 0) {
    return normalized;
  }

  const explicit = {
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

function getLocalizedValue(map, copyLocale, fallbackLocale) {
  if (!map || typeof map !== "object") {
    return "";
  }

  const exact = map[copyLocale];
  if (isNonEmptyString(exact)) {
    return exact.trim();
  }

  const fallback = map[fallbackLocale];
  if (isNonEmptyString(fallback)) {
    return fallback.trim();
  }

  return "";
}

function resolveWorkspacePath(workspaceRoot, maybeRelativePath) {
  if (!isNonEmptyString(maybeRelativePath)) {
    return "";
  }

  return path.isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : path.join(workspaceRoot, maybeRelativePath);
}

function listLocaleDirectories(uploadRoot) {
  return fs
    .readdirSync(uploadRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function listImageFiles(directoryPath) {
  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .filter((fileName) => /\.(png|jpg|jpeg)$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function inferMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      throw new Error(`Unsupported image type: ${filePath}`);
  }
}

function assertFileExists(filePath, label) {
  if (!isNonEmptyString(filePath) || !fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function loadServiceAccount(options) {
  if (isNonEmptyString(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)) {
    return JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  }

  if (!isNonEmptyString(options.serviceAccountJsonPath)) {
    throw new Error(
      "Missing service account JSON. Set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH or pass --service-account-json.",
    );
  }

  return readJson(options.serviceAccountJsonPath);
}

async function getAccessToken(serviceAccount) {
  const tokenUri = serviceAccount.token_uri || "https://oauth2.googleapis.com/token";
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: DEFAULT_SCOPE,
    aud: tokenUri,
    exp: expiresAt,
    iat: issuedAt,
  };

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload),
  )}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  const assertion = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to acquire Google OAuth token (${response.status}): ${body}`);
  }

  const payloadJson = await response.json();
  if (!isNonEmptyString(payloadJson.access_token)) {
    throw new Error("Google OAuth response did not contain an access token.");
  }

  return payloadJson.access_token;
}

async function googleApiRequest(accessToken, method, url, body, extraHeaders = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    ...extraHeaders,
  };

  const init = {
    method,
    headers,
  };

  if (body !== undefined) {
    init.body = body;
  }

  const response = await fetch(url, init);
  const responseText = await response.text();
  const isJson =
    response.headers.get("content-type")?.toLowerCase().includes("application/json") ?? false;
  const payload = isJson && responseText ? JSON.parse(responseText) : responseText;

  if (!response.ok) {
    const message =
      typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    throw new Error(`${method} ${url} failed (${response.status}): ${message}`);
  }

  return payload;
}

function buildLocalePlans(config, workspaceRoot, languageFilter) {
  const googlePlay = config.googlePlay ?? {};
  const release = googlePlay.release ?? {};
  const storeListing = googlePlay.storeListing ?? {};
  const appDetails = googlePlay.appDetails ?? {};
  const assets = googlePlay.assets ?? {};
  const fallbackLocale = storeListing.defaultMetadataLocale ?? "en";
  const uploadRoot = resolveWorkspacePath(workspaceRoot, assets.phoneScreenshotsDir || "upload");
  const localeDirectories = listLocaleDirectories(uploadRoot).filter((locale) => {
    return languageFilter.length === 0 || languageFilter.includes(locale);
  });

  const iconPath = resolveWorkspacePath(workspaceRoot, assets.iconPath ?? "");
  const featureGraphicPath = resolveWorkspacePath(
    workspaceRoot,
    assets.featureGraphicPath ?? "",
  );
  const videoMap =
    storeListing.video && typeof storeListing.video === "object" ? storeListing.video : {};

  const plans = localeDirectories.map((playLocale) => {
    const copyLocale = mapUploadLocaleToCopyLocale(playLocale);
    const localeDir = path.join(uploadRoot, playLocale);
    const screenshots = listImageFiles(localeDir).map((fileName) =>
      path.join(localeDir, fileName),
    );

    return {
      playLocale,
      copyLocale,
      localeDir,
      listing: {
        language: playLocale,
        title: getLocalizedValue(storeListing.title, copyLocale, fallbackLocale),
        shortDescription: getLocalizedValue(
          storeListing.shortDescription,
          copyLocale,
          fallbackLocale,
        ),
        fullDescription: getLocalizedValue(
          storeListing.fullDescription,
          copyLocale,
          fallbackLocale,
        ),
        video: getLocalizedValue(videoMap, copyLocale, fallbackLocale),
      },
      screenshots,
      iconPath,
      featureGraphicPath,
      releaseCopy: release.screenshots?.[copyLocale] ?? [],
    };
  });

  return {
    uploadRoot,
    appDetails,
    assets,
    fallbackLocale,
    plans,
  };
}

function validateAutomatableConfig(configJsonPath, config, planBundle, packageName) {
  const errors = [];
  const workspaceRoot = path.dirname(configJsonPath);
  const appDetails = config.googlePlay?.appDetails ?? {};

  if (!isNonEmptyString(packageName)) {
    errors.push("googlePlay.appDetails.packageName is missing.");
  }
  if (!isNonEmptyString(appDetails.defaultLanguage)) {
    errors.push("googlePlay.appDetails.defaultLanguage is missing.");
  }
  if (!isNonEmptyString(appDetails.contactEmail)) {
    errors.push("googlePlay.appDetails.contactEmail is missing.");
  }

  if (!fs.existsSync(planBundle.uploadRoot)) {
    errors.push(`Phone screenshot root does not exist: ${planBundle.uploadRoot}`);
  }

  if (!isNonEmptyString(planBundle.assets.iconPath)) {
    errors.push("googlePlay.assets.iconPath is missing.");
  } else {
    const iconPath = resolveWorkspacePath(workspaceRoot, planBundle.assets.iconPath);
    if (!fs.existsSync(iconPath)) {
      errors.push(`Play icon asset does not exist: ${iconPath}`);
    }
  }

  if (planBundle.plans.length === 0) {
    errors.push("No Play locale directories were found under the screenshot upload root.");
  }

  for (const localePlan of planBundle.plans) {
    if (!isNonEmptyString(localePlan.listing.title)) {
      errors.push(`Missing title text for locale: ${localePlan.playLocale}`);
    }
    if (!isNonEmptyString(localePlan.listing.shortDescription)) {
      errors.push(`Missing shortDescription text for locale: ${localePlan.playLocale}`);
    }
    if (!isNonEmptyString(localePlan.listing.fullDescription)) {
      errors.push(`Missing fullDescription text for locale: ${localePlan.playLocale}`);
    }
    if (localePlan.screenshots.length === 0) {
      errors.push(`No screenshots found for locale: ${localePlan.playLocale}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

function printPlan(packageName, planBundle, manualOnly, validateOnly) {
  console.log(`Package name: ${packageName}`);
  console.log(`Default language: ${planBundle.appDetails.defaultLanguage}`);
  console.log(`Mode: ${validateOnly ? "validate edit" : "commit edit"}`);
  console.log(`Locales: ${planBundle.plans.length}`);

  for (const localePlan of planBundle.plans) {
    console.log(
      `- ${localePlan.playLocale} <- ${localePlan.copyLocale} | screenshots=${localePlan.screenshots.length} | title="${localePlan.listing.title}"`,
    );
  }

  if (manualOnly && typeof manualOnly === "object") {
    console.log("Manual-only Play Console fields:");
    for (const [key, value] of Object.entries(manualOnly)) {
      const rendered =
        value === null || value === undefined || value === ""
          ? "(unset)"
          : typeof value === "string"
            ? value
            : JSON.stringify(value);
      console.log(`- ${key}: ${rendered}`);
    }
  }
}

async function createEdit(accessToken, packageName) {
  const payload = await googleApiRequest(
    accessToken,
    "POST",
    `${ANDROID_PUBLISHER_BASE}/applications/${encodeURIComponent(packageName)}/edits`,
    "{}",
    {
      "Content-Type": "application/json",
    },
  );

  if (!isNonEmptyString(payload.id)) {
    throw new Error("Google Play edit creation did not return an edit id.");
  }

  return payload.id;
}

async function patchAppDetails(accessToken, packageName, editId, appDetails) {
  const body = {
    defaultLanguage: appDetails.defaultLanguage,
    contactWebsite: appDetails.contactWebsite,
    contactEmail: appDetails.contactEmail,
  };

  if (isNonEmptyString(appDetails.contactPhone)) {
    body.contactPhone = appDetails.contactPhone;
  }

  await googleApiRequest(
    accessToken,
    "PATCH",
    `${ANDROID_PUBLISHER_BASE}/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}/details`,
    JSON.stringify(body),
    {
      "Content-Type": "application/json",
    },
  );
}

async function upsertListing(accessToken, packageName, editId, listing) {
  const body = {
    language: listing.language,
    title: listing.title,
    shortDescription: listing.shortDescription,
    fullDescription: listing.fullDescription,
  };

  if (isNonEmptyString(listing.video)) {
    body.video = listing.video;
  }

  await googleApiRequest(
    accessToken,
    "PUT",
    `${ANDROID_PUBLISHER_BASE}/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}/listings/${encodeURIComponent(listing.language)}`,
    JSON.stringify(body),
    {
      "Content-Type": "application/json",
    },
  );
}

async function deleteAllImages(accessToken, packageName, editId, language, imageType) {
  await googleApiRequest(
    accessToken,
    "DELETE",
    `${ANDROID_PUBLISHER_BASE}/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}/listings/${encodeURIComponent(language)}/${imageType}`,
  );
}

async function uploadImage(accessToken, packageName, editId, language, imageType, filePath) {
  const data = fs.readFileSync(filePath);
  await googleApiRequest(
    accessToken,
    "POST",
    `${ANDROID_PUBLISHER_UPLOAD_BASE}/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}/listings/${encodeURIComponent(language)}/${imageType}`,
    data,
    {
      "Content-Type": inferMimeType(filePath),
      "Content-Length": String(data.byteLength),
    },
  );
}

async function finalizeEdit(accessToken, packageName, editId, validateOnly) {
  const endpoint = validateOnly ? "validate" : "commit";
  await googleApiRequest(
    accessToken,
    "POST",
    `${ANDROID_PUBLISHER_BASE}/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}:${endpoint}`,
    "",
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const configJsonPath = path.resolve(options.configJson);
  const workspaceRoot = path.dirname(configJsonPath);
  const config = readJson(configJsonPath);
  const packageName =
    options.packageName || config.googlePlay?.appDetails?.packageName || "";
  const manualOnly = config.googlePlay?.manualOnly ?? {};
  const planBundle = buildLocalePlans(config, workspaceRoot, options.languages);

  validateAutomatableConfig(configJsonPath, config, planBundle, packageName);
  printPlan(packageName, planBundle, manualOnly, options.validateOnly);

  if (options.dryRun) {
    return;
  }

  const serviceAccount = loadServiceAccount(options);
  const accessToken = await getAccessToken(serviceAccount);
  const editId = await createEdit(accessToken, packageName);

  try {
    if (!options.skipDetails) {
      await patchAppDetails(accessToken, packageName, editId, planBundle.appDetails);
      console.log("[ok] Patched app details");
    }

    for (const localePlan of planBundle.plans) {
      if (!options.skipListings) {
        await upsertListing(accessToken, packageName, editId, localePlan.listing);
        console.log(`[ok] Updated listing: ${localePlan.playLocale}`);
      }

      if (!options.skipImages) {
        if (!options.skipIcon) {
          assertFileExists(localePlan.iconPath, "Play icon asset");
          await deleteAllImages(
            accessToken,
            packageName,
            editId,
            localePlan.playLocale,
            "icon",
          );
          await uploadImage(
            accessToken,
            packageName,
            editId,
            localePlan.playLocale,
            "icon",
            localePlan.iconPath,
          );
          console.log(`[ok] Uploaded icon: ${localePlan.playLocale}`);
        }

        if (!options.skipFeatureGraphic && isNonEmptyString(localePlan.featureGraphicPath)) {
          assertFileExists(localePlan.featureGraphicPath, "Play feature graphic asset");
          await deleteAllImages(
            accessToken,
            packageName,
            editId,
            localePlan.playLocale,
            "featureGraphic",
          );
          await uploadImage(
            accessToken,
            packageName,
            editId,
            localePlan.playLocale,
            "featureGraphic",
            localePlan.featureGraphicPath,
          );
          console.log(`[ok] Uploaded feature graphic: ${localePlan.playLocale}`);
        }

        if (!options.skipScreenshots) {
          await deleteAllImages(
            accessToken,
            packageName,
            editId,
            localePlan.playLocale,
            "phoneScreenshots",
          );
          for (const screenshotPath of localePlan.screenshots) {
            await uploadImage(
              accessToken,
              packageName,
              editId,
              localePlan.playLocale,
              "phoneScreenshots",
              screenshotPath,
            );
          }
          console.log(
            `[ok] Uploaded phone screenshots: ${localePlan.playLocale} (${localePlan.screenshots.length})`,
          );
        }
      }
    }

    await finalizeEdit(accessToken, packageName, editId, options.validateOnly);
    console.log(options.validateOnly ? "[ok] Validated edit" : "[ok] Committed edit");
  } catch (error) {
    await googleApiRequest(
      accessToken,
      "DELETE",
      `${ANDROID_PUBLISHER_BASE}/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}`,
    ).catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

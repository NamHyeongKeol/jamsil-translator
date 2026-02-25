import { createHmac, randomUUID, timingSafeEqual } from "crypto";

const TOKEN_VERSION = 1;
const TOKEN_TTL_SECONDS = 90;
const TOKEN_MAX_AGE_SKEW_SECONDS = 30;
const SAFE_CALLBACK_ORIGIN = "https://mingle.local";
const FALLBACK_CALLBACK_PATH = "/";

export type NativeOAuthProvider = "apple" | "google";

export type NativeAuthBridgeTokenPayload = {
  v: number;
  sub: string;
  name: string;
  email: string;
  provider: NativeOAuthProvider;
  callbackUrl: string;
  iat: number;
  exp: number;
};

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, maxLength);
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function getAuthSecret(): string {
  const authSecret = process.env.AUTH_SECRET?.trim() ?? "";
  if (authSecret) return authSecret;

  const nextAuthSecret = process.env.NEXTAUTH_SECRET?.trim() ?? "";
  if (nextAuthSecret) return nextAuthSecret;

  throw new Error("native_auth_secret_missing");
}

function signPayload(encodedPayload: string, secret: string): string {
  const digest = createHmac("sha256", secret)
    .update(`${TOKEN_VERSION}.${encodedPayload}`)
    .digest();
  return encodeBase64Url(digest);
}

function buildSafeFallbackSubject(provider: NativeOAuthProvider): string {
  return `native_${provider}_${randomUUID().replaceAll("-", "")}`;
}

export function resolveNativeOAuthProvider(rawValue: string | null | undefined): NativeOAuthProvider | null {
  if (typeof rawValue !== "string") return null;
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "google" || normalized === "apple") {
    return normalized;
  }
  return null;
}

export function resolveSafeCallbackPath(
  rawValue: string | null | undefined,
  fallback: string = FALLBACK_CALLBACK_PATH,
): string {
  const fallbackPath = resolveSafeCallbackPathInternal(fallback) ?? FALLBACK_CALLBACK_PATH;
  const candidate = resolveSafeCallbackPathInternal(rawValue ?? "");
  return candidate ?? fallbackPath;
}

function resolveSafeCallbackPathInternal(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//")) return null;

  try {
    const parsed = new URL(trimmed, SAFE_CALLBACK_ORIGIN);
    if (parsed.origin !== SAFE_CALLBACK_ORIGIN) return null;
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!normalized.startsWith("/")) return null;
    if (normalized.startsWith("//")) return null;
    return normalized;
  } catch {
    return null;
  }
}

type CreateNativeAuthBridgeTokenArgs = {
  sub: string;
  name: string;
  email: string;
  provider: NativeOAuthProvider;
  callbackUrl: string;
};

export function createNativeAuthBridgeToken(args: CreateNativeAuthBridgeTokenArgs): string {
  const secret = getAuthSecret();
  const now = Math.floor(Date.now() / 1000);
  const subject = normalizeText(args.sub, 256) || buildSafeFallbackSubject(args.provider);
  const name = normalizeText(args.name, 128) || "Mingle User";
  const email = normalizeText(args.email, 256).toLowerCase();
  const callbackUrl = resolveSafeCallbackPath(args.callbackUrl, FALLBACK_CALLBACK_PATH);

  const payload: NativeAuthBridgeTokenPayload = {
    v: TOKEN_VERSION,
    sub: subject,
    name,
    email,
    provider: args.provider,
    callbackUrl,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };

  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyNativeAuthBridgeToken(token: string): NativeAuthBridgeTokenPayload | null {
  try {
    const secret = getAuthSecret();
    const [encodedPayload, encodedSignature, extra] = token.split(".");
    if (!encodedPayload || !encodedSignature || extra) return null;

    const expectedSignature = signPayload(encodedPayload, secret);
    const expectedBuffer = decodeBase64Url(expectedSignature);
    const actualBuffer = decodeBase64Url(encodedSignature);
    if (expectedBuffer.length !== actualBuffer.length) return null;
    if (!timingSafeEqual(expectedBuffer, actualBuffer)) return null;

    const parsed = JSON.parse(decodeBase64Url(encodedPayload).toString("utf8")) as Partial<NativeAuthBridgeTokenPayload>;
    const provider = resolveNativeOAuthProvider(parsed.provider);
    if (!provider) return null;

    const sub = normalizeText(parsed.sub, 256);
    if (!sub) return null;
    const name = normalizeText(parsed.name, 128) || "Mingle User";
    const email = normalizeText(parsed.email, 256).toLowerCase();
    const callbackUrl = resolveSafeCallbackPath(parsed.callbackUrl, FALLBACK_CALLBACK_PATH);
    const issuedAt = Number(parsed.iat);
    const expiresAt = Number(parsed.exp);
    if (!Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)) return null;
    if (Number(parsed.v) !== TOKEN_VERSION) return null;

    const now = Math.floor(Date.now() / 1000);
    if (issuedAt > now + TOKEN_MAX_AGE_SKEW_SECONDS) return null;
    if (expiresAt <= now - TOKEN_MAX_AGE_SKEW_SECONDS) return null;
    if (expiresAt <= issuedAt) return null;

    return {
      v: TOKEN_VERSION,
      sub,
      name,
      email,
      provider,
      callbackUrl,
      iat: issuedAt,
      exp: expiresAt,
    };
  } catch {
    return null;
  }
}

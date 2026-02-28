import { createPublicKey, createVerify } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createNativeAuthBridgeToken, resolveNativeAuthRequestId, resolveSafeCallbackPath } from "@/lib/native-auth-bridge";
import { savePendingNativeAuthResult } from "@/lib/native-auth-pending-store";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_JWKS_CACHE_TTL_MS = 60 * 60 * 1000;
const APPLE_TOKEN_CLOCK_SKEW_SECONDS = 120;

type AppleJwk = {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n: string;
  e: string;
};

type AppleIdentityTokenPayload = {
  iss: string;
  aud: string | string[];
  sub: string;
  email?: string;
  exp: number;
  iat: number;
};

type ExchangeRequestBody = {
  idToken?: unknown;
  authorizationCode?: unknown;
  callbackUrl?: unknown;
  requestId?: unknown;
  name?: unknown;
  email?: unknown;
};

let appleJwksCache: {
  keys: AppleJwk[];
  expiresAtMs: number;
} = {
  keys: [],
  expiresAtMs: 0,
};

function normalizeText(rawValue: unknown, maxLength: number): string {
  if (typeof rawValue !== "string") return "";
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, maxLength);
}

function normalizeEmail(rawValue: unknown): string {
  return normalizeText(rawValue, 256).toLowerCase();
}

function deriveNameFromEmail(email: string): string {
  const localPart = email.split("@")[0]?.trim();
  if (!localPart) return "Mingle User";
  const label = localPart.replace(/[._-]+/g, " ").trim();
  if (!label) return "Mingle User";
  return label.slice(0, 128);
}

function resolveAllowedAppleAudiences(): Set<string> {
  const configured = [
    process.env.AUTH_APPLE_NATIVE_AUDIENCES,
    process.env.AUTH_APPLE_NATIVE_ID,
    process.env.AUTH_APPLE_BUNDLE_ID,
    process.env.AUTH_APPLE_ID,
  ]
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  // AUTH_APPLE_ID가 web Service ID인 경우, native 번들 ID variant(.rn, .native 등)도 자동으로 허용.
  // iOS native Apple sign-in의 aud 클레임은 번들 ID이므로 Service ID와 다를 수 있음.
  const baseIds = [
    process.env.AUTH_APPLE_ID,
    process.env.AUTH_APPLE_NATIVE_ID,
    process.env.AUTH_APPLE_BUNDLE_ID,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  const derivedVariants: string[] = [];
  for (const baseId of baseIds) {
    // .rn, .native suffix variant 자동 추가 (없는 경우만)
    for (const suffix of [".rn", ".native", ".app"]) {
      const variant = `${baseId}${suffix}`;
      if (!configured.includes(variant)) {
        derivedVariants.push(variant);
      }
    }
  }

  return new Set([...configured, ...derivedVariants]);
}

function decodeJwtSegment<T extends Record<string, unknown>>(segment: string): T | null {
  try {
    const decoded = Buffer.from(segment, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as T;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function isTokenExpired(payload: AppleIdentityTokenPayload): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || !Number.isFinite(payload.iat)) {
    return true;
  }
  if (payload.exp <= now - APPLE_TOKEN_CLOCK_SKEW_SECONDS) {
    return true;
  }
  if (payload.iat > now + APPLE_TOKEN_CLOCK_SKEW_SECONDS) {
    return true;
  }
  return false;
}

async function loadAppleJwks(): Promise<AppleJwk[]> {
  const now = Date.now();
  if (appleJwksCache.keys.length > 0 && appleJwksCache.expiresAtMs > now) {
    return appleJwksCache.keys;
  }

  const response = await fetch(APPLE_JWKS_URL, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`apple_jwks_fetch_failed_${response.status}`);
  }

  const payload = (await response.json()) as { keys?: unknown };
  const keys = Array.isArray(payload.keys)
    ? payload.keys.filter((item): item is AppleJwk => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<AppleJwk>;
      return Boolean(
        typeof candidate.kty === "string"
          && typeof candidate.kid === "string"
          && typeof candidate.n === "string"
          && typeof candidate.e === "string",
      );
    })
    : [];

  if (keys.length === 0) {
    throw new Error("apple_jwks_empty");
  }

  appleJwksCache = {
    keys,
    expiresAtMs: now + APPLE_JWKS_CACHE_TTL_MS,
  };

  return keys;
}

function verifyAppleJwtSignature(args: {
  signingInput: string;
  signatureSegment: string;
  key: AppleJwk;
}): boolean {
  try {
    const publicKey = createPublicKey({
      key: {
        kty: "RSA",
        n: args.key.n,
        e: args.key.e,
      },
      format: "jwk",
    });
    const signature = Buffer.from(args.signatureSegment, "base64url");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(args.signingInput);
    verifier.end();
    return verifier.verify(publicKey, signature);
  } catch {
    return false;
  }
}

async function verifyAppleIdentityToken(idToken: string): Promise<AppleIdentityTokenPayload | null> {
  const segments = idToken.split(".");
  if (segments.length !== 3) {
    return null;
  }

  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (!headerSegment || !payloadSegment || !signatureSegment) {
    return null;
  }

  const header = decodeJwtSegment<{ alg?: string; kid?: string }>(headerSegment);
  if (!header) {
    return null;
  }
  if (header.alg !== "RS256") {
    return null;
  }
  const keyId = normalizeText(header.kid, 128);
  if (!keyId) {
    return null;
  }

  const payload = decodeJwtSegment<Partial<AppleIdentityTokenPayload>>(payloadSegment);
  if (!payload) {
    return null;
  }

  const keys = await loadAppleJwks();
  const key = keys.find((candidate) => candidate.kid === keyId && candidate.kty === "RSA");
  if (!key) {
    return null;
  }

  const signatureValid = verifyAppleJwtSignature({
    signingInput: `${headerSegment}.${payloadSegment}`,
    signatureSegment,
    key,
  });
  if (!signatureValid) {
    return null;
  }

  const issuer = normalizeText(payload.iss, 256);
  if (issuer !== "https://appleid.apple.com") {
    return null;
  }

  const subject = normalizeText(payload.sub, 256);
  if (!subject) {
    return null;
  }

  const audienceClaim = payload.aud;
  const audiences = Array.isArray(audienceClaim)
    ? audienceClaim.filter((value): value is string => typeof value === "string")
    : typeof audienceClaim === "string"
      ? [audienceClaim]
      : [];
  if (audiences.length === 0) {
    return null;
  }

  const allowedAudiences = resolveAllowedAppleAudiences();
  if (allowedAudiences.size === 0) {
    throw new Error("native_auth_apple_audience_not_configured");
  }
  if (!audiences.some((value) => allowedAudiences.has(value))) {
    return null;
  }

  const exp = Number(payload.exp);
  const iat = Number(payload.iat);
  const verifiedPayload: AppleIdentityTokenPayload = {
    iss: issuer,
    aud: audiences,
    sub: subject,
    email: normalizeEmail(payload.email),
    exp,
    iat,
  };
  if (isTokenExpired(verifiedPayload)) {
    return null;
  }

  return verifiedPayload;
}

async function upsertNativeAppleUser(args: {
  appleSubject: string;
  email: string;
  name: string;
}) {
  const now = new Date();
  const externalUserId = `apple:${args.appleSubject}`.slice(0, 128);
  const displayName = args.name || "Mingle User";

  const existingByExternal = await prisma.user.findUnique({
    where: { externalUserId },
    select: { id: true, email: true, name: true },
  });
  if (existingByExternal) {
    return prisma.user.update({
      where: { id: existingByExternal.id },
      data: {
        name: displayName,
        email: args.email || undefined,
        lastSeenAt: now,
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });
  }

  if (args.email) {
    const existingByEmail = await prisma.user.findUnique({
      where: { email: args.email },
      select: { id: true },
    });
    if (existingByEmail) {
      return prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          name: displayName,
          externalUserId,
          lastSeenAt: now,
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });
    }
  }

  return prisma.user.create({
    data: {
      name: displayName,
      email: args.email || undefined,
      externalUserId,
      firstSeenAt: now,
      lastSeenAt: now,
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ExchangeRequestBody | null;
  const callbackUrl = resolveSafeCallbackPath(normalizeText(body?.callbackUrl, 2048), "/");
  const requestId = resolveNativeAuthRequestId(normalizeText(body?.requestId, 256));

  const fail = async (message: string, status: number = 400) => {
    if (requestId) {
      await savePendingNativeAuthResult(requestId, {
        status: "error",
        provider: "apple",
        callbackUrl,
        message,
      });
    }
    return NextResponse.json(
      {
        status: "error",
        provider: "apple",
        callbackUrl,
        message,
      },
      { status },
    );
  };

  const idToken = normalizeText(body?.idToken, 8192);
  if (!idToken) {
    return fail("native_auth_missing_apple_identity_token", 400);
  }

  let tokenPayload: AppleIdentityTokenPayload | null = null;
  try {
    tokenPayload = await verifyAppleIdentityToken(idToken);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[native-auth/apple/exchange] verification failure reason=${reason}`);
    if (reason === "native_auth_apple_audience_not_configured") {
      return fail("native_auth_apple_audience_not_configured", 500);
    }
    return fail("native_auth_invalid_apple_identity_token", 401);
  }
  if (!tokenPayload) {
    return fail("native_auth_invalid_apple_identity_token", 401);
  }

  const emailFromToken = normalizeEmail(tokenPayload.email);
  const emailFromBody = normalizeEmail(body?.email);
  if (emailFromBody && emailFromToken && emailFromBody !== emailFromToken) {
    return fail("native_auth_email_mismatch", 400);
  }
  const email = emailFromToken;
  const name = normalizeText(body?.name, 128) || deriveNameFromEmail(emailFromToken || emailFromBody);

  let user: {
    id: string;
    name: string | null;
    email: string | null;
  };
  try {
    user = await upsertNativeAppleUser({
      appleSubject: tokenPayload.sub,
      email,
      name,
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[native-auth/apple/exchange] user upsert failed reason=${reason}`);
    return fail("native_auth_user_upsert_failed", 500);
  }

  let bridgeToken = "";
  try {
    bridgeToken = createNativeAuthBridgeToken({
      sub: user.id,
      name: normalizeText(user.name, 128) || "Mingle User",
      email: normalizeEmail(user.email) || email,
      provider: "apple",
      callbackUrl,
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[native-auth/apple/exchange] bridge token failed reason=${reason}`);
    return fail("native_auth_bridge_token_failed", 500);
  }

  if (requestId) {
    await savePendingNativeAuthResult(requestId, {
      status: "success",
      provider: "apple",
      callbackUrl,
      bridgeToken,
    });
  }

  return NextResponse.json({
    status: "success",
    provider: "apple",
    callbackUrl,
    bridgeToken,
  });
}

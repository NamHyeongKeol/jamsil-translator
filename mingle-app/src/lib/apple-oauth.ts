import { createSign } from "crypto";

const APPLE_AUDIENCE = "https://appleid.apple.com";
const APPLE_CLIENT_SECRET_MAX_TTL_SECONDS = 60 * 60 * 24 * 180;
const APPLE_CLIENT_SECRET_DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 179;

type AppleClientSecretInput = {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
  ttlSeconds?: number;
  nowEpochSeconds?: number;
};

export type AppleOAuthCredentials = {
  clientId: string;
  clientSecret: string;
  source: "static_secret" | "generated_secret";
};

function base64UrlEncode(input: Buffer | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeEscapedMultilineText(value: string): string {
  return value.replace(/\\n/g, "\n");
}

function normalizePrivateKey(rawValue: string): string {
  return decodeEscapedMultilineText(rawValue).trim();
}

function parseTtlSeconds(rawValue: string | undefined): number {
  if (!rawValue) return APPLE_CLIENT_SECRET_DEFAULT_TTL_SECONDS;
  const parsed = Number.parseInt(rawValue.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return APPLE_CLIENT_SECRET_DEFAULT_TTL_SECONDS;
  }
  return Math.min(parsed, APPLE_CLIENT_SECRET_MAX_TTL_SECONDS);
}

function parseNowEpochSeconds(rawValue: number | undefined): number {
  if (typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > 0) {
    return Math.floor(rawValue);
  }
  return Math.floor(Date.now() / 1000);
}

export function createAppleClientSecret(input: AppleClientSecretInput): string {
  const now = parseNowEpochSeconds(input.nowEpochSeconds);
  const ttlSeconds = typeof input.ttlSeconds === "number"
    ? Math.min(Math.max(Math.floor(input.ttlSeconds), 1), APPLE_CLIENT_SECRET_MAX_TTL_SECONDS)
    : APPLE_CLIENT_SECRET_DEFAULT_TTL_SECONDS;

  const header = base64UrlEncode(
    JSON.stringify({
      alg: "ES256",
      kid: input.keyId,
      typ: "JWT",
    }),
  );
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: input.teamId,
      iat: now,
      exp: now + ttlSeconds,
      aud: APPLE_AUDIENCE,
      sub: input.clientId,
    }),
  );

  const signingInput = `${header}.${payload}`;
  const signature = createSign("SHA256")
    .update(signingInput)
    .end()
    .sign({
      key: normalizePrivateKey(input.privateKey),
      dsaEncoding: "ieee-p1363",
    });

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

type ResolveAppleOAuthCredentialsInput = {
  env?: Record<string, string | undefined>;
  nowEpochSeconds?: number;
};

export function resolveAppleOAuthCredentials(
  input: ResolveAppleOAuthCredentialsInput = {},
): AppleOAuthCredentials | null {
  const env = input.env ?? process.env;
  const clientId = (env.AUTH_APPLE_ID || "").trim();
  const staticSecret = (env.AUTH_APPLE_SECRET || "").trim();

  if (!clientId) {
    return null;
  }
  if (staticSecret) {
    return {
      clientId,
      clientSecret: staticSecret,
      source: "static_secret",
    };
  }

  const teamId = (env.AUTH_APPLE_TEAM_ID || "").trim();
  const keyId = (env.AUTH_APPLE_KEY_ID || "").trim();
  const privateKey = (env.AUTH_APPLE_PRIVATE_KEY || "").trim();
  if (!teamId || !keyId || !privateKey) {
    return null;
  }

  const ttlSeconds = parseTtlSeconds(env.AUTH_APPLE_CLIENT_SECRET_TTL_SECONDS);
  const clientSecret = createAppleClientSecret({
    clientId,
    teamId,
    keyId,
    privateKey,
    ttlSeconds,
    nowEpochSeconds: input.nowEpochSeconds,
  });

  return {
    clientId,
    clientSecret,
    source: "generated_secret",
  };
}

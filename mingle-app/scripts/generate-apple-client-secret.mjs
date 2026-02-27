#!/usr/bin/env node
import { createSign } from "crypto";

const APPLE_AUDIENCE = "https://appleid.apple.com";
const MAX_TTL_SECONDS = 60 * 60 * 24 * 180;
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 179;

function fail(message) {
  console.error(`[apple-secret] ${message}`);
  process.exit(1);
}

function requireEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) fail(`${name} is required`);
  return value;
}

function base64UrlEncode(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizePrivateKey(rawValue) {
  return rawValue
    .replace(/\\\\r\\\\n/g, "\n")
    .replace(/\\\\n/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();
}

function parseTtlSeconds(rawValue) {
  if (!rawValue) return DEFAULT_TTL_SECONDS;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(parsed, MAX_TTL_SECONDS);
}

const clientId = requireEnv("AUTH_APPLE_ID");
const teamId = requireEnv("AUTH_APPLE_TEAM_ID");
const keyId = requireEnv("AUTH_APPLE_KEY_ID");
const privateKey = normalizePrivateKey(requireEnv("AUTH_APPLE_PRIVATE_KEY"));
const ttlSeconds = parseTtlSeconds((process.env.AUTH_APPLE_CLIENT_SECRET_TTL_SECONDS || "").trim());
const nowEpochSeconds = Math.floor(Date.now() / 1000);

const header = base64UrlEncode(
  JSON.stringify({
    alg: "ES256",
    kid: keyId,
    typ: "JWT",
  }),
);
const payload = base64UrlEncode(
  JSON.stringify({
    iss: teamId,
    iat: nowEpochSeconds,
    exp: nowEpochSeconds + ttlSeconds,
    aud: APPLE_AUDIENCE,
    sub: clientId,
  }),
);
const signingInput = `${header}.${payload}`;

const signature = createSign("SHA256")
  .update(signingInput)
  .end()
  .sign({
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
const clientSecret = `${signingInput}.${base64UrlEncode(signature)}`;

console.log(`AUTH_APPLE_SECRET=${clientSecret}`);
console.log(`expires_at=${new Date((nowEpochSeconds + ttlSeconds) * 1000).toISOString()}`);

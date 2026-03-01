import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";

const PASSWORD_HASH_ALGO = "pbkdf2_sha256";
const PASSWORD_HASH_ITERATIONS = 210_000;
const PASSWORD_HASH_KEY_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 8;

function encodeBase64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function decodeBase64Url(value: string): Buffer | null {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

export function normalizeEmail(rawValue: unknown): string {
  if (typeof rawValue !== "string") return "";
  return rawValue.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validatePassword(value: string): boolean {
  return value.trim().length >= MIN_PASSWORD_LENGTH;
}

export function hashPassword(password: string): string {
  const trimmed = password.trim();
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(
    trimmed,
    salt,
    PASSWORD_HASH_ITERATIONS,
    PASSWORD_HASH_KEY_LENGTH,
    "sha256",
  );

  return [
    PASSWORD_HASH_ALGO,
    String(PASSWORD_HASH_ITERATIONS),
    encodeBase64Url(salt),
    encodeBase64Url(derived),
  ].join("$");
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const [algo, iterationsRaw, saltRaw, digestRaw] = passwordHash.split("$");
  if (algo !== PASSWORD_HASH_ALGO) return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const salt = decodeBase64Url(saltRaw || "");
  const digest = decodeBase64Url(digestRaw || "");
  if (!salt || !digest || digest.length !== PASSWORD_HASH_KEY_LENGTH) return false;

  const derived = pbkdf2Sync(password.trim(), salt, iterations, digest.length, "sha256");
  if (derived.length !== digest.length) return false;

  return timingSafeEqual(derived, digest);
}

export function createOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}


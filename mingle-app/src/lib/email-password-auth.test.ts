import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  validatePassword,
  verifyPassword,
} from "@/lib/email-password-auth";

describe("email-password-auth", () => {
  it("normalizes email by trimming and lowercasing", () => {
    expect(normalizeEmail("  User@Example.com ")).toBe("user@example.com");
    expect(normalizeEmail(null)).toBe("");
  });

  it("validates basic email format", () => {
    expect(isValidEmail("member@example.com")).toBe(true);
    expect(isValidEmail("invalid-email")).toBe(false);
    expect(isValidEmail("user@domain")).toBe(false);
  });

  it("enforces minimum password length after trim", () => {
    expect(validatePassword(" 12345678 ")).toBe(true);
    expect(validatePassword(" 1234567 ")).toBe(false);
  });

  it("hashes and verifies passwords", () => {
    const passwordHash = hashPassword("  password123  ");

    expect(passwordHash.startsWith("pbkdf2_sha256$")).toBe(true);
    expect(verifyPassword("password123", passwordHash)).toBe(true);
    expect(verifyPassword("wrong-password", passwordHash)).toBe(false);
  });

  it("returns false for malformed password hash", () => {
    expect(verifyPassword("password123", "invalid")).toBe(false);
    expect(verifyPassword("password123", "sha256$100$abc$def")).toBe(false);
    expect(verifyPassword("password123", "pbkdf2_sha256$bad$abc$def")).toBe(false);
  });

  it("creates URL-safe opaque tokens", () => {
    const token = createOpaqueToken(16);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThan(0);
  });

  it("hashes opaque tokens with sha256 hex digest", () => {
    const token = "token_for_hashing";
    const expected = createHash("sha256").update(token).digest("hex");

    expect(hashOpaqueToken(token)).toBe(expected);
  });
});

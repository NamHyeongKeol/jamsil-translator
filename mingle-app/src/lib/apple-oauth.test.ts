import { generateKeyPairSync } from "crypto";
import { describe, expect, it } from "vitest";
import { createAppleClientSecret, resolveAppleOAuthCredentials } from "@/lib/apple-oauth";

function decodeBase64UrlToJson(segment: string): Record<string, unknown> {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
}

describe("apple-oauth", () => {
  it("creates a JWT Apple client secret with expected claims", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const nowEpochSeconds = 1_700_000_000;

    const token = createAppleClientSecret({
      clientId: "com.mingle.web",
      teamId: "TEAM123456",
      keyId: "KEY1234567",
      privateKey: privateKeyPem,
      ttlSeconds: 3600,
      nowEpochSeconds,
    });

    const segments = token.split(".");
    expect(segments).toHaveLength(3);

    const header = decodeBase64UrlToJson(segments[0]);
    const payload = decodeBase64UrlToJson(segments[1]);

    expect(header.alg).toBe("ES256");
    expect(header.kid).toBe("KEY1234567");
    expect(payload.iss).toBe("TEAM123456");
    expect(payload.sub).toBe("com.mingle.web");
    expect(payload.aud).toBe("https://appleid.apple.com");
    expect(payload.iat).toBe(nowEpochSeconds);
    expect(payload.exp).toBe(nowEpochSeconds + 3600);
  });

  it("prefers AUTH_APPLE_SECRET when provided", () => {
    const credentials = resolveAppleOAuthCredentials({
      env: {
        AUTH_APPLE_ID: "com.mingle.web",
        AUTH_APPLE_SECRET: "static_secret_value",
      },
    });

    expect(credentials).toEqual({
      clientId: "com.mingle.web",
      clientSecret: "static_secret_value",
      source: "static_secret",
    });
  });

  it("generates AUTH_APPLE_SECRET from key material when static secret is absent", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const credentials = resolveAppleOAuthCredentials({
      env: {
        AUTH_APPLE_ID: "com.mingle.web",
        AUTH_APPLE_TEAM_ID: "TEAM123456",
        AUTH_APPLE_KEY_ID: "KEY1234567",
        AUTH_APPLE_PRIVATE_KEY: privateKeyPem.replace(/\n/g, "\\n"),
        AUTH_APPLE_CLIENT_SECRET_TTL_SECONDS: "600",
      },
      nowEpochSeconds: 1_700_000_000,
    });

    expect(credentials?.source).toBe("generated_secret");
    expect(credentials?.clientId).toBe("com.mingle.web");
    expect(credentials?.clientSecret).toBeTruthy();
    if (!credentials) {
      return;
    }

    const payload = decodeBase64UrlToJson(credentials.clientSecret.split(".")[1]);
    expect(payload.exp).toBe(1_700_000_600);
  });

  it("supports double-escaped newlines in AUTH_APPLE_PRIVATE_KEY", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const credentials = resolveAppleOAuthCredentials({
      env: {
        AUTH_APPLE_ID: "com.mingle.web",
        AUTH_APPLE_TEAM_ID: "TEAM123456",
        AUTH_APPLE_KEY_ID: "KEY1234567",
        AUTH_APPLE_PRIVATE_KEY: privateKeyPem.replace(/\n/g, "\\\\n"),
      },
      nowEpochSeconds: 1_700_000_000,
    });

    expect(credentials?.source).toBe("generated_secret");
    expect(credentials?.clientSecret).toBeTruthy();
  });
});

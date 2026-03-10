import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUserFindUnique,
  mockPasswordResetTokenUpdateMany,
  mockPasswordResetTokenCreate,
  mockTransaction,
  mockTxQueryRaw,
  mockIsResendConfigured,
  mockSendPasswordResetEmail,
  mockCreateOpaqueToken,
  mockHashOpaqueToken,
} = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockPasswordResetTokenUpdateMany: vi.fn(),
  mockPasswordResetTokenCreate: vi.fn(),
  mockTransaction: vi.fn(),
  mockTxQueryRaw: vi.fn(),
  mockIsResendConfigured: vi.fn(),
  mockSendPasswordResetEmail: vi.fn(),
  mockCreateOpaqueToken: vi.fn(),
  mockHashOpaqueToken: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
    },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/resend-email", () => ({
  isResendConfigured: mockIsResendConfigured,
  sendPasswordResetEmail: mockSendPasswordResetEmail,
}));

vi.mock("@/lib/email-password-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email-password-auth")>(
    "@/lib/email-password-auth",
  );
  return {
    ...actual,
    createOpaqueToken: mockCreateOpaqueToken,
    hashOpaqueToken: mockHashOpaqueToken,
  };
});

import { POST } from "@/app/api/auth/forgot-password/route";

type EnvSnapshot = {
  NEXTAUTH_URL?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  EMAIL_RESET_TOKEN_TTL_MINUTES?: string;
};

const originalEnv: EnvSnapshot = {
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  EMAIL_RESET_TOKEN_TTL_MINUTES: process.env.EMAIL_RESET_TOKEN_TTL_MINUTES,
};

function restoreEnvValue(name: keyof EnvSnapshot, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function makeJsonRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest(): Request {
  return new Request("http://localhost:3000/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
}

describe("/api/auth/forgot-password route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    mockIsResendConfigured.mockReturnValue(true);
    mockCreateOpaqueToken.mockReturnValue("raw_token_123");
    mockHashOpaqueToken.mockReturnValue("hashed_token_123");
    mockTransaction.mockImplementation(async (callback: (tx: {
      $queryRaw: (...args: unknown[]) => Promise<unknown>;
      passwordResetToken: {
        updateMany: (args: unknown) => Promise<unknown>;
        create: (args: unknown) => Promise<unknown>;
      };
    }) => Promise<unknown>) => callback({
      $queryRaw: mockTxQueryRaw,
      passwordResetToken: {
        updateMany: mockPasswordResetTokenUpdateMany,
        create: mockPasswordResetTokenCreate,
      },
    }));
    mockTxQueryRaw.mockResolvedValue([{ id: "user_1" }]);
    mockPasswordResetTokenUpdateMany.mockResolvedValue({ count: 0 });
    mockPasswordResetTokenCreate.mockResolvedValue({ id: "token_1" });

    delete process.env.NEXTAUTH_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.EMAIL_RESET_TOKEN_TTL_MINUTES;
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreEnvValue("NEXTAUTH_URL", originalEnv.NEXTAUTH_URL);
    restoreEnvValue("NEXT_PUBLIC_SITE_URL", originalEnv.NEXT_PUBLIC_SITE_URL);
    restoreEnvValue("EMAIL_RESET_TOKEN_TTL_MINUTES", originalEnv.EMAIL_RESET_TOKEN_TTL_MINUTES);
  });

  it("returns 503 when email service is not configured", async () => {
    mockIsResendConfigured.mockReturnValue(false);

    const response = await POST(makeJsonRequest({
      email: "member@example.com",
      locale: "ko",
    }));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toEqual({ error: "email_service_not_configured" });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("returns 400 when payload is invalid JSON", async () => {
    const response = await POST(makeInvalidJsonRequest());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "invalid_payload" });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("validates required and format constraints for email", async () => {
    const missingEmailResponse = await POST(makeJsonRequest({ email: "  " }));
    const missingEmailJson = await missingEmailResponse.json();
    expect(missingEmailResponse.status).toBe(400);
    expect(missingEmailJson).toEqual({ error: "missing_email" });

    const invalidEmailResponse = await POST(makeJsonRequest({ email: "invalid" }));
    const invalidEmailJson = await invalidEmailResponse.json();
    expect(invalidEmailResponse.status).toBe(400);
    expect(invalidEmailJson).toEqual({ error: "invalid_email" });

    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns success without sending email when user does not exist", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const response = await POST(makeJsonRequest({
      email: "Member@Example.com",
      locale: "ko",
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { email: "member@example.com" },
      select: { id: true },
    });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockPasswordResetTokenCreate).not.toHaveBeenCalled();
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("creates token record and sends localized reset email when user exists", async () => {
    const now = new Date("2026-03-02T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    process.env.NEXTAUTH_URL = "https://dev.mingle.test/";
    process.env.EMAIL_RESET_TOKEN_TTL_MINUTES = "45";

    mockUserFindUnique.mockResolvedValue({ id: "user_1" });
    mockSendPasswordResetEmail.mockResolvedValue(undefined);

    const response = await POST(makeJsonRequest({
      email: " Member@Example.com ",
      locale: "ja",
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(mockCreateOpaqueToken).toHaveBeenCalledWith(32);
    expect(mockHashOpaqueToken).toHaveBeenCalledWith("raw_token_123");
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxQueryRaw).toHaveBeenCalledTimes(1);
    expect(mockPasswordResetTokenUpdateMany).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        usedAt: null,
      },
      data: {
        usedAt: now,
      },
    });

    const createCall = mockPasswordResetTokenCreate.mock.calls[0]?.[0] as {
      data: {
        userId: string;
        tokenHash: string;
        expiresAt: Date;
      };
    };
    expect(createCall.data.userId).toBe("user_1");
    expect(createCall.data.tokenHash).toBe("hashed_token_123");
    expect(createCall.data.expiresAt).toBeInstanceOf(Date);
    expect(createCall.data.expiresAt.getTime()).toBe(now.getTime() + 45 * 60_000);

    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith({
      to: "member@example.com",
      resetUrl: "https://dev.mingle.test/ja/auth/reset-password?token=raw_token_123",
    });
  });

  it("falls back to localhost base URL when NEXTAUTH_URL is invalid", async () => {
    process.env.NEXTAUTH_URL = "not-a-url";
    mockUserFindUnique.mockResolvedValue({ id: "user_1" });
    mockSendPasswordResetEmail.mockResolvedValue(undefined);

    const response = await POST(makeJsonRequest({
      email: "member@example.com",
      locale: "ko",
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith({
      to: "member@example.com",
      resetUrl: "http://localhost:3000/ko/auth/reset-password?token=raw_token_123",
    });
  });

  it("canonicalizes supported locale aliases before building the reset URL", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user_1" });
    mockSendPasswordResetEmail.mockResolvedValue(undefined);

    const response = await POST(makeJsonRequest({
      email: "member@example.com",
      locale: "iw-IL",
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith({
      to: "member@example.com",
      resetUrl: "http://localhost:3000/he/auth/reset-password?token=raw_token_123",
    });
  });

  it("returns 502 when email delivery fails", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user_1" });
    mockSendPasswordResetEmail.mockRejectedValue(new Error("upstream_failed"));

    const response = await POST(makeJsonRequest({
      email: "member@example.com",
      locale: "ko",
    }));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toEqual({ error: "email_send_failed" });
  });
});

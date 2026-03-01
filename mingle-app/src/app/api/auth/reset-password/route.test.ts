import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashOpaqueToken } from "@/lib/email-password-auth";

const {
  mockPasswordResetTokenFindUnique,
  mockPasswordResetTokenUpdateMany,
  mockUserUpdate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockPasswordResetTokenFindUnique: vi.fn(),
  mockPasswordResetTokenUpdateMany: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mockTransaction,
  },
}));

import { POST } from "@/app/api/auth/reset-password/route";

function makeJsonRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest(): Request {
  return new Request("http://localhost:3000/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
}

describe("/api/auth/reset-password route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockTransaction.mockImplementation(async (callback: (tx: {
      passwordResetToken: {
        findUnique: (args: unknown) => Promise<unknown>;
        updateMany: (args: unknown) => Promise<{ count: number }>;
      };
      user: {
        update: (args: unknown) => Promise<unknown>;
      };
    }) => Promise<unknown>) => callback({
      passwordResetToken: {
        findUnique: mockPasswordResetTokenFindUnique,
        updateMany: mockPasswordResetTokenUpdateMany,
      },
      user: {
        update: mockUserUpdate,
      },
    }));
    mockPasswordResetTokenUpdateMany.mockResolvedValue({ count: 1 });
    mockUserUpdate.mockResolvedValue({ id: "user_1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 400 when payload is invalid JSON", async () => {
    const response = await POST(makeInvalidJsonRequest());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "invalid_payload" });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 when token or password is missing", async () => {
    const response = await POST(makeJsonRequest({
      token: "reset_token",
      password: "",
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "missing_required_fields" });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 when password policy is not satisfied", async () => {
    const response = await POST(makeJsonRequest({
      token: "reset_token",
      password: "short",
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "invalid_password" });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 when token does not exist", async () => {
    mockPasswordResetTokenFindUnique.mockResolvedValue(null);

    const response = await POST(makeJsonRequest({
      token: "reset_token",
      password: "password123",
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "invalid_token" });
    expect(mockPasswordResetTokenFindUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashOpaqueToken("reset_token") },
      select: {
        id: true,
        userId: true,
        usedAt: true,
        expiresAt: true,
      },
    });
    expect(mockPasswordResetTokenUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 400 when token is already used", async () => {
    mockPasswordResetTokenFindUnique.mockResolvedValue({
      id: "token_1",
      userId: "user_1",
      usedAt: new Date("2026-03-02T00:00:00.000Z"),
      expiresAt: new Date("2026-03-03T00:00:00.000Z"),
    });

    const response = await POST(makeJsonRequest({
      token: "reset_token",
      password: "password123",
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "token_already_used" });
    expect(mockPasswordResetTokenUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 400 when token is expired", async () => {
    const now = new Date("2026-03-02T05:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockPasswordResetTokenFindUnique.mockResolvedValue({
      id: "token_1",
      userId: "user_1",
      usedAt: null,
      expiresAt: new Date("2026-03-02T04:59:59.000Z"),
    });

    const response = await POST(makeJsonRequest({
      token: "reset_token",
      password: "password123",
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "token_expired" });
    expect(mockPasswordResetTokenUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 400 when token claim loses a concurrent race", async () => {
    const now = new Date("2026-03-02T05:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockPasswordResetTokenFindUnique.mockResolvedValue({
      id: "token_1",
      userId: "user_1",
      usedAt: null,
      expiresAt: new Date("2026-03-02T06:00:00.000Z"),
    });
    mockPasswordResetTokenUpdateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(makeJsonRequest({
      token: "reset_token",
      password: "password123",
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "token_already_used" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("updates password and marks reset token used on success", async () => {
    const now = new Date("2026-03-02T05:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockPasswordResetTokenFindUnique.mockResolvedValue({
      id: "token_1",
      userId: "user_1",
      usedAt: null,
      expiresAt: new Date("2026-03-02T06:00:00.000Z"),
    });

    const response = await POST(makeJsonRequest({
      token: " reset_token ",
      password: "password123",
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockPasswordResetTokenUpdateMany).toHaveBeenCalledTimes(2);

    const userUpdateCall = mockUserUpdate.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { passwordHash: string; lastSeenAt: Date };
    };
    expect(userUpdateCall.where).toEqual({ id: "user_1" });
    expect(userUpdateCall.data.passwordHash.startsWith("pbkdf2_sha256$")).toBe(true);
    expect(userUpdateCall.data.lastSeenAt).toEqual(now);

    const claimCall = mockPasswordResetTokenUpdateMany.mock.calls[0]?.[0] as {
      where: { id: string; usedAt: null; expiresAt: { gt: Date } };
      data: { usedAt: Date };
    };
    expect(claimCall.where).toEqual({
      id: "token_1",
      usedAt: null,
      expiresAt: { gt: now },
    });
    expect(claimCall.data.usedAt).toEqual(now);

    const invalidateCall = mockPasswordResetTokenUpdateMany.mock.calls[1]?.[0] as {
      where: { userId: string; usedAt: null };
      data: { usedAt: Date };
    };
    expect(invalidateCall.where).toEqual({
      userId: "user_1",
      usedAt: null,
    });
    expect(invalidateCall.data.usedAt).toEqual(now);
  });
});

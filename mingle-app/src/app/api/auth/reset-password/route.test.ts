import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashOpaqueToken } from "@/lib/email-password-auth";

const {
  mockPasswordResetTokenFindUnique,
  mockPasswordResetTokenUpdate,
  mockUserUpdate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockPasswordResetTokenFindUnique: vi.fn(),
  mockPasswordResetTokenUpdate: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    passwordResetToken: {
      findUnique: mockPasswordResetTokenFindUnique,
      update: mockPasswordResetTokenUpdate,
    },
    user: {
      update: mockUserUpdate,
    },
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 400 when payload is invalid JSON", async () => {
    const response = await POST(makeInvalidJsonRequest());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "invalid_payload" });
    expect(mockPasswordResetTokenFindUnique).not.toHaveBeenCalled();
  });

  it("returns 400 when token or password is missing", async () => {
    const response = await POST(makeJsonRequest({
      token: "reset_token",
      password: "",
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "missing_required_fields" });
    expect(mockPasswordResetTokenFindUnique).not.toHaveBeenCalled();
  });

  it("returns 400 when password policy is not satisfied", async () => {
    const response = await POST(makeJsonRequest({
      token: "reset_token",
      password: "short",
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "invalid_password" });
    expect(mockPasswordResetTokenFindUnique).not.toHaveBeenCalled();
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
    expect(mockTransaction).not.toHaveBeenCalled();
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
    expect(mockTransaction).not.toHaveBeenCalled();
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
    mockUserUpdate.mockResolvedValue({ id: "user_1" });
    mockPasswordResetTokenUpdate.mockResolvedValue({ id: "token_1" });
    mockTransaction.mockResolvedValue([]);

    const response = await POST(makeJsonRequest({
      token: " reset_token ",
      password: "password123",
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockPasswordResetTokenUpdate).toHaveBeenCalledTimes(1);

    const userUpdateCall = mockUserUpdate.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { passwordHash: string; lastSeenAt: Date };
    };
    expect(userUpdateCall.where).toEqual({ id: "user_1" });
    expect(userUpdateCall.data.passwordHash.startsWith("pbkdf2_sha256$")).toBe(true);
    expect(userUpdateCall.data.lastSeenAt).toEqual(now);

    const tokenUpdateCall = mockPasswordResetTokenUpdate.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { usedAt: Date };
    };
    expect(tokenUpdateCall.where).toEqual({ id: "token_1" });
    expect(tokenUpdateCall.data.usedAt).toEqual(now);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const transactionPayload = mockTransaction.mock.calls[0]?.[0] as unknown[];
    expect(transactionPayload).toHaveLength(2);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUserFindUnique,
  mockUserCreate,
} = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockUserCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
      create: mockUserCreate,
    },
  },
}));

import { POST } from "@/app/api/auth/signup/route";

function makeJsonRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest(): Request {
  return new Request("http://localhost:3000/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
}

describe("/api/auth/signup route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when payload is invalid JSON", async () => {
    const response = await POST(makeInvalidJsonRequest());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "invalid_payload" });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    const response = await POST(makeJsonRequest({
      email: "member@example.com",
      name: "  ",
      password: "password123",
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "missing_required_fields" });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns 400 when email format is invalid", async () => {
    const response = await POST(makeJsonRequest({
      email: "not-an-email",
      name: "Member",
      password: "password123",
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "invalid_email" });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns 400 when password policy is not satisfied", async () => {
    const response = await POST(makeJsonRequest({
      email: "member@example.com",
      name: "Member",
      password: "short",
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "invalid_password" });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns 409 when email is already registered with password login", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user_existing",
    });

    const response = await POST(makeJsonRequest({
      email: "Member@Example.com",
      name: "Member",
      password: "password123",
    }));
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual({ error: "email_already_registered" });
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { email: "member@example.com" },
      select: {
        id: true,
      },
    });
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("returns 409 when email is already registered with OAuth account", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user_oauth" });

    const response = await POST(makeJsonRequest({
      email: "Member@Example.com",
      name: "  Member Name  ",
      password: "password123",
    }));
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual({ error: "email_already_registered" });
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("creates new email-password account when user does not exist", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue({ id: "user_new" });

    const response = await POST(makeJsonRequest({
      email: "Member@Example.com",
      name: "  New Member  ",
      password: "password123",
    }));
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json).toEqual({ ok: true, created: true });
    expect(mockUserCreate).toHaveBeenCalledTimes(1);
    const createCall = mockUserCreate.mock.calls[0]?.[0] as {
      data: {
        email: string;
        name: string;
        passwordHash: string;
        firstSeenAt: Date;
        lastSeenAt: Date;
      };
    };
    expect(createCall.data.email).toBe("member@example.com");
    expect(createCall.data.name).toBe("New Member");
    expect(createCall.data.passwordHash.startsWith("pbkdf2_sha256$")).toBe(true);
    expect(createCall.data.firstSeenAt).toBeInstanceOf(Date);
    expect(createCall.data.lastSeenAt).toBeInstanceOf(Date);
  });

  it("returns 409 when create hits email unique constraint race", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockRejectedValue({ code: "P2002" });

    const response = await POST(makeJsonRequest({
      email: "member@example.com",
      name: "Member",
      password: "password123",
    }));
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual({ error: "email_already_registered" });
  });
});

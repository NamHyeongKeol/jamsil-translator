import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockUserDelete,
  mockUserDeleteMany,
  MockPrismaClientKnownRequestError,
} = vi.hoisted(() => {
  class KnownRequestError extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }

  return {
    mockGetServerSession: vi.fn(),
    mockUserDelete: vi.fn(),
    mockUserDeleteMany: vi.fn(),
    MockPrismaClientKnownRequestError: KnownRequestError,
  };
});

vi.mock("next-auth", () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock("@/lib/auth-options", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      delete: mockUserDelete,
      deleteMany: mockUserDeleteMany,
    },
  },
}));

vi.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: MockPrismaClientKnownRequestError,
  },
}));

import { DELETE } from "@/app/api/account/delete/route";

describe("/api/account/delete route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when session is missing", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await DELETE();
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: "unauthorized" });
  });

  it("deletes by user id first when session id is present", async () => {
    mockGetServerSession.mockResolvedValue({
      user: {
        id: "user_123",
        email: "user@example.com",
      },
    });
    mockUserDelete.mockResolvedValue({ id: "user_123" });

    const response = await DELETE();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, deletedUsers: 1 });
    expect(mockUserDelete).toHaveBeenCalledWith({
      where: { id: "user_123" },
    });
    expect(mockUserDeleteMany).not.toHaveBeenCalled();
  });

  it("falls back to email delete when id delete returns P2025", async () => {
    mockGetServerSession.mockResolvedValue({
      user: {
        id: "missing_user",
        email: "User@Example.com",
      },
    });
    mockUserDelete.mockRejectedValue(new MockPrismaClientKnownRequestError("P2025"));
    mockUserDeleteMany.mockResolvedValue({ count: 1 });

    const response = await DELETE();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, deletedUsers: 1 });
    expect(mockUserDeleteMany).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
    });
  });
});

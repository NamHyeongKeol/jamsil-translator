import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthOptions } from "next-auth";

const { nextAuthMock, getAuthOptionsMock } = vi.hoisted(() => ({
  nextAuthMock: vi.fn(),
  getAuthOptionsMock: vi.fn(),
}));

vi.mock("next-auth/next", () => ({
  default: nextAuthMock,
}));

vi.mock("@/lib/auth-options", () => ({
  getAuthOptions: getAuthOptionsMock,
}));

import { GET } from "@/app/api/auth/[...nextauth]/route";

type MinimalProvider = {
  id: string;
  type: string;
};

function buildRequest(url: string) {
  return {
    method: "GET",
    nextUrl: new URL(url),
  } as never;
}

function buildAuthOptions(): NextAuthOptions {
  const providers: MinimalProvider[] = [
    { id: "google", type: "oauth" },
    { id: "email-password", type: "credentials" },
    { id: "apple", type: "oauth" },
    { id: "native-bridge", type: "credentials" },
  ];
  return {
    providers: providers as never,
  };
}

describe("/api/auth/[...nextauth] route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextAuthMock.mockResolvedValue(new Response(null, { status: 200 }));
    getAuthOptionsMock.mockReturnValue(buildAuthOptions());
  });

  it("keeps credentials provider when requested signin provider is email-password", async () => {
    await GET(
      buildRequest("http://localhost:3000/api/auth/signin/email-password"),
      { params: Promise.resolve({ nextauth: ["signin", "email-password"] }) },
    );

    expect(nextAuthMock).toHaveBeenCalledTimes(1);
    const options = nextAuthMock.mock.calls[0]?.[2] as NextAuthOptions;
    const providerIds = (options.providers || []).map((provider) => provider.id);
    expect(providerIds).toEqual(["email-password"]);
  });

  it("keeps oauth-only provider list when requested signin provider is oauth", async () => {
    await GET(
      buildRequest("http://localhost:3000/api/auth/signin/google"),
      { params: Promise.resolve({ nextauth: ["signin", "google"] }) },
    );

    expect(nextAuthMock).toHaveBeenCalledTimes(1);
    const options = nextAuthMock.mock.calls[0]?.[2] as NextAuthOptions;
    const providers = options.providers || [];
    const providerIds = providers.map((provider) => provider.id);
    expect(providerIds).toEqual(["google"]);
    expect(providers.every((provider) => provider.type !== "credentials")).toBe(true);
  });
});

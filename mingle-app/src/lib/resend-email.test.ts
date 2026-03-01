import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isResendConfigured, sendPasswordResetEmail } from "@/lib/resend-email";

type EnvSnapshot = {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
};

const originalEnv: EnvSnapshot = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
};

function restoreEnvValue(name: keyof EnvSnapshot, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe("resend-email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnvValue("RESEND_API_KEY", originalEnv.RESEND_API_KEY);
    restoreEnvValue("RESEND_FROM_EMAIL", originalEnv.RESEND_FROM_EMAIL);
  });

  it("reports not configured when required env is missing", () => {
    process.env.RESEND_API_KEY = "test_key";
    delete process.env.RESEND_FROM_EMAIL;

    expect(isResendConfigured()).toBe(false);
  });

  it("reports configured when api key and from email are set", () => {
    process.env.RESEND_API_KEY = "test_key";
    process.env.RESEND_FROM_EMAIL = "Mingle <noreply@example.com>";

    expect(isResendConfigured()).toBe(true);
  });

  it("throws when trying to send without config", async () => {
    await expect(sendPasswordResetEmail({
      to: "member@example.com",
      resetUrl: "https://example.com/reset?token=abc",
    })).rejects.toThrow("resend_not_configured");
  });

  it("calls Resend API with expected payload", async () => {
    process.env.RESEND_API_KEY = "test_key";
    process.env.RESEND_FROM_EMAIL = "Mingle <noreply@example.com>";

    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendPasswordResetEmail({
      to: "member@example.com",
      resetUrl: "https://example.com/reset?token=abc",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer test_key",
      "Content-Type": "application/json",
    });
    expect(init.cache).toBe("no-store");

    const payload = JSON.parse(String(init.body)) as {
      from: string;
      to: string[];
      subject: string;
      text: string;
      html: string;
    };
    expect(payload.from).toBe("Mingle <noreply@example.com>");
    expect(payload.to).toEqual(["member@example.com"]);
    expect(payload.subject).toBe("Reset your Mingle password");
    expect(payload.text).toContain("https://example.com/reset?token=abc");
    expect(payload.html).toContain("Reset password");
  });

  it("throws detailed error when Resend returns non-2xx response", async () => {
    process.env.RESEND_API_KEY = "test_key";
    process.env.RESEND_FROM_EMAIL = "Mingle <noreply@example.com>";

    const fetchMock = vi.fn().mockResolvedValue(new Response("bad_request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendPasswordResetEmail({
      to: "member@example.com",
      resetUrl: "https://example.com/reset?token=abc",
    })).rejects.toThrow("resend_send_failed_400:bad_request");
  });
});

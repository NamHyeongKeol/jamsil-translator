import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import AppleProvider from "next-auth/providers/apple";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { resolveAppleOAuthCredentials, type AppleOAuthCredentials } from "@/lib/apple-oauth";
import { verifyNativeAuthBridgeToken } from "@/lib/native-auth-bridge";
import { prisma } from "@/lib/prisma";

function normalizeEmail(rawValue: unknown): string | null {
  if (typeof rawValue !== "string") return null;
  const normalized = rawValue.trim().toLowerCase();
  return normalized || null;
}

function normalizeDisplayName(rawValue: unknown): string | null {
  if (typeof rawValue !== "string") return null;
  const normalized = rawValue.trim();
  return normalized ? normalized.slice(0, 128) : null;
}

function normalizeUserId(rawValue: unknown): string | null {
  if (typeof rawValue !== "string") return null;
  const normalized = rawValue.trim();
  if (!normalized) return null;
  return normalized.slice(0, 128);
}

function isFeatureEnabled(rawValue: string | undefined, defaultValue: boolean): boolean {
  if (typeof rawValue !== "string") return defaultValue;
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (["0", "false", "off", "no", "n"].includes(normalized)) return false;
  if (["1", "true", "on", "yes", "y"].includes(normalized)) return true;
  return defaultValue;
}

function summarizeAuthLogMeta(rawValue: unknown): string {
  if (!rawValue || typeof rawValue !== "object") return "-";
  const entry = rawValue as Record<string, unknown>;
  const keys = Object.keys(entry).slice(0, 8).join(",");
  const errorValue = entry.error;
  if (errorValue instanceof Error) {
    const message = (errorValue.message || "").trim().replace(/\s+/g, " ").slice(0, 180);
    return `keys=${keys || "-"} error="${message || "-"}"`;
  }
  if (typeof errorValue === "string") {
    const message = errorValue.trim().replace(/\s+/g, " ").slice(0, 180);
    return `keys=${keys || "-"} error="${message || "-"}"`;
  }
  return `keys=${keys || "-"}`;
}

async function upsertUserForCredentialsSignIn(args: {
  idHint?: string | null;
  email?: string | null;
  name?: string | null;
  externalUserIdHint?: string | null;
}) {
  const idHint = normalizeUserId(args.idHint);
  const normalizedEmail = normalizeEmail(args.email);
  const normalizedName = normalizeDisplayName(args.name);
  const normalizedExternalUserId = normalizeUserId(args.externalUserIdHint);
  const now = new Date();

  if (idHint) {
    return prisma.user.upsert({
      where: { id: idHint },
      create: {
        id: idHint,
        email: normalizedEmail ?? undefined,
        name: normalizedName ?? "Mingle User",
        externalUserId: normalizedExternalUserId ?? idHint,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        email: normalizedEmail ?? undefined,
        name: normalizedName ?? undefined,
        externalUserId: normalizedExternalUserId ?? idHint,
        lastSeenAt: now,
      },
      select: {
        id: true,
        name: true,
        email: true,
        externalUserId: true,
      },
    });
  }

  if (normalizedEmail) {
    return prisma.user.upsert({
      where: { email: normalizedEmail },
      create: {
        email: normalizedEmail,
        name: normalizedName ?? "Mingle User",
        externalUserId: normalizedExternalUserId ?? undefined,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        name: normalizedName ?? undefined,
        lastSeenAt: now,
      },
      select: {
        id: true,
        name: true,
        email: true,
        externalUserId: true,
      },
    });
  }

  return prisma.user.create({
    data: {
      name: normalizedName ?? "Mingle User",
      externalUserId: normalizedExternalUserId ?? undefined,
      firstSeenAt: now,
      lastSeenAt: now,
    },
    select: {
      id: true,
      name: true,
      email: true,
      externalUserId: true,
    },
  });
}

const APPLE_OAUTH_SECRET_REFRESH_SKEW_MS = 5 * 60 * 1000;
const APPLE_PROVIDER_WHITE_LOGO = "data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%274%2032%20376.4%20449.4%27%3E%3Cpath%20fill%3D%27%23ffffff%27%20d%3D%27M318.7%20268.7c-.2-36.7%2016.4-64.4%2050-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3%2020.7-88.5%2020.7-15%200-49.4-19.7-76.4-19.7C63.3%20141.2%204%20184.8%204%20273.5q0%2039.3%2014.4%2081.2c12.8%2036.7%2059%20126.7%20107.2%20125.2%2025.2-.6%2043-17.9%2075.8-17.9%2031.8%200%2048.3%2017.9%2076.4%2017.9%2048.6-.7%2090.4-82.5%20102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4%2024.8-61.9%2024-72.5a106%20106%200%200%200-67.9%2034.9%2095.7%2095.7%200%200%200-25.6%2071.9c26.1%202%2049.9-11.4%2069.5-34.3z%27%2F%3E%3C%2Fsvg%3E";

type AppleOAuthCredentialsCache = {
  credentials: AppleOAuthCredentials | null;
  expiresAtEpochMs: number | null;
  resolvedAtEpochMs: number;
};

const appleOAuthCredentialsCache: AppleOAuthCredentialsCache = {
  credentials: null,
  expiresAtEpochMs: null,
  resolvedAtEpochMs: 0,
};

function parseAppleSecretExpirationEpochMs(secret: string): number | null {
  const segments = secret.split(".");
  if (segments.length < 2) return null;

  const payloadSegment = segments[1];
  const base64 = payloadSegment
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(payloadSegment.length / 4) * 4, "=");
  try {
    const decoded = JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as Record<string, unknown>;
    const exp = decoded.exp;
    if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) return null;
    return Math.floor(exp) * 1000;
  } catch {
    return null;
  }
}

function shouldRefreshAppleCredentials(nowEpochMs: number): boolean {
  if (!appleOAuthCredentialsCache.resolvedAtEpochMs) return true;
  if (!appleOAuthCredentialsCache.credentials) return true;
  if (appleOAuthCredentialsCache.credentials.source === "static_secret") return false;

  const expiresAtEpochMs = appleOAuthCredentialsCache.expiresAtEpochMs;
  if (!expiresAtEpochMs) return true;

  return nowEpochMs >= (expiresAtEpochMs - APPLE_OAUTH_SECRET_REFRESH_SKEW_MS);
}

function resolveAppleOAuthCredentialsWithRefresh(): AppleOAuthCredentials | null {
  const nowEpochMs = Date.now();
  if (!shouldRefreshAppleCredentials(nowEpochMs)) {
    return appleOAuthCredentialsCache.credentials;
  }

  try {
    const credentials = resolveAppleOAuthCredentials();
    const expiresAtEpochMs = credentials?.source === "generated_secret"
      ? parseAppleSecretExpirationEpochMs(credentials.clientSecret)
      : null;

    appleOAuthCredentialsCache.credentials = credentials;
    appleOAuthCredentialsCache.expiresAtEpochMs = expiresAtEpochMs;
    appleOAuthCredentialsCache.resolvedAtEpochMs = nowEpochMs;

    if (credentials?.source === "generated_secret" && !expiresAtEpochMs) {
      console.warn("[auth-options] unable to parse Apple client secret expiration; refreshing per request.");
    }

    return credentials;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[auth-options] failed to configure Apple OAuth: ${message}`);
    appleOAuthCredentialsCache.credentials = null;
    appleOAuthCredentialsCache.expiresAtEpochMs = null;
    appleOAuthCredentialsCache.resolvedAtEpochMs = nowEpochMs;
    return null;
  }
}
const googleClientId = process.env.AUTH_GOOGLE_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET;
const allowEmailAccountLinking = isFeatureEnabled(process.env.AUTH_ALLOW_EMAIL_ACCOUNT_LINKING, true);
const authDebugEnabled = isFeatureEnabled(process.env.AUTH_DEBUG, process.env.NODE_ENV !== "production");

function buildProviders(): NextAuthOptions["providers"] {
  const providers: NextAuthOptions["providers"] = [
    CredentialsProvider({
      id: "native-bridge",
      name: "Native Bridge",
      credentials: {
        token: { label: "Token", type: "text" },
      },
      async authorize(credentials) {
        const token = credentials?.token?.trim();
        if (!token) return null;
        const payload = verifyNativeAuthBridgeToken(token);
        if (!payload) return null;

        const user = await upsertUserForCredentialsSignIn({
          idHint: payload.sub,
          email: payload.email,
          name: payload.name,
          externalUserIdHint: payload.sub,
        });

        return {
          id: user.id,
          name: user.name || "Mingle User",
          email: user.email || "",
          externalUserId: user.externalUserId || null,
        };
      },
    }),
  ];

  const appleOAuthCredentials = resolveAppleOAuthCredentialsWithRefresh();
  if (appleOAuthCredentials) {
    providers.unshift(
      AppleProvider({
        clientId: appleOAuthCredentials.clientId,
        clientSecret: appleOAuthCredentials.clientSecret,
        allowDangerousEmailAccountLinking: allowEmailAccountLinking,
        style: {
          logo: APPLE_PROVIDER_WHITE_LOGO,
          logoDark: APPLE_PROVIDER_WHITE_LOGO,
          bg: "#000000",
          text: "#ffffff",
          bgDark: "#000000",
          textDark: "#ffffff",
        },
      }),
    );
  }

  if (googleClientId && googleClientSecret) {
    providers.unshift(
      GoogleProvider({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        allowDangerousEmailAccountLinking: allowEmailAccountLinking,
      }),
    );
  }

  return providers;
}

export function isAppleOAuthConfigured(): boolean {
  return Boolean(resolveAppleOAuthCredentialsWithRefresh());
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(googleClientId && googleClientSecret);
}

const authBaseUrl = (
  process.env.NEXTAUTH_URL
  || process.env.AUTH_URL
  || process.env.NEXT_PUBLIC_SITE_URL
  || ""
).trim();
const useSecureOauthCookies = authBaseUrl.startsWith("https://");
const oauthCookieSameSite = (useSecureOauthCookies ? "none" : "lax") as "none" | "lax";
const oauthCookiePrefix = useSecureOauthCookies ? "__Secure-" : "";
const oauthTransientCookieOptions = {
  httpOnly: true,
  sameSite: oauthCookieSameSite,
  path: "/",
  secure: useSecureOauthCookies,
  maxAge: 60 * 15,
};

const authOptionsBase: Omit<NextAuthOptions, "providers"> = {
  adapter: PrismaAdapter(prisma) as Adapter,
  debug: authDebugEnabled,
  logger: {
    error(code, metadata) {
      console.error(`[nextauth:error] code=${String(code)} ${summarizeAuthLogMeta(metadata)}`);
    },
    warn(code) {
      console.warn(`[nextauth:warn] code=${String(code)}`);
    },
    debug(code, metadata) {
      if (!authDebugEnabled) return;
      console.info(`[nextauth:debug] code=${String(code)} ${summarizeAuthLogMeta(metadata)}`);
    },
  },
  session: {
    // Keep JWT session strategy because native credential bridge sign-in relies on it.
    strategy: "jwt",
  },
  cookies: {
    // Apple returns OAuth callback via cross-site POST(form_post), so Lax cookies can be dropped.
    callbackUrl: {
      name: `${oauthCookiePrefix}next-auth.callback-url`,
      options: oauthTransientCookieOptions,
    },
    pkceCodeVerifier: {
      name: `${oauthCookiePrefix}next-auth.pkce.code_verifier`,
      options: oauthTransientCookieOptions,
    },
    state: {
      name: `${oauthCookiePrefix}next-auth.state`,
      options: oauthTransientCookieOptions,
    },
    nonce: {
      name: `${oauthCookiePrefix}next-auth.nonce`,
      options: oauthTransientCookieOptions,
    },
  },
  events: {
    async signIn({ user }) {
      const userId = normalizeUserId(user?.id);
      if (!userId) return;

      const now = new Date();
      const email = normalizeEmail(user?.email);
      const name = normalizeDisplayName(user?.name);
      await prisma.user.upsert({
        where: { id: userId },
        create: {
          id: userId,
          email: email ?? undefined,
          name: name ?? "Mingle User",
          externalUserId: userId,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: {
          email: email ?? undefined,
          name: name ?? undefined,
          externalUserId: userId,
          lastSeenAt: now,
        },
      });
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      if (typeof user?.email === "string") {
        token.email = normalizeEmail(user.email) ?? user.email;
      }
      if (typeof user?.name === "string") {
        token.name = normalizeDisplayName(user.name) ?? user.name;
      }
      const externalUserId = (user as { externalUserId?: unknown } | null)?.externalUserId;
      if (typeof externalUserId === "string" && externalUserId.trim()) {
        token.externalUserId = externalUserId.trim();
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (typeof token.sub === "string" && token.sub.trim()) {
          session.user.id = token.sub.trim();
        }
        session.user.name = session.user.name ?? token.name ?? "Mingle User";
        session.user.email = session.user.email ?? token.email ?? "";
        if (typeof token.externalUserId === "string" && token.externalUserId.trim()) {
          session.user.externalUserId = token.externalUserId.trim();
        }
      }
      return session;
    },
  },
};

export function getAuthOptions(): NextAuthOptions {
  return {
    ...authOptionsBase,
    providers: buildProviders(),
  };
}

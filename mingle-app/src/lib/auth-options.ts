import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import AppleProvider from "next-auth/providers/apple";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { resolveAppleOAuthCredentials } from "@/lib/apple-oauth";
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

const appleOAuthCredentials = (() => {
  try {
    return resolveAppleOAuthCredentials();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[auth-options] failed to configure Apple OAuth: ${message}`);
    return null;
  }
})();
const googleClientId = process.env.AUTH_GOOGLE_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET;

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
  CredentialsProvider({
    name: "Demo",
    credentials: {
      name: { label: "Name", type: "text" },
      email: { label: "Email", type: "email" },
    },
    async authorize(credentials) {
      const name = credentials?.name;
      const email = credentials?.email;

      if (!name || !email) {
        return null;
      }

      const user = await upsertUserForCredentialsSignIn({
        email,
        name,
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

if (appleOAuthCredentials) {
  providers.unshift(
    AppleProvider({
      clientId: appleOAuthCredentials.clientId,
      clientSecret: appleOAuthCredentials.clientSecret,
    }),
  );
}

if (googleClientId && googleClientSecret) {
  providers.unshift(
    GoogleProvider({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    }),
  );
}

export function isAppleOAuthConfigured(): boolean {
  return Boolean(appleOAuthCredentials);
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(googleClientId && googleClientSecret);
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
  providers,
  session: {
    // Keep JWT session strategy because native credential bridge sign-in relies on it.
    strategy: "jwt",
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

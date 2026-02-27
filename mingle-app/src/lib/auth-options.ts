import type { NextAuthOptions } from "next-auth";
import AppleProvider from "next-auth/providers/apple";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { resolveAppleOAuthCredentials } from "@/lib/apple-oauth";
import { verifyNativeAuthBridgeToken } from "@/lib/native-auth-bridge";

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

      return {
        id: payload.sub,
        name: payload.name || "Mingle User",
        email: payload.email || "",
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
      const name = credentials?.name?.trim();
      const email = credentials?.email?.trim();

      if (!name || !email) {
        return null;
      }

      return {
        id: `demo_${email.toLowerCase()}`,
        name,
        email: email.toLowerCase(),
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
  providers,
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.name = session.user.name ?? token.name ?? "Mingle User";
        session.user.email = session.user.email ?? token.email ?? "";
      }
      return session;
    },
  },
};

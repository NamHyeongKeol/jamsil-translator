import type { NextAuthOptions } from "next-auth";
import AppleProvider from "next-auth/providers/apple";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { DEFAULT_LOCALE } from "@/i18n";
import { verifyNativeAuthBridgeToken } from "@/lib/native-auth-bridge";

const appleClientId = process.env.AUTH_APPLE_ID;
const appleClientSecret = process.env.AUTH_APPLE_SECRET;
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

if (appleClientId && appleClientSecret) {
  providers.unshift(
    AppleProvider({
      clientId: appleClientId,
      clientSecret: appleClientSecret,
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
  return Boolean(appleClientId && appleClientSecret);
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(googleClientId && googleClientSecret);
}

export const authOptions: NextAuthOptions = {
  providers,
  pages: {
    signIn: `/${DEFAULT_LOCALE}/auth/signin`,
  },
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

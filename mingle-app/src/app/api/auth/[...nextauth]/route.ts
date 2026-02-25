import NextAuth from "next-auth/next";
import type { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth-options";

type AppRouteContext = {
  params: Promise<{
    nextauth: string[];
  }>;
};

function resolveAction(nextauth: string[] | undefined): string {
  const action = nextauth?.[0];
  if (typeof action !== "string") return "";
  return action.trim().toLowerCase();
}

function resolveRouteAuthOptions(nextauth: string[] | undefined) {
  const action = resolveAction(nextauth);
  if (action !== "signin") {
    return authOptions;
  }

  // Keep built-in NextAuth sign-in page for OAuth providers only.
  const oauthOnlyProviders = (authOptions.providers || []).filter((provider) => provider.type !== "credentials");
  return {
    ...authOptions,
    providers: oauthOnlyProviders,
  };
}

export async function GET(request: NextRequest, context: AppRouteContext) {
  const params = await context.params;
  return NextAuth(request as any, { params } as any, resolveRouteAuthOptions(params?.nextauth));
}

export async function POST(request: NextRequest, context: AppRouteContext) {
  const params = await context.params;
  return NextAuth(request as any, { params } as any, resolveRouteAuthOptions(params?.nextauth));
}

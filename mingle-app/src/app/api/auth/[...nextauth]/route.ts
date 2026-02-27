import NextAuth from "next-auth/next";
import type { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth-options";

type AppRouteContext = {
  params: Promise<{
    nextauth: string[];
  }>;
};

function summarizeText(rawValue: string, maxLength: number): string {
  const normalized = rawValue.trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.slice(0, maxLength);
}

function summarizeCallbackUrl(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) return "-";
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname || "/";
    const host = parsed.host || "-";
    return `${host}${pathname}`.slice(0, 120);
  } catch {
    return summarizeText(trimmed, 120) || "-";
  }
}

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
  // Force social provider order to Apple -> Google for consistent UX with native app.
  const oauthOnlyProviders = (authOptions.providers || [])
    .filter((provider) => provider.type !== "credentials")
    .slice()
    .sort((a, b) => {
      const rank = (id: string): number => {
        if (id === "apple") return 0;
        if (id === "google") return 1;
        return 10;
      };
      return rank(a.id) - rank(b.id);
    });
  return {
    ...authOptions,
    providers: oauthOnlyProviders,
  };
}

export async function GET(request: NextRequest, context: AppRouteContext) {
  const params = await context.params;
  const action = resolveAction(params?.nextauth);
  const provider = summarizeText(params?.nextauth?.[1] || "-", 48) || "-";
  const callbackUrl = summarizeCallbackUrl(request.nextUrl.searchParams.get("callbackUrl") || "");
  const error = summarizeText(request.nextUrl.searchParams.get("error") || "-", 64) || "-";
  console.info(
    `[nextauth] method=GET action=${action || "-"} provider=${provider} callback=${callbackUrl} error=${error}`,
  );
  return NextAuth(request as any, { params } as any, resolveRouteAuthOptions(params?.nextauth));
}

export async function POST(request: NextRequest, context: AppRouteContext) {
  const params = await context.params;
  const action = resolveAction(params?.nextauth);
  const provider = summarizeText(params?.nextauth?.[1] || "-", 48) || "-";
  const callbackUrl = summarizeCallbackUrl(request.nextUrl.searchParams.get("callbackUrl") || "");
  const error = summarizeText(request.nextUrl.searchParams.get("error") || "-", 64) || "-";
  console.info(
    `[nextauth] method=POST action=${action || "-"} provider=${provider} callback=${callbackUrl} error=${error}`,
  );
  return NextAuth(request as any, { params } as any, resolveRouteAuthOptions(params?.nextauth));
}

import { redirect } from "next/navigation";
import { resolveNativeOAuthProvider, resolveSafeCallbackPath } from "@/lib/native-auth-bridge";

type LocaleSignInPageProps = {
  searchParams: Promise<{
    provider?: string | string[];
    callbackUrl?: string | string[];
  }>;
};

function takeFirst(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

function resolveCallbackUrl(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) return "/";

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    // Fallback below for relative callback paths.
  }

  return resolveSafeCallbackPath(trimmed, "/");
}

export default async function LocaleSignInPage({ searchParams }: LocaleSignInPageProps) {
  const query = await searchParams;
  const provider = resolveNativeOAuthProvider(takeFirst(query.provider)) ?? "google";
  const callbackUrl = resolveCallbackUrl(takeFirst(query.callbackUrl));

  const signInUrl = new URL(`/api/auth/signin/${provider}`, "https://mingle.local");
  signInUrl.searchParams.set("callbackUrl", callbackUrl);
  signInUrl.searchParams.set("ngrok-skip-browser-warning", "1");

  redirect(`${signInUrl.pathname}${signInUrl.search}`);
}

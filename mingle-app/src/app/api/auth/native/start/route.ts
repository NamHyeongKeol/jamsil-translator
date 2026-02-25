import { NextRequest, NextResponse } from "next/server";
import { resolveNativeOAuthProvider, resolveSafeCallbackPath } from "@/lib/native-auth-bridge";

function normalizeOriginCandidate(rawValue: string | null | undefined): string | null {
  if (typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.host) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function resolveExternalOrigin(request: NextRequest): string {
  const forwardedUrl = normalizeOriginCandidate(request.headers.get("x-forwarded-url"));
  if (forwardedUrl) return forwardedUrl;

  const forwardedProto = (request.headers.get("x-forwarded-proto") || "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  const forwardedHost = (request.headers.get("x-forwarded-host") || "")
    .split(",")[0]
    ?.trim();
  if (forwardedProto && forwardedHost) {
    const forwardedOrigin = normalizeOriginCandidate(`${forwardedProto}://${forwardedHost}`);
    if (forwardedOrigin) return forwardedOrigin;
  }

  const envOrigin = normalizeOriginCandidate(process.env.NEXTAUTH_URL)
    ?? normalizeOriginCandidate(process.env.NEXT_PUBLIC_SITE_URL);
  if (envOrigin) return envOrigin;

  return request.nextUrl.origin;
}

function summarizeUserAgent(rawValue: string | null): string {
  const normalized = (rawValue || "").trim().replace(/\s+/g, " ");
  if (!normalized) return "unknown";
  return normalized.slice(0, 160);
}

export async function GET(request: NextRequest) {
  const provider = resolveNativeOAuthProvider(request.nextUrl.searchParams.get("provider"));
  if (!provider) {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  }

  const callbackPath = resolveSafeCallbackPath(request.nextUrl.searchParams.get("callbackUrl"), "/");
  const externalOrigin = resolveExternalOrigin(request);
  const completeUrl = new URL("/api/auth/native/complete", externalOrigin);
  completeUrl.searchParams.set("provider", provider);
  completeUrl.searchParams.set("callbackUrl", callbackPath);
  completeUrl.searchParams.set("ngrok-skip-browser-warning", "1");

  const signInUrl = new URL(`/api/auth/signin/${provider}`, externalOrigin);
  signInUrl.searchParams.set("callbackUrl", completeUrl.toString());
  signInUrl.searchParams.set("ngrok-skip-browser-warning", "1");

  console.info(
    `[native-auth/start] provider=${provider} callbackPath=${callbackPath} origin=${externalOrigin} ua="${summarizeUserAgent(
      request.headers.get("user-agent"),
    )}"`,
  );

  return NextResponse.redirect(signInUrl);
}

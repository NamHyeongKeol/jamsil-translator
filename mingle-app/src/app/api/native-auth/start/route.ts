import { NextRequest, NextResponse } from "next/server";
import { resolveNativeAuthRequestId, resolveNativeOAuthProvider, resolveSafeCallbackPath } from "@/lib/native-auth-bridge";
import { DEFAULT_LOCALE, isSupportedLocale } from "@/i18n";

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

function resolveAllowedHosts(): Set<string> | null {
  const raw = process.env.NATIVE_AUTH_ALLOWED_HOSTS ?? process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return null;
  const hosts = raw
    .split(",")
    .map((v) => {
      try {
        return new URL(v.trim().startsWith("http") ? v.trim() : `https://${v.trim()}`).host;
      } catch {
        return null;
      }
    })
    .filter((h): h is string => !!h);
  return hosts.length > 0 ? new Set(hosts) : null;
}

function resolveExternalOrigin(request: NextRequest): string {
  // 1순위: env 고정값 (prod/devbox 모두 항상 설정됨 — 헤더를 신뢰하지 않아도 됨)
  const envOrigin =
    normalizeOriginCandidate(process.env.NEXTAUTH_URL) ??
    normalizeOriginCandidate(process.env.NEXT_PUBLIC_SITE_URL);
  if (envOrigin) return envOrigin;

  // 2순위: x-forwarded-* 폴백 (env 없는 경우만) — host allowlist로 검증
  const allowedHosts = resolveAllowedHosts();
  const forwardedUrl = normalizeOriginCandidate(request.headers.get("x-forwarded-url"));
  if (forwardedUrl) {
    const host = new URL(forwardedUrl).host;
    if (!allowedHosts || allowedHosts.has(host)) return forwardedUrl;
  }

  const forwardedProto = (request.headers.get("x-forwarded-proto") || "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  const forwardedHost = (request.headers.get("x-forwarded-host") || "")
    .split(",")[0]
    ?.trim();
  if (forwardedProto && forwardedHost) {
    if (!allowedHosts || allowedHosts.has(forwardedHost)) {
      const forwardedOrigin = normalizeOriginCandidate(`${forwardedProto}://${forwardedHost}`);
      if (forwardedOrigin) return forwardedOrigin;
    }
  }

  return request.nextUrl.origin;
}

function summarizeUserAgent(rawValue: string | null): string {
  const normalized = (rawValue || "").trim().replace(/\s+/g, " ");
  if (!normalized) return "unknown";
  return normalized.slice(0, 160);
}

function resolveLocaleFromCallbackPath(callbackPath: string): string {
  const firstSegment = callbackPath.split("/").filter(Boolean)[0] ?? "";
  if (isSupportedLocale(firstSegment)) return firstSegment;
  return DEFAULT_LOCALE;
}

export async function GET(request: NextRequest) {
  const provider = resolveNativeOAuthProvider(request.nextUrl.searchParams.get("provider"));
  if (!provider) {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  }

  const callbackPath = resolveSafeCallbackPath(request.nextUrl.searchParams.get("callbackUrl"), "/");
  const requestId = resolveNativeAuthRequestId(request.nextUrl.searchParams.get("requestId"));
  const externalOrigin = resolveExternalOrigin(request);
  const completeUrl = new URL("/api/native-auth/complete", externalOrigin);
  completeUrl.searchParams.set("provider", provider);
  completeUrl.searchParams.set("callbackUrl", callbackPath);
  completeUrl.searchParams.set("ngrok-skip-browser-warning", "1");
  if (requestId) {
    completeUrl.searchParams.set("requestId", requestId);
  }

  const locale = resolveLocaleFromCallbackPath(callbackPath);
  const launchUrl = new URL(`/${locale}/auth/native`, externalOrigin);
  launchUrl.searchParams.set("provider", provider);
  launchUrl.searchParams.set("callbackUrl", completeUrl.toString());
  launchUrl.searchParams.set("ngrok-skip-browser-warning", "1");

  console.info(
    `[native-auth/start] provider=${provider} callbackPath=${callbackPath} requestId=${requestId || "-"} origin=${externalOrigin} ua="${summarizeUserAgent(
      request.headers.get("user-agent"),
    )}"`,
  );

  return NextResponse.redirect(launchUrl);
}

import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, isSupportedLocale, type AppLocale } from "@/i18n";

const LOCALE_ALIASES: Record<string, AppLocale> = {
  ko: "ko",
  en: "en",
  ja: "ja",
  "zh-cn": "zh-CN",
  "zh-tw": "zh-TW",
  fr: "fr",
  de: "de",
  es: "es",
  pt: "pt",
  it: "it",
  ru: "ru",
  ar: "ar",
  hi: "hi",
  th: "th",
  vi: "vi",
  zh: "zh-CN",
  "zh-hans": "zh-CN",
  "zh-sg": "zh-CN",
  "zh-hant": "zh-TW",
  "zh-hk": "zh-TW",
  "zh-mo": "zh-TW",
};

function resolveSupportedLocaleTag(rawValue: string): AppLocale | null {
  const normalized = rawValue.trim().replace(/_/g, "-").toLowerCase();
  if (!normalized) return null;

  const directMatch = LOCALE_ALIASES[normalized];
  if (directMatch && isSupportedLocale(directMatch)) {
    return directMatch;
  }

  const base = normalized.split("-")[0];
  if (!base) return null;
  const baseMatch = LOCALE_ALIASES[base];
  if (baseMatch && isSupportedLocale(baseMatch)) {
    return baseMatch;
  }

  return null;
}

function pickPreferredLocale(headerValue: string | null): AppLocale {
  if (!headerValue) {
    return DEFAULT_LOCALE;
  }

  const languageTags = headerValue
    .split(",")
    .map((part) => part.split(";")[0]?.trim())
    .filter(Boolean);

  for (const tag of languageTags) {
    const resolved = resolveSupportedLocaleTag(tag);
    if (resolved) {
      return resolved;
    }
  }

  return DEFAULT_LOCALE;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Do not locale-redirect public/static files such as /og-image.png.
  if (/\.[^/]+$/.test(pathname)) {
    return NextResponse.next();
  }

  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];

  if (first) {
    const normalizedLocale = resolveSupportedLocaleTag(first);
    if (normalizedLocale) {
      if (isSupportedLocale(first) && first === normalizedLocale) {
        return NextResponse.next();
      }
      const url = request.nextUrl.clone();
      const restPath = segments.slice(1).join("/");
      url.pathname = `/${normalizedLocale}${restPath ? `/${restPath}` : ""}`;
      return NextResponse.redirect(url);
    }
  }

  const locale = pickPreferredLocale(request.headers.get("accept-language"));
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;

  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\..*).*)"],
};

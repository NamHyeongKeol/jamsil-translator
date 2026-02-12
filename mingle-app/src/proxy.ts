import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, isSupportedLocale, type AppLocale } from "@/i18n";

function pickPreferredLocale(headerValue: string | null): AppLocale {
  if (!headerValue) {
    return DEFAULT_LOCALE;
  }

  const languageTags = headerValue
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase())
    .filter(Boolean);

  for (const tag of languageTags) {
    const normalized = tag.split("-")[0];
    if (normalized && isSupportedLocale(normalized)) {
      return normalized;
    }
  }

  return DEFAULT_LOCALE;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];

  if (first && isSupportedLocale(first)) {
    return NextResponse.next();
  }

  const locale = pickPreferredLocale(request.headers.get("accept-language"));
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;

  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};

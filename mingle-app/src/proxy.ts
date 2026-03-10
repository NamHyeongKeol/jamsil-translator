import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, isSupportedLocale, resolveSupportedLocaleTag, type AppLocale } from "@/i18n";

export { resolveSupportedLocaleTag } from "@/i18n";

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

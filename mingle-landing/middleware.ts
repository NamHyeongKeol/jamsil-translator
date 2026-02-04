import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const locales = ['en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'ar', 'hi', 'th', 'vi']
const defaultLocale = 'en'

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Check if pathname starts with a locale
  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  )

  if (pathnameHasLocale) {
    // Extract locale from path
    const locale = pathname.split('/')[1]

    // Rewrite to root but keep locale in URL for client-side detection
    const response = NextResponse.rewrite(new URL('/', request.url))
    response.headers.set('x-locale', locale)
    return response
  }

  // No locale in path - serve as-is (default English)
  return NextResponse.next()
}

export const config = {
  matcher: [
    // Match all paths except static files and api routes
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
}

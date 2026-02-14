import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const locales = ['en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'ar', 'hi', 'th', 'vi']
const versions = ['normal', 'flirting', 'working', 'gaming'] // 지원하는 버전 목록
const defaultVersion = 'normal'

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // API, static 파일 등은 패스
  if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname.includes('.')) {
    return NextResponse.next()
  }

  const segments = pathname.split('/').filter(Boolean)

  // Case 1: 루트 경로 "/" -> 기본 버전으로 rewrite (리디렉션 없이)
  if (segments.length === 0) {
    const response = NextResponse.rewrite(new URL(`/${defaultVersion}`, request.url))
    return response
  }

  const first = segments[0]
  const second = segments[1]

  // Case 2: /[version] (예: /normal, /flirting)
  if (versions.includes(first)) {
    // /normal 또는 /normal/ko 형태
    if (second && locales.includes(second)) {
      // /normal/ko -> 그대로 서빙
      return NextResponse.next()
    }
    // /normal -> 그대로 서빙 (locale은 클라이언트에서 감지)
    return NextResponse.next()
  }

  // Case 3: /[locale] (예: /ko, /ja) - 이전 URL 호환
  // 기존 /ko 링크는 /normal/ko로 rewrite
  if (locales.includes(first)) {
    const newPath = second 
      ? `/${defaultVersion}/${first}/${segments.slice(1).join('/')}`
      : `/${defaultVersion}/${first}`
    return NextResponse.rewrite(new URL(newPath, request.url))
  }

  // Case 4: 그 외 알 수 없는 경로 -> 그대로 (404 처리)
  return NextResponse.next()
}

export const config = {
  matcher: [
    // Match all paths except static files and api routes
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
}

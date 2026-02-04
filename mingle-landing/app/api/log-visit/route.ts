import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const { screenWidth, screenHeight, timezone, platform, language, pageLanguage, referrer, pathname } = await request.json()

  // Get IP from various headers (for proxies like Vercel, Cloudflare)
  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown'

  const userAgent = request.headers.get('user-agent') || 'unknown'

  try {
    const visitor = await prisma.visitor.create({
      data: {
        ipAddress,
        userAgent,
        language,
        pageLanguage,
        referrer,
        screenWidth,
        screenHeight,
        timezone,
        platform,
        pathname,
      },
    })
    return NextResponse.json({ success: true, id: visitor.id })
  } catch (error) {
    console.error('Log visit error:', error)
    return NextResponse.json({ error: 'Failed to log visit' }, { status: 500 })
  }
}

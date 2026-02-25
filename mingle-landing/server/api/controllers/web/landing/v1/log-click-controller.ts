import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function postLogClickForWebLandingV1(request: NextRequest) {
  const { buttonType, screenWidth, screenHeight, timezone, platform, language, referrer, pageLanguage, fullUrl, queryParams, pathname } = await request.json()

  // Get IP from various headers (for proxies like Vercel, Cloudflare)
  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown'

  const userAgent = request.headers.get('user-agent') || 'unknown'

  try {
    // Write to existing ButtonClick table (backward compatible)
    const click = await prisma.buttonClick.create({
      data: {
        buttonType: buttonType || 'unknown',
        ipAddress,
        userAgent,
        language,
        referrer,
        screenWidth,
        screenHeight,
        timezone,
        platform,
      },
    })

    // Also log to EventLog for unified tracking
    await prisma.eventLog.create({
      data: {
        eventType: 'click',
        ipAddress,
        userAgent,
        language,
        pageLanguage,
        referrer,
        fullUrl,
        queryParams,
        pathname,
        screenWidth,
        screenHeight,
        timezone,
        platform,
        metadata: { buttonType: buttonType || 'unknown' },
      },
    })

    return NextResponse.json({ success: true, id: click.id })
  } catch (error) {
    console.error('Log click error:', error)
    return NextResponse.json({ error: 'Failed to log click' }, { status: 500 })
  }
}

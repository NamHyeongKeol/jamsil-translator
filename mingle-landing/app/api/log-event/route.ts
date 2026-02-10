import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const {
    eventType,
    screenWidth,
    screenHeight,
    timezone,
    platform,
    language,
    pageLanguage,
    referrer,
    fullUrl,
    queryParams,
    pathname,
    metadata,
  } = await request.json()

  if (!eventType) {
    return NextResponse.json({ error: 'eventType is required' }, { status: 400 })
  }

  // Get IP from various headers (for proxies like Vercel, Cloudflare)
  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown'

  const userAgent = request.headers.get('user-agent') || 'unknown'

  try {
    const eventLog = await prisma.eventLog.create({
      data: {
        eventType,
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
        metadata: metadata ?? null,
      },
    })
    return NextResponse.json({ success: true, id: eventLog.id })
  } catch (error) {
    console.error('Log event error:', error)
    return NextResponse.json({ error: 'Failed to log event' }, { status: 500 })
  }
}

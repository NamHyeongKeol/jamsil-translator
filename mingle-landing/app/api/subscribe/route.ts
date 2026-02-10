import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const {
    email,
    feedback,
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
  } = await request.json()

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  // Get IP from various headers (for proxies like Vercel, Cloudflare)
  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown'

  const userAgent = request.headers.get('user-agent') || 'unknown'

  try {
    const subscriber = await prisma.subscriber.upsert({
      where: { email },
      update: { 
        updatedAt: new Date(),
        ...(feedback && { feedback }),
        // Update tracking info on re-subscribe
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
      },
      create: { 
        email,
        ...(feedback && { feedback }),
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
      },
    })

    // Also log to EventLog for unified tracking
    await prisma.eventLog.create({
      data: {
        eventType: 'subscribe',
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
        metadata: { email, feedback: feedback || null },
      },
    })

    return NextResponse.json({ success: true, subscriber })
  } catch (error) {
    console.error('Subscribe error:', error)
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 })
  }
}

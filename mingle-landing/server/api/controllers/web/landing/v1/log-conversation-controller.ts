import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function postLogConversationForWebLandingV1(request: NextRequest) {
  const { utterances, selectedLanguages, usageSec, fullUrl, queryParams, pathname, referrer, language, pageLanguage, timezone, platform, screenWidth, screenHeight } = await request.json()

  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown'
  const userAgent = request.headers.get('user-agent') || 'unknown'

  try {
    // Write to existing DemoConversation table (backward compatible)
    const conversation = await prisma.demoConversation.create({
      data: {
        ipAddress,
        userAgent,
        utterances: utterances || [],
        selectedLanguages: selectedLanguages || [],
        usageSec: usageSec ?? null,
      },
    })

    // Also log to EventLog for unified tracking
    await prisma.eventLog.create({
      data: {
        eventType: 'demo_conversation',
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
        metadata: {
          utterances: utterances || [],
          selectedLanguages: selectedLanguages || [],
          usageSec: usageSec ?? null,
        },
      },
    })

    return NextResponse.json({ success: true, id: conversation.id })
  } catch (error) {
    console.error('Log conversation error:', error)
    return NextResponse.json({ error: 'Failed to log conversation' }, { status: 500 })
  }
}

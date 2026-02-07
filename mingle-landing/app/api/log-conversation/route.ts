import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const { utterances, selectedLanguages, usageSec } = await request.json()

  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown'
  const userAgent = request.headers.get('user-agent') || 'unknown'

  try {
    const conversation = await prisma.demoConversation.create({
      data: {
        ipAddress,
        userAgent,
        utterances: utterances || [],
        selectedLanguages: selectedLanguages || [],
        usageSec: usageSec ?? null,
      },
    })
    return NextResponse.json({ success: true, id: conversation.id })
  } catch (error) {
    console.error('Log conversation error:', error)
    return NextResponse.json({ error: 'Failed to log conversation' }, { status: 500 })
  }
}

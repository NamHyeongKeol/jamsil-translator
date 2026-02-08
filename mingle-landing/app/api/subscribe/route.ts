import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const { email, feedback } = await request.json()

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  try {
    const subscriber = await prisma.subscriber.upsert({
      where: { email },
      update: { 
        updatedAt: new Date(),
        ...(feedback && { feedback }),
      },
      create: { 
        email,
        ...(feedback && { feedback }),
      },
    })
    return NextResponse.json({ success: true, subscriber })
  } catch (error) {
    console.error('Subscribe error:', error)
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 })
  }
}

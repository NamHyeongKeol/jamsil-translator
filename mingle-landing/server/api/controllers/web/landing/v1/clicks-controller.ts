import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function getClicksForWebLandingV1() {
  const clicks = await prisma.buttonClick.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return NextResponse.json(clicks)
}

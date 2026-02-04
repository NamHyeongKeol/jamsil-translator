import express from 'express'
import cors from 'cors'
import { PrismaClient } from '@prisma/client'

const app = express()
const prisma = new PrismaClient()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

// Trust proxy for getting real IP behind reverse proxies (Vercel, etc.)
app.set('trust proxy', true)

app.post('/api/subscribe', async (req, res) => {
  const { email } = req.body

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' })
  }

  try {
    const subscriber = await prisma.subscriber.upsert({
      where: { email },
      update: { updatedAt: new Date() },
      create: { email },
    })
    res.json({ success: true, subscriber })
  } catch (error) {
    console.error('Subscribe error:', error)
    res.status(500).json({ error: 'Failed to subscribe' })
  }
})

// Log button clicks with user info
app.post('/api/log-click', async (req, res) => {
  const { buttonType, screenWidth, screenHeight, timezone, platform, language, referrer } = req.body

  // Get IP from various headers (for proxies like Vercel, Cloudflare)
  const ipAddress = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
    || req.headers['x-real-ip']?.toString()
    || req.ip
    || req.socket.remoteAddress
    || 'unknown'

  const userAgent = req.headers['user-agent'] || 'unknown'

  try {
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
    res.json({ success: true, id: click.id })
  } catch (error) {
    console.error('Log click error:', error)
    res.status(500).json({ error: 'Failed to log click' })
  }
})

// Get click stats
app.get('/api/clicks', async (_req, res) => {
  const clicks = await prisma.buttonClick.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  res.json(clicks)
})

app.get('/api/subscribers', async (_req, res) => {
  const subscribers = await prisma.subscriber.findMany({
    orderBy: { createdAt: 'desc' },
  })
  res.json(subscribers)
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

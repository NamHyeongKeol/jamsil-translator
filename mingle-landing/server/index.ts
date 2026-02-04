import express from 'express'
import cors from 'cors'
import { PrismaClient } from '@prisma/client'

const app = express()
const prisma = new PrismaClient()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

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

app.get('/api/subscribers', async (_req, res) => {
  const subscribers = await prisma.subscriber.findMany({
    orderBy: { createdAt: 'desc' },
  })
  res.json(subscribers)
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

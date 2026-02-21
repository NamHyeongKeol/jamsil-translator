import { NextRequest, NextResponse } from 'next/server'
import {
  createTrackedEventLog,
  ensureTrackingContext,
  fireAndForgetDbWrite,
  parseClientContext,
  upsertTrackedUser,
} from '@/lib/app-analytics'

export const runtime = 'nodejs'

const INWORLD_API_BASE = 'https://api.inworld.ai'
const DEFAULT_MODEL_ID = process.env.INWORLD_TTS_MODEL_ID || 'inworld-tts-1.5-mini'
const DEFAULT_VOICE_ID = process.env.INWORLD_TTS_DEFAULT_VOICE_ID || 'Ashley'
const DEFAULT_SPEAKING_RATE = Number(process.env.INWORLD_TTS_SPEAKING_RATE || '1.3')
const VOICE_CACHE_TTL_MS = 1000 * 60 * 30

interface InworldVoiceItem {
  id?: string
  voiceId?: string
  name?: string
}

const voiceCache = new Map<string, { voiceId: string, expiresAt: number }>()

function getAuthHeaderValue(): string | null {
  const jwtToken = process.env.INWORLD_JWT?.trim()
  if (jwtToken) {
    if (jwtToken.startsWith('Bearer ')) {
      return jwtToken
    }
    return `Bearer ${jwtToken}`
  }

  const basicCredential = (
    process.env.INWORLD_BASIC
    || process.env.INWORLD_BASIC_KEY
    || process.env.INWORLD_RUNTIME_BASE64_CREDENTIAL
    || process.env.INWORLD_BASIC_CREDENTIAL
    || ''
  ).trim()
  if (basicCredential) {
    if (basicCredential.startsWith('Basic ')) {
      return basicCredential
    }
    return `Basic ${basicCredential}`
  }

  const apiKey = process.env.INWORLD_API_KEY?.trim()
  const apiSecret = process.env.INWORLD_API_SECRET?.trim()
  if (apiKey && !apiSecret) {
    if (apiKey.startsWith('Basic ')) return apiKey
    return `Basic ${apiKey}`
  }

  if (apiKey && apiSecret) {
    const credential = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')
    return `Basic ${credential}`
  }

  return null
}

function normalizeLanguage(input?: string): string | null {
  if (!input) return null
  const normalized = input.trim().replace(/_/g, '-').toLowerCase()
  if (!normalized) return null
  return normalized.split('-')[0] || null
}

function pickVoiceId(item: InworldVoiceItem): string | null {
  if (item.voiceId && typeof item.voiceId === 'string') return item.voiceId
  if (item.id && typeof item.id === 'string') return item.id
  if (item.name && typeof item.name === 'string') return item.name
  return null
}

async function resolveVoiceId(authHeader: string, language: string | null): Promise<string> {
  if (!language) return DEFAULT_VOICE_ID

  const now = Date.now()
  const cached = voiceCache.get(language)
  if (cached && cached.expiresAt > now) {
    return cached.voiceId
  }

  try {
    const url = `${INWORLD_API_BASE}/tts/v1/voices?filter=${encodeURIComponent(`language=${language}`)}`
    const response = await fetch(url, {
      headers: { Authorization: authHeader },
      cache: 'no-store',
    })
    if (!response.ok) {
      return DEFAULT_VOICE_ID
    }

    const data = await response.json() as { voices?: InworldVoiceItem[], items?: InworldVoiceItem[] }
    const voices = Array.isArray(data.voices) ? data.voices : (Array.isArray(data.items) ? data.items : [])
    const resolved = voices
      .map(pickVoiceId)
      .find((id): id is string => Boolean(id))

    const voiceId = resolved || DEFAULT_VOICE_ID
    voiceCache.set(language, { voiceId, expiresAt: now + VOICE_CACHE_TTL_MS })
    return voiceId
  } catch {
    return DEFAULT_VOICE_ID
  }
}

function decodeAudioContent(audioContent?: string): Buffer | null {
  if (!audioContent || typeof audioContent !== 'string') return null
  const cleaned = audioContent.replace(/^data:audio\/[a-zA-Z0-9.+-]+;base64,/, '').trim()
  if (!cleaned) return null

  try {
    return Buffer.from(cleaned, 'base64')
  } catch {
    return null
  }
}

function detectAudioMime(audioBuffer: Buffer): string {
  if (audioBuffer.length < 4) return 'application/octet-stream'
  const b = audioBuffer
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'audio/wav'
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg'
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg'
  return 'application/octet-stream'
}

export async function handleTtsInworldV1(request: NextRequest) {
  const body = await request.json().catch((): Record<string, unknown> => ({}))
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  const requestedVoiceId = typeof body?.voiceId === 'string' ? body.voiceId.trim() : ''
  const language = normalizeLanguage(typeof body?.language === 'string' ? body.language : '')
  const sessionKeyHint = typeof body?.sessionKey === 'string' ? body.sessionKey.trim() : null
  const clientMessageId = typeof body?.clientMessageId === 'string' ? body.clientMessageId.trim().slice(0, 128) : null
  const clientContext = parseClientContext(body?.clientContext)

  const authHeader = getAuthHeaderValue()
  if (!authHeader) {
    const response = NextResponse.json(
      {
        error:
          'INWORLD_BASIC (or INWORLD_RUNTIME_BASE64_CREDENTIAL / INWORLD_BASIC_CREDENTIAL) is required',
      },
      { status: 500 },
    )
    ensureTrackingContext(request, response, { sessionKeyHint })
    return response
  }

  if (!text) {
    const response = NextResponse.json({ error: 'text is required' }, { status: 400 })
    ensureTrackingContext(request, response, { sessionKeyHint })
    return response
  }

  const voiceId = requestedVoiceId || await resolveVoiceId(authHeader, language)

  try {
    const response = await fetch(`${INWORLD_API_BASE}/tts/v1/voice`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        voiceId,
        modelId: DEFAULT_MODEL_ID,
        audioConfig: {
          speakingRate: Number.isFinite(DEFAULT_SPEAKING_RATE) && DEFAULT_SPEAKING_RATE > 0
            ? DEFAULT_SPEAKING_RATE
            : 1.3,
        },
      }),
      cache: 'no-store',
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const errorResponse = NextResponse.json(
        { error: 'inworld_tts_failed', status: response.status, detail: detail.slice(0, 300) },
        { status: response.status },
      )

      const tracking = ensureTrackingContext(request, errorResponse, { sessionKeyHint })
      fireAndForgetDbWrite('tts.inworld.failed', async () => {
        const userId = await upsertTrackedUser({ tracking, clientContext })
        await createTrackedEventLog({
          userId,
          tracking,
          clientContext,
          sessionKey: tracking.sessionKey,
          eventType: 'tts_failed',
          metadata: {
            status: response.status,
            language,
            voiceId,
            modelId: DEFAULT_MODEL_ID,
            textLength: text.length,
            clientMessageId,
          },
        })
      })

      return errorResponse
    }

    const data = await response.json() as { audioContent?: string }
    const audioBuffer = decodeAudioContent(data.audioContent)

    if (!audioBuffer) {
      const invalidResponse = NextResponse.json({ error: 'invalid_audio_content' }, { status: 502 })
      ensureTrackingContext(request, invalidResponse, { sessionKeyHint })
      return invalidResponse
    }

    const audioResponse = new NextResponse(new Uint8Array(audioBuffer), {
      headers: {
        'Content-Type': detectAudioMime(audioBuffer),
        'Cache-Control': 'no-store',
        'X-TTS-Provider': 'inworld',
        'X-TTS-Voice-Id': voiceId,
      },
    })

    const tracking = ensureTrackingContext(request, audioResponse, { sessionKeyHint })
    fireAndForgetDbWrite('tts.inworld.success', async () => {
      const userId = await upsertTrackedUser({ tracking, clientContext })
      await createTrackedEventLog({
        userId,
        tracking,
        clientContext,
        sessionKey: tracking.sessionKey,
        eventType: 'tts_generated',
        metadata: {
          language,
          voiceId,
          modelId: DEFAULT_MODEL_ID,
          textLength: text.length,
          audioBytes: audioBuffer.byteLength,
          clientMessageId,
        },
      })
    })

    return audioResponse
  } catch (error) {
    console.error('Inworld TTS route error:', error)
    return NextResponse.json({ error: 'inworld_tts_internal_error' }, { status: 500 })
  }
}

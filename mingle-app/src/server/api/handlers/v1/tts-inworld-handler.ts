import { NextRequest, NextResponse } from 'next/server'
import {
  createTrackedEventLog,
  ensureTrackingContext,
  fireAndForgetDbWrite,
  parseClientContext,
  upsertTrackedUser,
} from '@/lib/app-analytics'
import { getInworldAuthHeaderValue } from '@/server/api/shared/inworld-auth'
import { decodeAudioContent, detectAudioMime } from '@/server/api/shared/audio-utils'
import { resolveVoiceId, INWORLD_API_BASE } from '@/server/api/shared/inworld-voice'

export const runtime = 'nodejs'

const DEFAULT_MODEL_ID = process.env.INWORLD_TTS_MODEL_ID || 'inworld-tts-1.5-mini'
const DEFAULT_SPEAKING_RATE = Number(process.env.INWORLD_TTS_SPEAKING_RATE || '1.3')

function normalizeLanguage(input?: string): string | null {
  if (!input) return null
  const normalized = input.trim().replace(/_/g, '-').toLowerCase()
  if (!normalized) return null
  return normalized.split('-')[0] || null
}

export async function handleTtsInworldV1(request: NextRequest) {
  const body = await request.json().catch((): Record<string, unknown> => ({}))
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  const requestedVoiceId = typeof body?.voiceId === 'string' ? body.voiceId.trim() : ''
  const language = normalizeLanguage(typeof body?.language === 'string' ? body.language : '')
  const sessionKeyHint = typeof body?.sessionKey === 'string' ? body.sessionKey.trim() : null
  const clientMessageId = typeof body?.clientMessageId === 'string' ? body.clientMessageId.trim().slice(0, 128) : null
  const clientContext = parseClientContext(body?.clientContext)

  const authHeader = getInworldAuthHeaderValue()
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

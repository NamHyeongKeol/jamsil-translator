import { NextRequest, NextResponse } from 'next/server'
import { runTranslationPipeline } from '@/lib/translator'
import {
  createTrackedEventLog,
  ensureTrackingContext,
  fireAndForgetDbWrite,
  parseClientContext,
  upsertTrackedUser,
} from '@/lib/app-analytics'

type TranslateRequest = {
  text?: string
  sourceLanguage?: string
  targetLanguage?: string
  sessionKey?: string
  clientContext?: Record<string, unknown>
}

export async function POST(request: NextRequest) {
  let payload: TranslateRequest

  try {
    payload = (await request.json()) as TranslateRequest
  } catch {
    const response = NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400 },
    )
    ensureTrackingContext(request, response)
    return response
  }

  const text = payload.text?.trim() ?? ''
  const sourceLanguage = payload.sourceLanguage?.trim() || 'auto'
  const targetLanguage = payload.targetLanguage?.trim() || 'en'
  const sessionKeyHint = payload.sessionKey?.trim() || null
  const clientContext = parseClientContext(payload.clientContext)

  if (!text) {
    const response = NextResponse.json(
      { error: 'Text is required.' },
      { status: 400 },
    )
    ensureTrackingContext(request, response, { sessionKeyHint })
    return response
  }

  const result = await runTranslationPipeline({
    text,
    sourceLanguage,
    targetLanguage,
  })

  const response = NextResponse.json({
    sourceLanguage: result.detectedLanguage,
    targetLanguage,
    translatedText: result.translatedText,
    provider: result.provider,
  })

  const tracking = ensureTrackingContext(request, response, { sessionKeyHint })
  fireAndForgetDbWrite('translate.single', async () => {
    const userId = await upsertTrackedUser({ tracking, clientContext })
    await createTrackedEventLog({
      userId,
      tracking,
      clientContext,
      sessionKey: tracking.sessionKey,
      eventType: 'translate_single',
      metadata: {
        sourceLanguage: result.detectedLanguage,
        targetLanguage,
        provider: result.provider,
        inputLength: text.length,
      },
    })
  })

  return response
}

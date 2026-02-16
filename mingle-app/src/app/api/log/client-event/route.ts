import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  createTrackedEventLog,
  ensureTrackingContext,
  parseClientContext,
  sanitizeNonNegativeInt,
  upsertTrackedUser,
} from '@/lib/app-analytics'

export const runtime = 'nodejs'

const ALLOWED_EVENT_TYPES = new Set([
  'stt_session_started',
  'stt_session_stopped',
  'stt_turn_started',
  'stt_turn_finalized',
])

function sanitizeText(value: unknown, maxLength = 512): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function normalizeLang(input: unknown): string {
  if (typeof input !== 'string') return 'unknown'
  const normalized = input.trim().replace('_', '-').toLowerCase().split('-')[0]
  return normalized || 'unknown'
}

function sanitizeTranslations(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const output: Record<string, string> = {}
  for (const [rawLanguage, rawText] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof rawText !== 'string') continue
    const language = normalizeLang(rawLanguage)
    if (!language || language === 'unknown') continue

    const text = rawText.replace(/<\/?end>/gi, '').trim().slice(0, 20000)
    if (!text) continue
    output[language] = text
  }
  return output
}

function sanitizeJsonObject(raw: unknown): Prisma.JsonObject | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  try {
    return JSON.parse(JSON.stringify(raw)) as Prisma.JsonObject
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    const response = NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    ensureTrackingContext(request, response)
    return response
  }

  const eventType = sanitizeText(body.eventType, 64)
  const sessionKeyHint = sanitizeText(body.sessionKey, 128)
  const clientMessageId = sanitizeText(body.clientMessageId, 128)
  const sourceLanguage = normalizeLang(body.sourceLanguage)
  const sourceText = sanitizeText(body.sourceText, 20000)
  const sttDurationMs = sanitizeNonNegativeInt(body.sttDurationMs)
  const totalDurationMs = sanitizeNonNegativeInt(body.totalDurationMs)
  const provider = sanitizeText(body.provider, 64)
  const model = sanitizeText(body.model, 128)
  const translations = sanitizeTranslations(body.translations)
  const clientMetadata = sanitizeJsonObject(body.metadata)
  const clientContext = parseClientContext(body.clientContext)
  const usageSecFromBody = sanitizeNonNegativeInt(body.usageSec)

  if (usageSecFromBody !== null) {
    clientContext.usageSec = usageSecFromBody
  }

  if (!eventType || !ALLOWED_EVENT_TYPES.has(eventType)) {
    const response = NextResponse.json({ error: 'eventType is invalid.' }, { status: 400 })
    ensureTrackingContext(request, response, { sessionKeyHint })
    return response
  }

  const response = NextResponse.json({ ok: true })
  const tracking = ensureTrackingContext(request, response, { sessionKeyHint })

  try {
    const userId = await upsertTrackedUser({ tracking, clientContext })
    let messageId: string | null = null

    if (eventType === 'stt_turn_finalized' && clientMessageId && sourceText) {
      const messageMetadata: Prisma.JsonObject = {
        clientMessageId,
        sourceLanguage,
        provider: provider ?? null,
        model: model ?? null,
        translationLanguages: Object.keys(translations),
      }
      if (clientMetadata) {
        messageMetadata.clientMetadata = clientMetadata
      }

      const message = await prisma.appMessage.upsert({
        where: {
          sessionKey_clientMessageId: {
            sessionKey: tracking.sessionKey,
            clientMessageId,
          },
        },
        create: {
          userId,
          sessionKey: tracking.sessionKey,
          clientMessageId,
          sourceLanguage,
          sttDurationMs: sttDurationMs ?? undefined,
          totalDurationMs: totalDurationMs ?? undefined,
          metadata: messageMetadata,
        },
        update: {
          userId,
          sourceLanguage,
          sttDurationMs: sttDurationMs ?? undefined,
          totalDurationMs: totalDurationMs ?? undefined,
          metadata: messageMetadata,
        },
        select: {
          id: true,
        },
      })
      messageId = message.id

      await prisma.appMessageContent.upsert({
        where: {
          messageId_contentType_language: {
            messageId: message.id,
            contentType: 'SOURCE',
            language: sourceLanguage,
          },
        },
        create: {
          messageId: message.id,
          contentType: 'SOURCE',
          language: sourceLanguage,
          text: sourceText,
          provider: provider ?? undefined,
          model: model ?? undefined,
        },
        update: {
          text: sourceText,
          provider: provider ?? undefined,
          model: model ?? undefined,
        },
      })

      for (const [language, translatedText] of Object.entries(translations)) {
        await prisma.appMessageContent.upsert({
          where: {
            messageId_contentType_language: {
              messageId: message.id,
              contentType: 'TRANSLATION_FINAL',
              language,
            },
          },
          create: {
            messageId: message.id,
            contentType: 'TRANSLATION_FINAL',
            language,
            text: translatedText,
            provider: provider ?? undefined,
            model: model ?? undefined,
          },
          update: {
            text: translatedText,
            provider: provider ?? undefined,
            model: model ?? undefined,
          },
        })
      }
    }

    const eventMetadata: Prisma.JsonObject = {}
    if (clientMessageId) eventMetadata.clientMessageId = clientMessageId
    if (sourceLanguage && sourceLanguage !== 'unknown') eventMetadata.sourceLanguage = sourceLanguage
    if (sourceText) eventMetadata.sourceTextLength = sourceText.length
    if (Object.keys(translations).length > 0) eventMetadata.translations = translations
    if (provider) eventMetadata.provider = provider
    if (model) eventMetadata.model = model
    if (sttDurationMs !== null) eventMetadata.sttDurationMs = sttDurationMs
    if (totalDurationMs !== null) eventMetadata.totalDurationMs = totalDurationMs
    if (clientMetadata) eventMetadata.clientMetadata = clientMetadata

    await createTrackedEventLog({
      userId,
      tracking,
      clientContext,
      sessionKey: tracking.sessionKey,
      messageId,
      eventType,
      metadata: Object.keys(eventMetadata).length > 0 ? eventMetadata : undefined,
    })

    return response
  } catch (error) {
    console.error('Client event logging failed:', error)
    const errorResponse = NextResponse.json({ error: 'client_event_log_failed' }, { status: 500 })
    ensureTrackingContext(request, errorResponse, { sessionKeyHint })
    return errorResponse
  }
}

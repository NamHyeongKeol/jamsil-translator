/**
 * 오디오 관련 공통 유틸리티 — base64 디코딩 및 MIME 타입 감지.
 * translate-finalize-handler, tts-inworld-handler 양쪽에서 사용.
 */

export function decodeAudioContent(audioContent?: string): Buffer | null {
  if (!audioContent || typeof audioContent !== 'string') return null
  const cleaned = audioContent.replace(/^data:audio\/[a-zA-Z0-9.+-]+;base64,/, '').trim()
  if (!cleaned) return null
  try {
    return Buffer.from(cleaned, 'base64')
  } catch {
    return null
  }
}

export function detectAudioMime(audioBuffer: Buffer): string {
  if (audioBuffer.length < 4) return 'application/octet-stream'
  const b = audioBuffer
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'audio/wav'
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg'
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg'
  return 'application/octet-stream'
}

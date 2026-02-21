// /api/translate/route.ts
// 단순 번역 엔드포인트 — 현재 미사용 (번역은 /api/web/app/v1/translate/finalize에서 처리).
// OpenAI 기반 runTranslationPipeline 제거로 인해 이 라우트는 비활성화됩니다.

import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'This endpoint is deprecated. Use /api/web/app/v1/translate/finalize instead.' },
    { status: 410 },
  )
}

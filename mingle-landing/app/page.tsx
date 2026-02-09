'use client'

import HomePage from '@/components/HomePage'

// 루트 페이지 - 미들웨어에서 /normal로 rewrite되므로 거의 사용되지 않지만
// fallback으로 기본 버전 렌더링
export default function RootPage() {
  return <HomePage version="normal" />
}

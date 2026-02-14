'use client'

import useRealtimeSTTCore from '@mingle/live-demo-core/use-realtime-stt'

export default function useRealtimeSTT(options: Parameters<typeof useRealtimeSTTCore>[0]) {
  return useRealtimeSTTCore({
    ...options,
    usageLimitSec: null,
    enableInitialDemo: false,
  })
}

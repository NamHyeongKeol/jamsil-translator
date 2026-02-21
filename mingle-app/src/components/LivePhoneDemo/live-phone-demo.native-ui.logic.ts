export const NATIVE_UI_EVENT = 'mingle:native-ui'
export const NATIVE_UI_QUERY_KEY = 'nativeUi'

export interface NativeUiScrollToTopEventDetail {
  type: 'scroll_to_top'
  source: string
}

export function parseNativeUiScrollToTopDetail(
  detail: unknown,
): NativeUiScrollToTopEventDetail | null {
  if (!detail || typeof detail !== 'object') return null

  const payload = detail as Record<string, unknown>
  if (payload.type !== 'scroll_to_top') return null

  const sourceRaw = payload.source
  const source = typeof sourceRaw === 'string' && sourceRaw.trim()
    ? sourceRaw.trim()
    : 'unknown'

  return {
    type: 'scroll_to_top',
    source,
  }
}

export function isNativeUiBridgeEnabledFromSearch(search: string): boolean {
  try {
    const params = new URLSearchParams(search || '')
    const value = (params.get(NATIVE_UI_QUERY_KEY) || '').trim().toLowerCase()
    return value === '1' || value === 'true'
  } catch {
    return false
  }
}

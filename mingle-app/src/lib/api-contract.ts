const DEFAULT_API_NAMESPACE = 'web/app/v1'

function normalizeApiNamespace(raw: string): string {
  return raw.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

function readApiNamespaceFromLocation(): string | null {
  if (typeof window === 'undefined') return null

  try {
    const query = new URLSearchParams(window.location.search || '')
    const fromQuery = query.get('apiNamespace') || query.get('apiNs') || ''
    const normalized = normalizeApiNamespace(fromQuery)
    return normalized || null
  } catch {
    return null
  }
}

const envNamespace = normalizeApiNamespace(process.env.NEXT_PUBLIC_API_NAMESPACE || DEFAULT_API_NAMESPACE)
const queryNamespace = readApiNamespaceFromLocation()

export const clientApiNamespace = queryNamespace || envNamespace || DEFAULT_API_NAMESPACE

export function buildClientApiPath(endpoint: `/${string}`): string {
  return `/api/${clientApiNamespace}${endpoint}`
}

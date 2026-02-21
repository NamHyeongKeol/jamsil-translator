const DEFAULT_API_NAMESPACE = 'web/landing/v1'
const ALLOWED_API_NAMESPACES = new Set([
  'web/landing/v1',
])

function normalizeApiNamespace(raw: string): string {
  return raw.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

function parseAllowedApiNamespace(raw: string): string | null {
  const normalized = normalizeApiNamespace(raw)
  if (!normalized || !ALLOWED_API_NAMESPACES.has(normalized)) {
    return null
  }

  return normalized
}

function readApiNamespaceFromLocation(): string | null {
  if (typeof window === 'undefined') return null

  try {
    const query = new URLSearchParams(window.location.search || '')
    const fromQuery = query.get('apiNamespace') || query.get('apiNs') || ''
    return parseAllowedApiNamespace(fromQuery)
  } catch {
    return null
  }
}

const envNamespace = parseAllowedApiNamespace(process.env.NEXT_PUBLIC_API_NAMESPACE || '')
const queryNamespace = readApiNamespaceFromLocation()

export const clientApiNamespace = queryNamespace || envNamespace || DEFAULT_API_NAMESPACE

export function buildLandingApiPath(endpoint: `/${string}`): string {
  return `/api/${clientApiNamespace}${endpoint}`
}

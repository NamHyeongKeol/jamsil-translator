const DEFAULT_API_NAMESPACE = 'web/app/v1'

const normalizedNamespace = (process.env.NEXT_PUBLIC_API_NAMESPACE || DEFAULT_API_NAMESPACE)
  .trim()
  .replace(/^\/+/, '')
  .replace(/\/+$/, '')

export const clientApiNamespace = normalizedNamespace || DEFAULT_API_NAMESPACE

export function buildClientApiPath(endpoint: `/${string}`): string {
  return `/api/${clientApiNamespace}${endpoint}`
}

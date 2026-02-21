export type ApiSurface = 'mobile' | 'web'
export type ApiPlatform = 'android' | 'app' | 'ios'
export type ApiVersion = 'v1'

export interface ApiNamespaceDescriptor {
  surface: ApiSurface
  platform: ApiPlatform
  version: ApiVersion
}

export function withApiNamespaceHeaders(
  response: Response,
  descriptor: ApiNamespaceDescriptor,
): Response {
  response.headers.set('X-Mingle-Api-Surface', descriptor.surface)
  response.headers.set('X-Mingle-Api-Platform', descriptor.platform)
  response.headers.set('X-Mingle-Api-Version', descriptor.version)
  return response
}

export const PACKAGE_NAME = '@laratype/client' as const

export { createClient } from './client'
export type { ApiNodeShape, ApiRootShape } from './client'
export type { CallInput, Client, ClientOf, ClientOptions, ClientResponse, EndpointCall, FetchLike, HeaderValues, Manifest, ManifestRoute, ResponseData } from './types'

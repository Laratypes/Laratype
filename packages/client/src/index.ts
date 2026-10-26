export const PACKAGE_NAME = '@laratype/client' as const

export { createClient } from './client'
export type { ApiNodeShape, ApiRootShape } from './client'
export type {
  CallInput,
  Client,
  ClientFailure,
  ClientOf,
  ClientOptions,
  ClientRequest,
  ClientResult,
  ClientSuccess,
  EndpointCall,
  FetchLike,
  HeaderValues,
  Manifest,
  ManifestRoute,
  ResponseData,
  UnexpectedResult,
} from './types'

export const PACKAGE_NAME = '@laratype/client' as const

export { createClient } from './client'
export { ResponseValidationError } from './validate'
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
  ManifestClientOptions,
  ManifestRoute,
  ProvidedHeaders,
  ResponseData,
  UnexpectedResult,
} from './types'

export const PACKAGE_NAME = '@laratype/client' as const

export { createClient } from './client'
export type {
  CallInput,
  Client,
  ClientFailure,
  ClientOf,
  ClientOptions,
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

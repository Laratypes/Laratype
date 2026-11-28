export const PACKAGE_NAME = "@laratype/client-query" as const;

export { createQueryApi } from "./query";
export { CLIENT_QUERY_ERROR, ClientQueryApiError, ClientQueryError, isClientQueryError } from "./error";
export type { ClientFailureResult } from "./error";
export type {
  AnyEndpointCall,
  ClientMutationOptions,
  ClientQueryContext,
  ClientQueryOptions,
  ClientShape,
  QueryEndpoint,
  QueryKey,
  QueryKeyOf,
  QueryTree,
} from "./types";

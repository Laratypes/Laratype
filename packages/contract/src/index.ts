export const PACKAGE_NAME = '@laratype/contract' as const

export * from "./standard-schema";
export * from "./validate";
export * from "./path";
export type * from "./json";
export * from "./errors";
export * from "./capabilities";
export * from "./endpoint";
export * from "./contract";
export * from "./api-types";
export * from "./url";
// The endpoint path rule and the origin/baseUrl rules shared with @laratype/client (C11 #293), internal: not part of
// the documented public API.
export { isAbsoluteUrl, isEndpointPath, leavesOrigin } from "./internal";

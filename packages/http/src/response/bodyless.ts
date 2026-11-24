import { isBodylessStatus } from "@laratype/contract";

/**
 * Whether a response with this status never carries a body: 204 No Content and 205 Reset Content (RFC 9110 §15.3.5,
 * §15.3.6, the contract's success rule) and 304 Not Modified (§15.4.5), which an error answer can be. The exception
 * filter and the undeclared-error check share it, so both agree on whether a code reaches the client (X3 #157).
 */
export const isBodylessResponse = (status: number): boolean => isBodylessStatus(status) || status === 304;

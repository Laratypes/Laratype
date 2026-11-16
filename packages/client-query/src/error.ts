import type { ClientFailure, UnexpectedResult } from "@laratype/client";
import type { EndpointShape } from "@laratype/contract";

/** Every failure a call can have without knowing its endpoint: its declared errors and the unexpected variant. */
export type ClientFailureResult = ClientFailure<EndpointShape> | UnexpectedResult;

/**
 * The brand of a `ClientQueryError`. A thrown error may come from another copy of the package, where `instanceof`
 * fails, so `isClientQueryError` checks this `Symbol.for` brand instead.
 */
export const CLIENT_QUERY_ERROR: unique symbol = Symbol.for("laratype.clientQueryError");

/** The message of a failed call: the route name relative to the client root, and the declared code or `unexpected`. */
const messageOf = (name: string, result: ClientFailureResult): string =>
  result.code === undefined
    ? `[@laratype/client-query] "${name}" failed unexpectedly (status ${result.status})`
    : `[@laratype/client-query] "${name}" failed with code "${result.code}" (status ${result.status})`;

/**
 * What a query or a mutation throws when its call did not succeed: `result` is the call's failure variant
 * (`ok: false`), so `result.code`, `result.error` and `result.unexpected` narrow exactly as a failed call's.
 */
export class ClientQueryError<F extends ClientFailureResult = ClientFailureResult> extends Error {
  readonly [CLIENT_QUERY_ERROR] = true;
  /** The failure variant of the call, as the client returned it. */
  readonly result: F;
  /** The HTTP status of the failed call, or `0` for a network failure or an abort before the headers. */
  readonly status: F["status"];
  /** The declared error code, or `undefined` when the result is unexpected (see `result.unexpected`). */
  readonly code: F["code"];

  constructor(name: string, result: F) {
    super(messageOf(name, result), { cause: result.error });
    this.name = "ClientQueryError";
    this.result = result;
    this.status = result.status;
    this.code = result.code;
  }
}

/** Whether a thrown value is a `ClientQueryError`, including one thrown by another copy of the package. */
export function isClientQueryError(value: unknown): value is ClientQueryError {
  return (
    typeof value === "object" && value !== null && (value as { [CLIENT_QUERY_ERROR]?: unknown })[CLIENT_QUERY_ERROR] === true
  );
}

/** A misuse of `createQueryApi`, not a failed call: the argument is not a client, or a route shadows a node key. */
export class ClientQueryApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientQueryApiError";
  }
}

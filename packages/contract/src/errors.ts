export interface ErrorDef<St extends number = number, Body = unknown> {
  readonly status: St;
  readonly code: string;
  /** phantom: only carries the body type */
  readonly __body?: Body;
}

export interface MessageBody {
  message: string;
}

export interface ValidationErrorBody extends MessageBody {
  /** dot path -> messages, e.g. { "address.zip": ["Required"] } */
  errors: Record<string, string[]>;
}

/** Status of an error def (or union of defs). */
export type ErrorStatus<E> = E extends ErrorDef<infer St, any> ? St : never;

/** Body type carried by an error def (or union of defs). */
export type ErrorBody<E> = E extends ErrorDef<any, infer Body> ? Body : never;

/** Error union as `{ status, body }`, narrowable by `status` (server exception filter, client result union). */
export type ErrorResponse<E> = E extends ErrorDef<infer St, infer Body> ? { status: St; body: Body } : never;

export const defineError = <St extends number, Body = MessageBody>(status: St, code: string): ErrorDef<St, Body> =>
  Object.freeze({ status, code });

export const errors = Object.freeze({
  unauthorized: defineError<401>(401, "UNAUTHORIZED"),
  forbidden: defineError<403>(403, "FORBIDDEN"),
  notFound: defineError<404>(404, "NOT_FOUND"),
  conflict: defineError<409>(409, "CONFLICT"),
  validation: defineError<422, ValidationErrorBody>(422, "VALIDATION_ERROR"),
  tooManyRequests: defineError<429>(429, "TOO_MANY_REQUESTS"),
});

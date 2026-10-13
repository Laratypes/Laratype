import type { ErrorBag } from "./validate";

export interface MessageBody {
  message: string;
}

export interface ValidationErrorBody extends MessageBody {
  /** dot path -> messages, e.g. { "address.zip": ["Required"] } */
  errors: Record<string, string[]>;
}

/**
 * What a contract error factory throws. Match it with `E.is(e)`, which compares `code`
 * (not `instanceof`), so it also works across bundles and package copies.
 */
export class ContractError<St extends number = number, Code extends string = string, Body = unknown> extends Error {
  readonly status: St;
  readonly code: Code;
  readonly body: Body;

  constructor(status: St, code: Code, body: Body) {
    const message = (body as Partial<MessageBody> | null)?.message;
    super(typeof message === "string" ? message : code);
    this.name = "ContractError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/**
 * A throwable error factory: `throw EmailTaken(email)`, `.throws(EmailTaken)`, `EmailTaken.is(e)`.
 * The body type is carried by the factory's return type.
 */
export interface ErrorDef<St extends number = number, Code extends string = string, Body = unknown, Args extends unknown[] = any[]> {
  (...args: Args): ContractError<St, Code, Body>;
  readonly status: St;
  readonly code: Code;
  /** Compares `code`, not `instanceof`, so it works across bundles. */
  is(error: unknown): error is ContractError<St, Code, Body>;
}

export type AnyErrorDef = ErrorDef<number, string, any, any[]>;

/** Status of an error def (or union of defs). */
export type ErrorStatus<E> = E extends ErrorDef<infer St, any, any, any> ? St : never;

/** Code of an error def (or union of defs). */
export type ErrorCode<E> = E extends ErrorDef<any, infer Code, any, any> ? Code : never;

/** Body type carried by an error def (or union of defs). */
export type ErrorBody<E> = E extends ErrorDef<any, any, infer Body, any> ? Body : never;

/** Error union as `{ status, code, body }`, narrowable by `code` (two errors can share a status). */
export type ErrorResponse<E> = E extends ErrorDef<infer St, infer Code, infer Body, any> ? { status: St; code: Code; body: Body } : never;

const UPPER_SNAKE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

const fail = (message: string): never => {
  throw new TypeError(`[@laratype/contract] ${message}`);
};

const messageBody = (fallback: string) => (message?: string): MessageBody => ({ message: message ?? fallback });

function make<St extends number, Code extends string, Body, Args extends unknown[]>(
  status: St,
  code: Code,
  body: (...args: Args) => Body,
): ErrorDef<St, Code, Body, Args> {
  if (!Number.isInteger(status)) fail(`defineError: invalid status ${JSON.stringify(status)}`);
  if (typeof code !== "string" || !UPPER_SNAKE.test(code)) fail(`defineError: code ${JSON.stringify(code)} must be UPPER_SNAKE`);
  const factory = (...args: Args) => new ContractError(status, code, body(...args));
  const is = (error: unknown): error is ContractError<St, Code, Body> =>
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
  Object.defineProperties(factory, {
    status: { value: status, enumerable: true },
    code: { value: code, enumerable: true },
    is: { value: is },
  });
  return Object.freeze(factory) as unknown as ErrorDef<St, Code, Body, Args>;
}

/**
 * Defines a domain error: an HTTP status, an `UPPER_SNAKE` code and an optional body factory.
 * Without a body factory the body is `{ message }`, and the message defaults to the code.
 *
 * @example
 * export const EmailTaken = defineError(409, "EMAIL_TAKEN", (email: string) => ({ email }))
 * throw EmailTaken(input.email)
 */
export function defineError<const St extends number, const Code extends string>(
  status: St,
  code: Code,
): ErrorDef<St, Code, MessageBody, [message?: string]>;
export function defineError<const St extends number, const Code extends string, Args extends unknown[], Body>(
  status: St,
  code: Code,
  body: (...args: Args) => Body,
): ErrorDef<St, Code, Body, Args>;
export function defineError(status: number, code: string, body?: (...args: any[]) => unknown): AnyErrorDef {
  if (body !== undefined && typeof body !== "function") fail(`defineError("${code}"): body must be a function`);
  return make(status, code, body ?? messageBody(code));
}

/** The errors the framework derives from contract capabilities (422, 404, 401, 403, 429). */
export const errors = Object.freeze({
  unauthorized: make(401, "UNAUTHORIZED", messageBody("Unauthenticated.")),
  forbidden: make(403, "FORBIDDEN", messageBody("This action is unauthorized.")),
  notFound: make(404, "NOT_FOUND", messageBody("Not Found.")),
  validation: make(422, "VALIDATION_ERROR", (errors: ErrorBag, message?: string): ValidationErrorBody => ({
    message: message ?? "The given data was invalid.",
    errors,
  })),
  tooManyRequests: make(429, "TOO_MANY_REQUESTS", messageBody("Too Many Requests.")),
});

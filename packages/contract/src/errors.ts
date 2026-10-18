import type { ErrorBag } from "./validate";
import { fail } from "./internal";
import type { Digit, ToNumber } from "./internal";

/** An error status: `400` to `599`, so a declared error is always classified as a failure. */
export type FailureStatus = ToNumber<`${4 | 5}${Digit}${Digit}`>;

export interface MessageBody {
  message: string;
}

export interface ValidationErrorBody extends MessageBody {
  /** dot path -> messages, e.g. { "address.zip": ["Required"] } */
  errors: Record<string, string[]>;
}

/**
 * What a contract error factory throws. Match it with `E.is(e)`, which compares `code` and `status`
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
  /** Compares `code` and `status`, not `instanceof`, so it works across bundles. */
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

/**
 * An error goes on the wire as `{ code, ...body }` (client.md › Result union), so a body is an object without its own
 * `code`. The type accepts any object (an index signature too) that has no written-out `code` key, checked per union
 * member; the runtime check is stricter and requires a plain object (a `null` prototype or any realm's
 * `Object.prototype`), so a `Map`, `Date` or class instance passes the type but throws when the error is created.
 */
export type CheckErrorBody<Body> = [BodyProblem<Body>] extends [never] ? unknown : { error: BodyProblem<Body> };

/** The keys written out in a type, without index signatures: `Record<string, string>` has none. */
type LiteralKeys<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : symbol extends K ? never : K]: 0 };

/** Why a body type cannot go on the wire, per union member (so one member with `code` is enough); `any` is left to runtime. */
type BodyProblem<B> = 0 extends 1 & B
  ? never
  : B extends (...args: any[]) => unknown
    ? "defineError: the body must be an object, not a function (the error is sent as { code, ...body })"
    : B extends readonly unknown[]
      ? "defineError: the body must be an object, not an array (the error is sent as { code, ...body })"
      : B extends object
        ? "code" extends LiteralKeys<B>
          ? "defineError: the body must not have its own \"code\" key (the error is sent as { code, ...body })"
          : never
        : "defineError: the body must be an object (the error is sent as { code, ...body })";

const checkBody = (code: string, body: unknown): void => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    fail(`${code}: the body must be an object, got ${Array.isArray(body) ? "an array" : body === null ? "null" : typeof body} (the error is sent as { code, ...body })`);
  }
  // a plain object only: Map, Set, Date or a class instance would not spread into { code, ...body } as written.
  // Any realm's Object.prototype is itself the root (its prototype is null), so an iframe's or a vm's object passes.
  const proto: object | null = Object.getPrototypeOf(body);
  // a realm's Object.prototype is the root of its chain and has its own hasOwnProperty; a bare null-prototype
  // object used as a prototype is not one
  const plain = proto === null || (Object.getPrototypeOf(proto) === null && Object.prototype.hasOwnProperty.call(proto, "hasOwnProperty"));
  if (!plain) {
    fail(`${code}: the body must be a plain object, got ${(proto as { constructor?: { name?: string } } | null)?.constructor?.name || "an object with a custom prototype"} (the error is sent as { code, ...body })`);
  }
  if (Object.prototype.hasOwnProperty.call(body, "code")) fail(`${code}: the body must not have its own "code" key (the error is sent as { code, ...body })`);
};

const messageBody = (fallback: string) => (message?: string): MessageBody => ({ message: message ?? fallback });

function make<St extends number, Code extends string, Body, Args extends unknown[]>(
  status: St,
  code: Code,
  body: (...args: Args) => Body,
): ErrorDef<St, Code, Body, Args> {
  if (!Number.isInteger(status)) fail(`defineError: invalid status ${JSON.stringify(status)}`);
  if (status < 400 || status > 599) fail(`defineError: status ${status} must be an error status (400-599)`);
  if (typeof code !== "string" || !UPPER_SNAKE.test(code)) fail(`defineError: code ${JSON.stringify(code)} must be UPPER_SNAKE`);
  const factory = (...args: Args) => {
    const value = body(...args);
    checkBody(code, value);
    return new ContractError(status, code, value);
  };
  // code and status: errors are unique by both (a 410 NOT_FOUND is not the catalog 404)
  const is = (error: unknown): error is ContractError<St, Code, Body> =>
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code &&
    (error as { status?: unknown }).status === status;
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
 * The body must be an object without its own `code` key: on the wire the error is `{ code, ...body }`.
 *
 * @example
 * export const EmailTaken = defineError(409, "EMAIL_TAKEN", (email: string) => ({ email }))
 * throw EmailTaken(input.email)
 */
export function defineError<const St extends FailureStatus, const Code extends string>(
  status: St,
  code: Code,
): ErrorDef<St, Code, MessageBody, [message?: string]>;
export function defineError<const St extends FailureStatus, const Code extends string, Args extends unknown[], Body>(
  status: St,
  code: Code,
  body: ((...args: Args) => Body) & CheckErrorBody<Body>,
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

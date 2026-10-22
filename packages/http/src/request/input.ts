import { HTTPException } from "hono/http-exception";
import type { HonoRequest } from "hono/request";
import { errors, toErrorBag, validate } from "@laratype/contract";
import type { AnyEndpoint, StandardIssue, StandardSchemaV1 } from "@laratype/contract";

/**
 * Parsing and validation of a request's input (docs/v1/validation.md › Pipeline validation and 422): the body by its
 * media type, the query, and the `query` and `body` schemas of a contract route.
 */

/**
 * The media type Hono's `validator('json')` reads as JSON: `application/json` and `application/*+json`, with any
 * parameters (`; charset=utf-8`). Hono's regex, which it does not export, plus the `i` flag: media types are
 * case-insensitive (RFC 9110 §8.3.1), so `Application/JSON` is JSON too.
 */
const JSON_MEDIA_TYPE = /^application\/([a-z-\.]+\+)?json(;\s*[a-zA-Z0-9\-]+\=([^;]+))*$/i;

export const isJsonMediaType = (contentType: string | undefined): boolean =>
  contentType !== undefined && JSON_MEDIA_TYPE.test(contentType);

/** As Hono's `validator('json')` answers it, with a JSON body like the other error responses. */
const malformedJson = () =>
  new HTTPException(400, { res: Response.json({ message: "Malformed JSON in request body." }, { status: 400 }) });

/**
 * The request body: JSON for a JSON media type, else the form fields `parseBody()` reads (`multipart/form-data` and
 * `x-www-form-urlencoded`, files as web `File`s, `{}` for any other type). A malformed JSON body is a 400. Hono caches
 * the parsed body, so a second call reads it again for free.
 */
export const readBody = async (request: HonoRequest): Promise<unknown> => {
  if (!isJsonMediaType(request.header("Content-Type"))) {
    return request.parseBody({ dot: true });
  }
  try {
    return await request.json();
  } catch {
    throw malformedJson();
  }
};

/**
 * The query string as the client's `buildUrl` sends it: a key once is a string, a repeated key an array. Converting
 * a value (`"2"` to `2`) is the schema's job (`z.coerce.number<number>()`). `fromEntries` defines own keys, so a
 * `__proto__` key stays a key.
 */
export const readQuery = (request: HonoRequest): Record<string, string | string[]> =>
  Object.fromEntries(Object.entries(request.queries()).map(([key, values]) => [key, values.length === 1 ? values[0]! : values]));

type Segment = NonNullable<StandardIssue["path"]>[number];

const RECEIVED_TAILS = (received: string) => [`, received '${received}'`, `, received ${received}`, ` but received ${received}`];

/**
 * An issue's message without the submitted value: zod 3 (`Invalid enum value. Expected 'a' | 'b', received 'c'`) and
 * valibot (`Invalid type: Expected string but received 5`) end their default messages with the issue's `received`.
 * It is the client's own data, but it would reach proxy and client logs. A message of the app's own is kept.
 */
const issueMessage = (issue: StandardIssue & { readonly received?: unknown }): string => {
  const { received } = issue;
  if (!["string", "number", "boolean", "bigint"].includes(typeof received)) return issue.message;
  const tail = RECEIVED_TAILS(String(received)).find((suffix) => issue.message.endsWith(suffix));
  return tail ? issue.message.slice(0, -tail.length) : issue.message;
};

/**
 * What a 422 may carry of an issue: `{ path, message }` only, never the library's `input`, `received` or `keys`, with
 * `{ key }` path segments unwrapped.
 */
export const publicIssue = (issue: StandardIssue): { path: PropertyKey[]; message: string } => ({
  path: (issue.path ?? []).map((segment: Segment) => (typeof segment === "object" ? segment.key : segment)),
  message: issueMessage(issue),
});

/**
 * The 422 of a contract route, `{ code: "VALIDATION_ERROR", message, errors }` (docs/v1/http.md › Exceptions), as a
 * Hono `HTTPException` that `Response.resolveException` sends as it is, until H5 #108 maps a thrown `ContractError`.
 */
const unprocessable = (issues: readonly StandardIssue[]) => {
  const error = errors.validation(toErrorBag(issues.map(publicIssue)));
  return new HTTPException(422, { res: Response.json({ code: error.code, ...error.body }, { status: 422 }) });
};

/** The raw input of a contract route, before validation. */
export interface RawInput {
  readonly params: Record<string, string>;
  readonly query: unknown;
  readonly body: unknown;
}

type Slot = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly issues: readonly StandardIssue[] };

/** A slot without a schema is `undefined`, as `InferOut<undefined>` types it: the handler never sees unvalidated input. */
const validateSlot = async (schema: StandardSchemaV1 | undefined, value: unknown): Promise<Slot> =>
  schema ? validate(schema, value) : { ok: true, value: undefined };

/**
 * Validates the query and the body of a contract route with the endpoint's schemas, through the contract's
 * Standard Schema adapter. Invalid input in either is one 422 listing the issues of both. Only invalid input is a
 * 422: an error thrown inside a schema rejects, and ends as a generic 500.
 */
export const validateInput = async (endpoint: AnyEndpoint, input: RawInput): Promise<{ query: unknown; body: unknown }> => {
  const query = await validateSlot(endpoint.def.query, input.query);
  const body = await validateSlot(endpoint.def.body, input.body);
  if (!query.ok || !body.ok) {
    throw unprocessable([...(query.ok ? [] : query.issues), ...(body.ok ? [] : body.issues)]);
  }
  return { query: query.value, body: body.value };
};

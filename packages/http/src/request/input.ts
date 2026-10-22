import { HTTPException } from "hono/http-exception";
import type { HonoRequest } from "hono/request";
import { errors, issuePath, toErrorBag, validate } from "@laratype/contract";
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
 * `x-www-form-urlencoded`, files as web `File`s, `{}` for any other type). An empty JSON body is no body, `{}` as for
 * the other types (a client may send its JSON Content-Type on a GET); a malformed one is a 400.
 */
export const readBody = async (request: HonoRequest): Promise<unknown> => {
  if (!isJsonMediaType(request.header("Content-Type"))) {
    return request.parseBody({ dot: true });
  }
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw malformedJson();
  }
};

/**
 * The query string as the client's `buildUrl` sends it: a key once is a string, a repeated key an array. Converting
 * a value (`"2"` to `2`) is the schema's job (`z.coerce.number<number>()`). Hono's `queries()` drops a `__proto__` key.
 */
export const readQuery = (request: HonoRequest): Record<string, string | string[]> =>
  Object.fromEntries(Object.entries(request.queries()).map(([key, values]) => [key, values.length === 1 ? values[0]! : values]));

/** The fields of zod and valibot issues that hold submitted data. */
type LibraryIssue = StandardIssue & { readonly code?: unknown; readonly received?: unknown; readonly keys?: unknown };

const RECEIVED = "received ";

/** A message ending in a letter, digit or combining mark (whole code points): `received` after it is not a word. */
const ENDS_IN_WORD = /[\p{L}\p{N}\p{M}]$/u;

/** The separators left before a cut tail: `, `, `: `, ` but `, in any mix. */
const TRAILING_SEPARATORS = /(?:\s+but|[,:]|\s)+$/i;

/**
 * The index of `received <value>` at the end of a message, as a word, the value bare or quoted, in any case. Taken
 * in the message itself, comparing lowercased copies only: lowercasing can change a string's length (`İ` becomes
 * two code units), so an index into the lowercased message would cut too early.
 */
const receivedAt = (message: string, received: string): number => {
  for (const value of [received, `'${received}'`, `"${received}"`]) {
    const at = message.length - value.length - RECEIVED.length;
    if (at < 0 || ENDS_IN_WORD.test(message.slice(0, at))) continue;
    if (message.slice(at).toLowerCase() === `${RECEIVED}${value}`.toLowerCase()) return at;
  }
  return -1;
};

/**
 * An issue's message without the submitted data, which would reach proxy and client logs. Default messages put it
 * last: zod 3 and valibot end with the word `received` and the issue's `received`, in any case (`Invalid enum
 * value. Expected 'a' | 'b', received 'c'`, `Invalid type: Expected string but received 5`, `Invalid email:
 * Received "a@b"`), cut with the separators before it; zod's unrecognized keys follow the first `": "`. A zod
 * `invalid_type` keeps its `received`, a type name. Any other message is kept as it is. `publicIssue` turns a
 * message with nothing left into `Invalid value`.
 */
const issueMessage = (issue: LibraryIssue): string => {
  const { message, code, received, keys } = issue;
  if (Array.isArray(keys) && keys.length > 0) {
    const at = message.indexOf(": ");
    if (at !== -1 && keys.every((key) => message.slice(at).includes(String(key)))) return message.slice(0, at);
  }
  if (code === "invalid_type" || !["string", "number", "boolean", "bigint"].includes(typeof received)) return message;
  const at = receivedAt(message, String(received));
  return at === -1 ? message : message.slice(0, at).replace(TRAILING_SEPARATORS, "");
};

/** What a 422 may carry of an issue: `{ path, message }` only, never the library's `input`, `received` or `keys`. */
export const publicIssue = (issue: StandardIssue): { path: PropertyKey[]; message: string } => ({
  path: issuePath(issue),
  // A message that was only the submitted data (`Received "x"`, `: a`) has nothing left: a generic one, never the data
  message: issueMessage(issue) || "Invalid value",
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
  // In turn: a query schema that throws stops before the body schema's side effects (an async refinement's lookup)
  const query = await validateSlot(endpoint.def.query, input.query);
  const body = await validateSlot(endpoint.def.body, input.body);
  if (!query.ok || !body.ok) {
    throw unprocessable([...(query.ok ? [] : query.issues), ...(body.ok ? [] : body.issues)]);
  }
  return { query: query.value, body: body.value };
};

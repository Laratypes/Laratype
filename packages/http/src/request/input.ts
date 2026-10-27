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
 * parameters (`; charset=utf-8`), the OWS RFC 9110 §8.3.1 allows before the `;` (`application/json ; charset=utf-8`)
 * included. Hono's regex, which it does not export, with digits and `_` in the vendor subtype too
 * (`application/vnd.github.v3+json`, H26 #287; `application/vnd.my_app+json`, RFC 6838) and the `i` flag: media types
 * are case-insensitive (RFC 9110 §8.3.1), so `Application/JSON` is JSON too.
 */
const JSON_MEDIA_TYPE = /^application\/([a-z0-9._-]+\+)?json\s*(;\s*[a-zA-Z0-9\-]+\=([^;]+))*$/i;

export const isJsonMediaType = (contentType: string | undefined): boolean =>
  contentType !== undefined && JSON_MEDIA_TYPE.test(contentType);

/** A bad request as Hono's `validator()` answers it, with a JSON body like the other error responses. */
const badRequest = (message: string) => new HTTPException(400, { res: Response.json({ message }, { status: 400 }) });

const MALFORMED_FORM = "Malformed form data in request body.";
const MALFORMED_JSON = "Malformed JSON in request body.";

/** A form body of whitespace only: the ASCII whitespace `String.prototype.trim()` strips. A body is bytes: no encoding
 * tells Unicode whitespace from data, so only these count. */
const isBlankBody = (bytes: Uint8Array): boolean => {
  for (const byte of bytes) {
    if (byte !== 0x20 && (byte < 0x09 || byte > 0x0d)) return false;
  }
  return true;
};

/** The media types Hono's `parseBody()` reads as form fields; a request of any other type has no body, `{}`. */
const isFormMediaType = (contentType: string | undefined): boolean =>
  contentType !== undefined && (contentType.startsWith("multipart/form-data") || contentType.startsWith("application/x-www-form-urlencoded"));

/** Hono's `bodyLimit` (4.9.6) errors the body stream with this error; its handler has to see it to answer the 413. */
const isBodyLimitError = (error: unknown): boolean => error instanceof Error && error.name === "BodyLimitError";

/** A client that went away mid-body: `@hono/node-server` aborts the request's signal when the connection closes. */
const isClientAbort = (request: HonoRequest): boolean => request.raw.signal.aborted;

/**
 * The body is gone when a reader took it off `c.req.raw` itself: Hono's cache holds nothing, so neither reader can serve
 * it. That is a server bug, the generic 500 (docs/v1/validation.md › Pipeline validation and 422 › Diagnostics).
 */
const assertBodyReadable = (request: HonoRequest): void => {
  if (request.raw.bodyUsed && Object.keys(request.bodyCache).length === 0) {
    throw new TypeError("the request body was already read, so the pipeline cannot parse it");
  }
};

/**
 * The form body, as `parseBody()` reads it. `arrayBuffer()` reads it through Hono's cache, so a body an earlier
 * middleware read with `c.req.text()`, `c.req.parseBody()` or `validator('form')` is served from that cache; blank
 * bytes are no body, `{}`, because `formData()` rejects an empty `multipart/form-data` body, yet a client may send its
 * form Content-Type on a GET or a DELETE with no body. A body `formData()` rejects is the client's 400; Hono's
 * `bodyLimit` error is rethrown for its 413; a client abort is that 400 too; anything else is a server bug, the 500.
 */
const readFormBody = async (request: HonoRequest): Promise<unknown> => {
  const contentType = request.header("Content-Type");
  if (contentType === undefined || !isFormMediaType(contentType)) return {};
  assertBodyReadable(request);
  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch (error) {
    if (isBodyLimitError(error)) throw error;
    if (isClientAbort(request)) throw badRequest(MALFORMED_FORM);
    throw error;
  }
  if (isBlankBody(new Uint8Array(bytes))) return {};
  try {
    // Hono rebuilds a cached body's FormData without the request's Content-Type, which a multipart boundary needs:
    // seed the cache as `validator('form')` does, so `parseBody()` only converts the fields (dot: true)
    if (request.bodyCache.parsedBody === undefined && request.bodyCache.formData === undefined) {
      request.bodyCache.formData = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
    }
    return await request.parseBody({ dot: true });
  } catch (error) {
    if (isBodyLimitError(error)) throw error;
    if (error instanceof TypeError || isClientAbort(request)) throw badRequest(MALFORMED_FORM);
    throw error;
  }
};

/** The JSON body. Hono's cache serves a body an earlier middleware read, as for forms; a client abort is the 400. */
const readJsonBody = async (request: HonoRequest): Promise<unknown> => {
  assertBodyReadable(request);
  let text: string;
  try {
    text = await request.text();
  } catch (error) {
    if (isBodyLimitError(error)) throw error;
    if (isClientAbort(request)) throw badRequest(MALFORMED_JSON);
    throw error;
  }
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest(MALFORMED_JSON);
  }
};

/**
 * The request body: JSON for a JSON media type, else the form fields `parseBody()` reads (`multipart/form-data` and
 * `x-www-form-urlencoded`, files as web `File`s, `{}` for any other type). An empty body is no body, `{}` for the JSON
 * and the form types alike (a client may send its Content-Type on a GET); a malformed one is a 400, and so is a form
 * body `parseBody()` rejects (a missing or bad multipart boundary).
 */
export const readBody = async (request: HonoRequest): Promise<unknown> =>
  isJsonMediaType(request.header("Content-Type")) ? readJsonBody(request) : readFormBody(request);

/**
 * The query string as the client's `buildUrl` sends it: a key once is a string, a repeated key an array. Converting
 * a value (`"2"` to `2`) is the schema's job (`z.coerce.number<number>()`). Hono's `queries()` drops a `__proto__` key.
 */
export const readQuery = (request: HonoRequest): Record<string, string | string[]> =>
  Object.fromEntries(Object.entries(request.queries()).map(([key, values]) => [key, values.length === 1 ? values[0]! : values]));

/** The fields of zod and valibot issues that hold submitted data. */
type LibraryIssue = StandardIssue & { readonly code?: unknown; readonly received?: unknown; readonly keys?: unknown };

/** An issue's message, and whether cutting the submitted data out of it shortened it. */
type IssueMessage = { readonly message: string; readonly cut: boolean };

const RECEIVED = "received ";

/** A message ending in a letter, digit or combining mark (whole code points): `received` after it is not a word. */
const ENDS_IN_WORD = /[\p{L}\p{N}\p{M}]$/u;

const SEPARATOR = /[\s,:]/;

/**
 * `text` without the separators left before a cut tail: `, `, `: `, ` but `, in any mix. A loop over the end of the
 * string, not a regex: the message holds submitted data, and a pattern with overlapping alternatives backtracks.
 */
const trimSeparators = (text: string): string => {
  let end = text.length;
  for (;;) {
    while (end > 0 && SEPARATOR.test(text[end - 1]!)) end--;
    if (end < 4 || !/\s/.test(text[end - 4]!) || text.slice(end - 3, end).toLowerCase() !== "but") return text.slice(0, end);
    end -= 3;
  }
};

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
 * `invalid_type` keeps its `received`, a type name. Any other message, the app's own included, is kept as it is.
 * `cut` tells whether a cut left nothing (`publicIssue` turns that into `Invalid value`), so a message the app wrote
 * empty is kept empty.
 */
const issueMessage = (issue: LibraryIssue): IssueMessage => {
  const { message, code, received, keys } = issue;
  if (Array.isArray(keys) && keys.length > 0) {
    const at = message.indexOf(": ");
    if (at !== -1 && keys.every((key) => message.slice(at).includes(String(key)))) return { message: message.slice(0, at), cut: true };
  }
  if (code === "invalid_type" || !["string", "number", "boolean", "bigint"].includes(typeof received)) return { message, cut: false };
  const at = receivedAt(message, String(received));
  return at === -1 ? { message, cut: false } : { message: trimSeparators(message.slice(0, at)), cut: true };
};

/** What a 422 may carry of an issue: `{ path, message }` only, never the library's `input`, `received` or `keys`. */
export const publicIssue = (issue: StandardIssue): { path: PropertyKey[]; message: string } => {
  const { message, cut } = issueMessage(issue);
  return {
    path: issuePath(issue),
    // A message a cut left with nothing (`Received "x"`, `: a`, `" : a"`) has only the data to show: a generic one. A
    // message the app wrote, empty or whitespace-only, is not cut, and is kept as it is
    message: cut && message.trim() === "" ? "Invalid value" : message,
  };
};

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

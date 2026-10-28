import { HTTPException } from "hono/http-exception";
import type { HonoRequest } from "hono/request";
import { parseBody } from "hono/utils/body";
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

/**
 * A body read a reader already started, or cached. A failure means the body is truncated, the connection went away, or
 * an adapter errored the stream: the client sent that body, so it is the malformed-body 400 whatever the request's
 * signal says (H43 #340: it aborted in `@hono/node-server`, but a truncated body can arrive without one). Hono's
 * `bodyLimit` error is the only one that is not that 400: it is rethrown for its handler.
 */
const orMalformed = async <T>(read: Promise<T> | T, message: string): Promise<T> => {
  try {
    return await read;
  } catch (error) {
    if (isBodyLimitError(error)) throw error;
    throw badRequest(message);
  }
};

/**
 * The body stream, read once. Hono's cache only serves a `text()`, `arrayBuffer()` or `formData()` it already holds: a
 * `c.req.parseBody()` on a JSON request caches its `{}` without reading the stream, so the bytes are still on
 * `c.req.raw`. They are read there and kept in the cache, so a later `c.req.arrayBuffer()` on the same request has them
 * too.
 */
const readRawBody = async (request: HonoRequest, message: string): Promise<ArrayBuffer> => {
  const bytes = await orMalformed(request.raw.arrayBuffer(), message);
  // Hono's types say the value, but its cache holds the promise each reader answers (4.9.6)
  (request.bodyCache as { arrayBuffer?: Promise<ArrayBuffer> }).arrayBuffer = Promise.resolve(bytes);
  return bytes;
};

/**
 * The body is gone when a reader took it off `c.req.raw` itself: Hono's cache holds nothing, and `raw.bodyUsed` says
 * so. That is a server bug, the generic 500 (docs/v1/validation.md › Pipeline validation and 422 › Diagnostics).
 */
const unreadableBodyError = (): TypeError =>
  new TypeError("the request body was already read, so the pipeline cannot parse it");

/** A multipart body as a middleware's `c.req.text()` left it: its bytes are gone, and only text survived. */
const textReadBodyError = (): TypeError =>
  new TypeError("a middleware read the multipart body with c.req.text(), so its file parts cannot be rebuilt");

/** Whether a FormData holds fields: a form body of none is no body, `{}` (a client may send its Content-Type alone). */
const hasFields = (formData: FormData): boolean => formData.entries().next().done !== true;

/**
 * The form fields, with this pipeline's options. Hono caches `parseBody()`'s result, and ignores the options of a later
 * call (4.9.6), so a flat `c.req.parseBody()` from a middleware would hide the dot keys of `parseBody({ dot: true })`
 * from a nested schema. Rebuild the fields from the FormData instead, with Hono's own conversion: a stand-in request
 * whose `formData()` answers it. Hono does not export that conversion (4.9.6), it exports `parseBody()`.
 */
const parseFormFields = (request: HonoRequest, formData: FormData): Promise<unknown> =>
  parseBody({ headers: request.raw.headers, formData: async () => formData } as unknown as HonoRequest, { dot: true });

/**
 * The form fields of the raw bytes: Hono rebuilds a cached body's FormData without the request's Content-Type, which a
 * multipart boundary needs, so the bytes are parsed with it. A rejection is the client's malformed body, the 400.
 */
const readFormFields = async (
  request: HonoRequest,
  bytes: ArrayBuffer,
  contentType: string,
  message: string,
): Promise<unknown> => {
  try {
    return parseFormFields(request, await new Response(bytes, { headers: { "Content-Type": contentType } }).formData());
  } catch (error) {
    if (isBodyLimitError(error)) throw error;
    throw error instanceof TypeError ? badRequest(message) : error;
  }
};

/**
 * The form body. A body an earlier middleware read is served from Hono's cache: `arrayBuffer()`'s bytes, or the
 * FormData `c.req.parseBody()` / `validator('form')` cached. Blank bytes are no body, `{}`, because `formData()`
 * rejects an empty `multipart/form-data` body, yet a client may send its form Content-Type on a GET or a DELETE with no
 * body. A body `formData()` rejects is the client's 400; so is a truncated one; Hono's `bodyLimit` error is rethrown
 * for its 413. A `formData` promise in the cache that rejected is that 400 too: an earlier middleware saw the
 * malformed body. The exception is a multipart body an earlier middleware read as text (`c.req.text()`): its bytes are
 * gone, and a UTF-8 round trip would hand the handler a damaged file part, so that is the 500, with a message that says
 * why. A urlencoded body is text by definition, so its text is its body.
 */
const readFormBody = async (request: HonoRequest): Promise<unknown> => {
  const contentType = request.header("Content-Type");
  if (contentType === undefined || !isFormMediaType(contentType)) return {};
  const message = MALFORMED_FORM;
  const cache = request.bodyCache;
  if (cache.text !== undefined) {
    // A text read keeps no bytes. A blank body loses nothing: it is no body, `{}`. So does a urlencoded body, which is
    // text; a multipart one may hold a file part's bytes, and those cannot be rebuilt from text
    const bytes = new TextEncoder().encode(await orMalformed(cache.text, message));
    if (isBlankBody(bytes)) return {};
    if (contentType.startsWith("multipart/form-data")) throw textReadBodyError();
    return readFormFields(request, bytes.buffer as ArrayBuffer, contentType, message);
  }
  // A FormData the cache holds is authoritative: it keeps a file part's bytes as they arrived
  if (cache.formData !== undefined) {
    const formData = await orMalformed(cache.formData, message);
    return hasFields(formData) ? parseFormFields(request, formData) : {};
  }
  // Bytes already (this pipeline's own read, `c.req.arrayBuffer()`, or a `c.req.blob()`), else the stream left on `raw`
  let bytes: ArrayBuffer;
  if (cache.arrayBuffer !== undefined) bytes = await orMalformed(cache.arrayBuffer, message);
  else if (cache.blob !== undefined) bytes = await orMalformed(request.arrayBuffer(), message);
  else if (request.raw.bodyUsed) throw unreadableBodyError();
  else bytes = await readRawBody(request, message);
  return isBlankBody(new Uint8Array(bytes)) ? {} : readFormFields(request, bytes, contentType, message);
};

/**
 * The JSON body. Hono's cache serves a body an earlier middleware read: `text()`, `arrayBuffer()`, `blob()` or
 * `json()`, and a form parse's FormData, which `text()` re-serialises. A `c.req.parseBody()` on a JSON request is the
 * exception: it caches `{}` without reading the stream, so `text()` fails on that plain object, and the raw body is
 * read instead. A stream a form parse consumed leaves nothing else to read: the JSON parse of the form's text is the
 * 400.
 */
const readJsonBody = async (request: HonoRequest): Promise<unknown> => {
  const message = MALFORMED_JSON;
  const cache = request.bodyCache;
  const keys = Object.keys(cache);
  let text: string;
  if (keys.length === 0 || (keys.length === 1 && keys[0] === "parsedBody")) {
    // Nothing a reader cached, or only the parse of a JSON media type, which never read the stream
    if (request.raw.bodyUsed) throw unreadableBodyError();
    text = new TextDecoder().decode(await readRawBody(request, message));
  } else {
    // A reader's cache: its text, bytes, blob or parsed JSON, or a form parse's FormData
    text = await orMalformed(request.text(), message);
  }
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest(message);
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

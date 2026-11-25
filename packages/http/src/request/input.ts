import { HTTPException } from "hono/http-exception";
import type { HonoRequest } from "hono/request";
import { bufferToFormData } from "hono/utils/buffer";
import { errors, issuePath, toErrorBag, validate } from "@laratype/contract";
import type { AnyEndpoint, StandardIssue, StandardSchemaV1 } from "@laratype/contract";
import { bodyCacheOf } from "./bodyCache";
import type { BodyCache } from "./bodyCache";
import { enforceBodyLimit, formMediaType, isJsonMediaType, isPayloadTooLarge } from "./bodyLimit";

/**
 * Parsing and validation of a request's input (docs/v1/validation.md › Pipeline validation and 422): the body by its
 * media type, the query, and the `query` and `body` schemas of a contract route.
 */

/** A bad request as Hono's `validator()` answers it, with a JSON body like the other error responses. */
const badRequest = (message: string) => new HTTPException(400, { res: Response.json({ message }, { status: 400 }) });

const MALFORMED_FORM = "Malformed form data in request body.";
const MALFORMED_JSON = "Malformed JSON in request body.";
const MULTIPLE_MEDIA_TYPES = "Invalid Content-Type header: more than one media type.";
const FORM_MEDIA_TYPE_OUTSIDE_LEADING = "Invalid Content-Type header: a form media type name outside the leading media type.";

/**
 * Whether the pipeline reads the request as a form body. The `hono` peer range (`^4.8.0`) has two `parseBody()`
 * classifiers: 4.8.0–4.12.27 matches the value `headers.get("Content-Type")` returns with a case-sensitive
 * `startsWith` (leading/trailing HTTP whitespace already stripped by `Headers`), while 4.12.28+ splits at `;`, trims,
 * lowercases and compares exactly. The `formMediaType` helper also keeps the 0.5 default cap's lowercased `startsWith`,
 * whose only extra reach is a suffixed spelling such as `Application/X-WWW-Form-Urlencodedx` the two exact rules miss.
 * The arms describe every spelling a peer or the old cap read as a form, but through `readBody` a suffixed or embedded
 * form name in the leading type is the form-name 400 before this helper or the cap runs, so the third arm decides
 * nothing in the pipeline; only a leading type that is exactly one of the two form names reaches it as a form.
 * `readBody` also refuses a Content-Type with more than one media type before either runs. The parser gets the media
 * type lowercased by `lowercaseMediaType`, with the parameters (a multipart boundary) as sent.
 */
const isFormMediaType = (contentType: string | undefined): boolean => formMediaType(contentType) !== undefined;

/**
 * Whether the Content-Type names more than one media type: Content-Type is a singleton field (RFC 9110 §8.3), so a
 * comma outside a quoted-string separates two values. A comma inside a quoted-string is one value (`boundary="a,b"`,
 * RFC 9110 §5.6.4), and a backslash escapes the next character there (`boundary="a\",b"`), so a quoted `\"` is not
 * the closing quote. An unterminated quoted-string quotes nothing (it is not a valid quoted-string), so a comma after
 * its opening quote is a separator too: fail closed, since a platform parser could take the last value.
 */
const hasMultipleMediaTypes = (contentType: string): boolean => {
  let quoted = false;
  let commaAfterOpen = false;
  for (let index = 0; index < contentType.length; index++) {
    const char = contentType[index];
    if (quoted && char === "\\") {
      // The escaped character is part of the quoted value, but for an unterminated quote a skipped comma still counts:
      // `x="\, ...` must fail closed like the unescaped comma (an unterminated quoted-string quotes nothing)
      if (contentType[index + 1] === ",") commaAfterOpen = true;
      index++;
    } else if (char === '"') {
      quoted = !quoted;
      commaAfterOpen = false;
    } else if (char === ",") {
      if (!quoted) return true;
      commaAfterOpen = true;
    }
  }
  return quoted && commaAfterOpen;
};

const MULTIPART_FORM_DATA = "multipart/form-data";
const URLENCODED_FORM_DATA = "application/x-www-form-urlencoded";

/** One of the two media types `parseBody()` reads as form fields, compared exactly (the leading type is lowercased). */
const isFormTypeName = (mediaType: string): boolean =>
  mediaType === MULTIPART_FORM_DATA || mediaType === URLENCODED_FORM_DATA;

/**
 * Whether either form media type name appears anywhere in the Content-Type other than as the leading media type: in a
 * parameter (quoted or not), inside another type (`x-multipart/form-data`), or as the second of two names. The leading
 * media type is the part before the first `;`, trimmed. Bun's `formData()` chooses its parser by a case-sensitive
 * substring search anywhere in the header (urlencoded first, then multipart when a boundary parameter exists), so a
 * header whose leading type is not the form type it embeds can make the platform parse a body the pipeline did not
 * classify or cap (B30 #410).
 */
const hasFormMediaTypeOutsideLeading = (contentType: string): boolean => {
  const semicolon = contentType.indexOf(";");
  const leading = (semicolon === -1 ? contentType : contentType.slice(0, semicolon)).trim().toLowerCase();
  let search = contentType;
  if (isFormTypeName(leading)) search = semicolon === -1 ? "" : contentType.slice(semicolon + 1);
  const lower = search.toLowerCase();
  return lower.includes(MULTIPART_FORM_DATA) || lower.includes(URLENCODED_FORM_DATA);
};

/**
 * The media type lowercased, its parameters untouched: RFC 9110 §8.3.1 makes the type and subtype case-insensitive,
 * while a multipart boundary (RFC 2046 §5.1.1) is case-sensitive. Hono 4.13.17's `bufferToFormData` lowercases the
 * media type itself; 4.9.6 passed the header as sent, so the pipeline lowercases it for every peer version.
 */
const lowercaseMediaType = (contentType: string): string =>
  contentType.replace(/^[^;]+/, (mediaType) => mediaType.toLowerCase());

/** A form body of whitespace only: the ASCII whitespace `String.prototype.trim()` strips. A body is bytes: no encoding
 * tells Unicode whitespace from data, so only these count. */
const isBlankBody = (bytes: Uint8Array): boolean => {
  for (const byte of bytes) {
    if (byte !== 0x20 && (byte < 0x09 || byte > 0x0d)) return false;
  }
  return true;
};

/**
 * Hono's `bodyLimit` on 4.9.6 errors the body stream with this error; its handler has to see it to answer the 413.
 * 4.13.17 buffers the body itself and answers its 413 before the pipeline runs, but a peer the `^4.8.0` range still
 * allows, or a middleware that errors the stream the same way, can leave the named error in Hono's cache, and the
 * default limit's own 413 is the same answer and is rethrown here too (H44 #341).
 */
const isBodyLimitError = (error: unknown): boolean =>
  (error instanceof Error && error.name === "BodyLimitError") || isPayloadTooLarge(error);

/**
 * The FormData this pipeline parsed, back in Hono's cache. A promise, even though the value is here: Hono chains every
 * other reader from the cache's first entry with `.then`, so a plain value alone there throws synchronously (4.9.6 and
 * 4.13.17 alike). The earlier `parseBody()`'s fields go: this pipeline's options are the ones the handler gets.
 */
const cacheFormData = (cache: BodyCache, formData: FormData): void => {
  cache.formData = Promise.resolve(formData);
  delete cache.parsedBody;
};

/**
 * A body read that fails: a rejected promise, or a reader that throws before it returns one (Hono's cache chains a
 * reader from its first entry, so a plain value there throws synchronously). A failure means the body is truncated, the
 * connection went away, or an adapter errored the stream: the client sent that body, so it is the malformed-body 400
 * whatever the request's signal says (H43 #340: it aborted in the Node adapter, but a truncated body can arrive
 * without one). Hono's `bodyLimit` error is the only one that is not that 400: it is rethrown for its handler.
 */
const orMalformed = async <T>(read: () => Promise<T> | T, message: string): Promise<T> => {
  try {
    return await read();
  } catch (error) {
    if (isBodyLimitError(error)) throw error;
    throw badRequest(message);
  }
};

/**
 * The body stream, read once. Hono's cache only serves a `text()`, `arrayBuffer()` or `formData()` it already holds. A
 * `c.req.parseBody()` on a JSON request leaves no cache entry on 4.13.17 (on 4.9.6 it cached its `{}` without reading
 * the stream), so the bytes are read on `c.req.raw`. They are kept in the cache, so a later `c.req.text()`/`json()` has
 * them too; a plain `parsedBody` a 4.9.6 middleware left is cleared, since Hono chains a later reader from the cache's
 * first entry and cannot chain from it.
 */
const readRawBody = async (request: HonoRequest, message: string): Promise<ArrayBuffer> => {
  const cache = bodyCacheOf(request);
  const bytes = await orMalformed(() => request.raw.arrayBuffer(), message);
  delete cache.parsedBody;
  cache.arrayBuffer = Promise.resolve(bytes);
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
 * Hono 4.13.17's guard in `handleParsingNestedValues` (`hono/utils/body.ts`): a `__proto__` segment at the start or
 * after a dot **and followed by another segment**. A trailing `x.__proto__` or a top-level `__proto__` names no nested
 * object, so each stays an own data key of its null-prototype object.
 */
const UNSAFE_DOT_KEY = /(?:^|\.)__proto__\./;

/**
 * Hono 4.13.17's nesting limits (`hono/utils/body.ts`): a dot key has at most 33 segments, and one conversion creates
 * at most 10,000 nested groups (`MAX_NESTED_OBJECTS = 1e4`). A field of many dots would otherwise build as many
 * objects as the body cap allows; the pipeline answers the malformed-form 400 for it.
 */
const MAX_DOT_SEGMENTS = 33;
const MAX_NESTED_OBJECTS = 10_000;

/** Hono's `throwNestingLimitExceeded` (`hono/utils/body.ts`), mapped to the malformed-form 400 by `formFields`. */
class FormNestingError extends Error {
  constructor() {
    super("Nesting limit exceeded");
  }
}

/**
 * The form fields as Hono 4.13.17's `parseBody({ dot: true })` builds them, from the FormData this pipeline already
 * holds. It mirrors its `convertFormDataToBodyData` with `{ all: false, dot: true }`: a key sent once is its value, a
 * repeated key the last value, a `[]` key an array, and a dotted key a nested object, replacing a non-object on the
 * way. Hono does not export that conversion, and `parseBody()` cannot read the request here on the whole peer range
 * (`^4.8.0`): on 4.12.28 it re-reads a cached FormData as bytes with a new multipart boundary, so they no longer
 * match the request's Content-Type (a `TypeError` on multipart, wrong fields on urlencoded); 4.13.17 converts the
 * cached FormData, but the pipeline keeps its own conversion so every peer version reads the same fields. Every object
 * is built with `Object.create(null)`, so a `constructor`, `prototype` or `__proto__` segment is an own key, never a
 * prototype one. 4.13.17 drops a key with a `__proto__` segment at the start or after a dot **and followed by another
 * segment** (`UNSAFE_DOT_KEY`: `__proto__.x`, `a.__proto__.x`); a trailing `x.__proto__` and a top-level `__proto__`
 * stay own data keys, and the pipeline mirrors that on every peer version.
 */
export const toDotFields = (formData: FormData): Record<string, unknown> => {
  const fields: Record<string, unknown> = Object.create(null);
  const nestingState = { count: 0 };
  formData.forEach((value, key) => {
    if (!key.endsWith("[]")) fields[key] = value;
    else appendArrayValue(fields, key, value);
  });
  for (const [key, value] of Object.entries(fields)) {
    if (!key.includes(".")) continue;
    if (!UNSAFE_DOT_KEY.test(key)) setNestedValue(fields, key, value, nestingState);
    delete fields[key];
  }
  return fields;
};

/** Hono's `handleParsingAllValues` for a `[]` key: its first value starts the array, the later ones are appended. */
const appendArrayValue = (fields: Record<string, unknown>, key: string, value: FormDataEntryValue): void => {
  const current = fields[key];
  if (current === undefined) fields[key] = [value];
  else if (Array.isArray(current)) current.push(value);
  else fields[key] = [current, value];
};

/**
 * Hono's `handleParsingNestedValues`: `a.b` walks `a` and sets `b`, replacing a non-object on the way, within the
 * 33-segment and 10,000-group limits (`handleParsingNestedValues` in `hono/utils/body.ts`: `key.split(".", 34)`, then
 * `state.count++ >= MAX_NESTED_OBJECTS`). The split is bounded, so a key of millions of dots never walks them all.
 */
const setNestedValue = (
  fields: Record<string, unknown>,
  key: string,
  value: unknown,
  state: { count: number },
): void => {
  let nested = fields;
  const parts = key.split(".", MAX_DOT_SEGMENTS + 1);
  if (parts.length > MAX_DOT_SEGMENTS) throw new FormNestingError();
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      nested[part] = value;
      return;
    }
    const current = nested[part];
    if (!current || typeof current !== "object" || Array.isArray(current) || current instanceof File) {
      if (state.count++ >= MAX_NESTED_OBJECTS) throw new FormNestingError();
      nested[part] = Object.create(null);
    }
    nested = nested[part] as Record<string, unknown>;
  });
};

/** `toDotFields` with the nesting limit (Hono 4.13.17) answered as the malformed-form 400, not a logged 500. */
const formFields = (formData: FormData): Record<string, unknown> => {
  try {
    return toDotFields(formData);
  } catch (error) {
    if (error instanceof FormNestingError) throw badRequest(MALFORMED_FORM);
    throw error;
  }
};

/**
 * Hono's own bytes-to-FormData parse (`bufferToFormData`). 4.13.17 lowercases the media type itself before building
 * the `Response`; 4.9.6 passes the header as it is, so the pipeline hands it a lowercased media type (its parameters,
 * the multipart boundary included, keep their case: `lowercaseMediaType`) for every peer version. A cached body Hono
 * rebuilds has no Content-Type, which a multipart boundary needs, so the bytes are parsed with the request's. Its type
 * asks for an `ArrayBuffer`, and the `Response` it builds takes the view as it is, so the bytes are handed over without
 * a copy. A malformed body is the platform's `TypeError` ("Failed to parse body as FormData."): the client's 400.
 * Everything else is a bug and goes on to the 500.
 */
const formDataFromBytes = async (bytes: Uint8Array, contentType: string): Promise<FormData> => {
  try {
    return await bufferToFormData(bytes as unknown as ArrayBuffer, contentType);
  } catch (error) {
    throw error instanceof TypeError ? badRequest(MALFORMED_FORM) : error;
  }
};

/**
 * The form fields of the raw bytes. The FormData goes back into Hono's cache before the conversion, so a later
 * `c.req.formData()`/`parseBody()` has one Hono can serve and this pipeline reads the same one. `contentType` has its
 * media type lowercased already (`readFormBody`); the boundary keeps its case.
 */
const readFormFields = async (request: HonoRequest, bytes: Uint8Array, contentType: string): Promise<unknown> => {
  const formData = await formDataFromBytes(bytes, contentType);
  cacheFormData(bodyCacheOf(request), formData);
  return formFields(formData);
};

/** The bytes a byte reader left in Hono's cache, or the unread ones on `raw`; `undefined` is a blank body, no body. */
const readFormBytes = async (request: HonoRequest): Promise<Uint8Array | undefined> => {
  const cache = bodyCacheOf(request);
  let bytes: ArrayBuffer;
  if (cache.arrayBuffer !== undefined || cache.blob !== undefined) {
    // Hono's reader serves the cached bytes, or rebuilds them from the cached blob
    bytes = await orMalformed(() => request.arrayBuffer(), MALFORMED_FORM);
  } else if (request.raw.bodyUsed) {
    throw unreadableBodyError();
  } else {
    bytes = await readRawBody(request, MALFORMED_FORM);
  }
  const formBytes = new Uint8Array(bytes);
  return isBlankBody(formBytes) ? undefined : formBytes;
};

/**
 * The bytes still readable after a form parse failed: the byte reader the cache kept, or `raw` when nothing consumed
 * it. `undefined` when the body is gone: its reader failed for good, and the 400 below says so.
 */
const remainingBytes = async (request: HonoRequest): Promise<Uint8Array | undefined> => {
  const cache = bodyCacheOf(request);
  try {
    if (cache.arrayBuffer !== undefined || cache.blob !== undefined) return new Uint8Array(await request.arrayBuffer());
    if (!request.raw.bodyUsed) return new Uint8Array(await request.raw.arrayBuffer());
  } catch (error) {
    // A byte reader that fails too leaves nothing to tell a blank body from a malformed one, but a bodyLimit's 413 is
    // not that question: it reaches its handler like every other read
    if (isBodyLimitError(error)) throw error;
  }
  return undefined;
};

/** A request that declared a body of no bytes: `Content-Length: 0`, a header Hono's parse cannot consume (it reads the
 * stream, and a body stream already read is spent). */
const hasNoBodyBytes = (request: HonoRequest): boolean => request.header("Content-Length") === "0";

/**
 * The FormData Hono's cache holds: `c.req.parseBody()` or `validator('form')` put it there. A rejection is the client's
 * malformed body, the 400 — unless the body is blank: `formData()` rejects an empty multipart body, and a client may
 * send its form Content-Type with no body, which is no body, `{}`. The bytes still in the cache say so; a spent stream
 * leaves none, and there a `Content-Length: 0` is the same blank body (the Node adapter sends it). Hono's
 * `bodyLimit` error is rethrown for its 413.
 */
const readCachedFormData = async (
  request: HonoRequest,
  cached: Promise<FormData> | FormData,
): Promise<FormData | undefined> => {
  try {
    return await cached;
  } catch (error) {
    if (isBodyLimitError(error)) throw error;
    const bytes = await remainingBytes(request);
    if (bytes === undefined ? hasNoBodyBytes(request) : isBlankBody(bytes)) return undefined;
    throw badRequest(MALFORMED_FORM);
  }
};

/**
 * The form body. A body an earlier middleware read is served from Hono's cache: `arrayBuffer()`'s bytes, or the
 * FormData `c.req.parseBody()` / `validator('form')` cached. Blank bytes are no body, `{}`, because `formData()`
 * rejects an empty `multipart/form-data` body, yet a client may send its form Content-Type on a GET or a DELETE with no
 * body. A body `formData()` rejects is the client's 400, unless it is blank the same way; so is a truncated one; Hono's
 * `bodyLimit` error is rethrown for its 413. A `formData` promise in the cache that rejected is that 400 too: an
 * earlier middleware saw the malformed body. Two are not that 400: a request that declared no body bytes
 * (`Content-Length: 0`) is `{}`, and a multipart body an earlier middleware read as text (`c.req.text()`) is the 500,
 * since its bytes are gone and a UTF-8 round trip would hand the handler a damaged file part; its message says why. A
 * urlencoded body is text by definition, so its text is its body.
 */
const readFormBody = async (request: HonoRequest): Promise<unknown> => {
  const contentType = request.header("Content-Type");
  if (contentType === undefined || !isFormMediaType(contentType)) return {};
  // The parser gets the media type lowercased; the parameters (a multipart boundary) keep their case
  const formContentType = lowercaseMediaType(contentType);
  const cache = bodyCacheOf(request);
  if (cache.text !== undefined) {
    // A text read keeps no bytes. A blank body loses nothing: it is no body, `{}`. So does a urlencoded body, which is
    // text; a multipart one may hold a file part's bytes, and those cannot be rebuilt from text
    const bytes = new TextEncoder().encode(await orMalformed(() => request.text(), MALFORMED_FORM));
    if (isBlankBody(bytes)) {
      cacheFormData(cache, new FormData());
      return {};
    }
    if (formMediaType(contentType) === "multipart/form-data") throw textReadBodyError();
    return readFormFields(request, bytes, formContentType);
  }
  // A FormData the cache holds is authoritative: it keeps a file part's bytes as they arrived
  if (cache.formData !== undefined) {
    const formData = await readCachedFormData(request, cache.formData);
    if (formData === undefined) {
      // A blank body has no fields, so Hono's rejected parse leaves an empty FormData a later reader can serve
      cacheFormData(cache, new FormData());
      return {};
    }
    cacheFormData(cache, formData);
    return hasFields(formData) ? formFields(formData) : {};
  }
  // Bytes already (this pipeline's own read, `c.req.arrayBuffer()`, or a `c.req.blob()`), else the stream left on `raw`
  const bytes = await readFormBytes(request);
  if (bytes === undefined) {
    cacheFormData(cache, new FormData());
    return {};
  }
  return readFormFields(request, bytes, formContentType);
};

/**
 * The JSON body. Hono's cache serves a body an earlier middleware read: `text()`, `arrayBuffer()`, `blob()` or
 * `json()`, and a form parse's FormData, which `text()` re-serialises. A `c.req.parseBody()` on a JSON request leaves
 * no cache entry on 4.13.17, and on 4.9.6 it cached its `{}` without reading the stream: either way the raw body is
 * still unread, and `text()` on that plain 4.9.6 value would throw. A stream a form parse consumed leaves nothing else
 * to read: the JSON parse of the form's text is the 400.
 */
const readJsonBody = async (request: HonoRequest): Promise<unknown> => {
  const cache = bodyCacheOf(request);
  const keys = Object.keys(cache);
  let text: string;
  if (keys.length === 0 || (keys.length === 1 && keys[0] === "parsedBody")) {
    // Nothing a reader cached, or only the 4.9.6 parse of a JSON media type, which never read the stream
    if (request.raw.bodyUsed) throw unreadableBodyError();
    text = new TextDecoder().decode(await readRawBody(request, MALFORMED_JSON));
  } else {
    // A reader's cache: its text, bytes, blob or parsed JSON, or a form parse's FormData
    text = await orMalformed(() => request.text(), MALFORMED_JSON);
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
 * body `parseBody()` rejects (a missing or bad multipart boundary). A Content-Type that names more than one media type
 * is the 400 first: the field is a singleton (RFC 9110 §8.3), and the platform's MIME extraction takes the last value,
 * so a comma-joined value could otherwise be parsed as one media type while the platform reads another. So is a
 * Content-Type holding a form media type name anywhere outside its leading media type: Bun's form parser picks the type
 * by a case-sensitive substring search anywhere in the header, while this pipeline classifies and caps the leading type
 * only. The default body limit runs after those checks (H44 #341), so a body over its cap is the 413 before anything
 * reads the stream.
 */
export const readBody = async (request: HonoRequest): Promise<unknown> => {
  const contentType = request.header("Content-Type");
  if (contentType !== undefined) {
    if (hasMultipleMediaTypes(contentType)) throw badRequest(MULTIPLE_MEDIA_TYPES);
    if (hasFormMediaTypeOutsideLeading(contentType)) throw badRequest(FORM_MEDIA_TYPE_OUTSIDE_LEADING);
  }
  await enforceBodyLimit(request);
  return isJsonMediaType(contentType) ? readJsonBody(request) : readFormBody(request);
};

/**
 * The query string as the client's `buildUrl` sends it: a key once is a string, a repeated key an array. Converting
 * a value (`"2"` to `2`) is the schema's job (`z.coerce.number<number>()`). Hono 4.13.17 keeps a `__proto__` key as an
 * own key of a null-prototype object (4.9.6 dropped it); `Object.fromEntries` copies it as an own data key of a plain
 * object, so it stays data and never swaps a prototype. A contract's query schema drops it like any key it does not
 * declare.
 */
export const readQuery = (request: HonoRequest): Record<string, string | string[]> =>
  Object.fromEntries(Object.entries(request.queries()).map(([key, values]) => [key, values.length === 1 ? values[0]! : values]));

/** The fields of zod and valibot issues that hold submitted data. */
type LibraryIssue = StandardIssue & { readonly code?: unknown; readonly received?: unknown; readonly keys?: unknown };

/** An issue's message, and whether cutting the submitted data out of it shortened it. */
type IssueMessage = { readonly message: string; readonly cut: boolean };

const RECEIVED = "received ";

/** The message of an issue whose own message would still carry the submitted data (H31 #308). */
const INVALID_VALUE = "Invalid value";

/** A message ending in a letter, digit or combining mark (whole code points): `received` after it is not a word. */
const ENDS_IN_WORD = /[\p{L}\p{N}\p{M}]$/u;

const SEPARATOR = /[\s,:]/;

/**
 * The submitted data of an issue, when it is a printable primitive. A zod `invalid_type` carries a type name
 * (`received: "string"`), not the data, so it is never scrubbed.
 */
const printableReceived = (issue: LibraryIssue): string | undefined => {
  if (issue.code === "invalid_type") return undefined;
  const { received } = issue;
  return ["string", "number", "boolean", "bigint"].includes(typeof received) ? String(received) : undefined;
};

/**
 * `text` without the separators left before a cut tail: `, `, `: `, ` but `, in any mix. `but` is a word at the start of
 * the text or after one of those separators (`Expected x,but` too), never inside one (`abut`). A loop over the end of
 * the string, not a regex: the message holds submitted data, and a pattern with overlapping alternatives backtracks.
 */
const trimSeparators = (text: string): string => {
  let end = text.length;
  for (;;) {
    while (end > 0 && SEPARATOR.test(text[end - 1]!)) end--;
    const but = end >= 3 && text.slice(end - 3, end).toLowerCase() === "but" && (end === 3 || SEPARATOR.test(text[end - 4]!));
    if (!but) return text.slice(0, end);
    end -= 3;
  }
};

/** Whether `message` ends in a word character at `end`: the code point before it, a surrogate pair read whole. */
const endsInWord = (message: string, end: number): boolean => {
  if (end < 1) return false;
  const low = message.charCodeAt(end - 1);
  const start = low >= 0xdc00 && low <= 0xdfff && end > 1 ? end - 2 : end - 1;
  return ENDS_IN_WORD.test(message.slice(start, end));
};

/** A spelling of the submitted value in a default message, with its whole `received <value>` tail folded once. */
type ReceivedTail = { readonly value: string; readonly folded: string };

/** The three spellings a default message gives the value, bare or quoted, each folded once per issue. */
const receivedTails = (received: string): readonly ReceivedTail[] =>
  [received, `'${received}'`, `"${received}"`].map((value) => ({ value, folded: `${RECEIVED}${value}`.toLowerCase() }));

/**
 * The index of `received <value>` at the end of a message, as a word, the value bare or quoted, in any case. The message
 * is folded once (`folded`) and compared by index, so no step copies it; `İ` folds to two code units, so a fold that
 * changed the length falls back to folding the tail alone (H31 #308). `endsInWord` reads the code point before the
 * candidate whole, so `𝐱received` stays one word.
 */
const receivedAt = (message: string, folded: string, tails: readonly ReceivedTail[]): number => {
  const sameLength = folded.length === message.length;
  for (const { value, folded: tail } of tails) {
    const at = message.length - value.length - RECEIVED.length;
    if (at < 0 || endsInWord(message, at)) continue;
    if (sameLength ? folded.startsWith(tail, at) : message.slice(at).toLowerCase() === tail) return at;
  }
  return -1;
};

/**
 * An issue's message without the submitted data, which would reach proxy and client logs. Default messages put it
 * last: zod 3 and valibot end with the word `received` and the issue's `received`, in any case (`Invalid enum
 * value. Expected 'a' | 'b', received 'c'`, `Invalid type: Expected string but received 5`, `Invalid email:
 * Received "a@b"`), cut with the separators before it; zod's unrecognized keys follow the first `": "`. A zod
 * `invalid_type` keeps its `received`, a type name. A translated or custom message can put the value anywhere
 * (`Ungültiger Enum-Wert. Erwartet 'a' | 'b', erhalten 'secret'`): the pipeline cannot locate it, so an issue that
 * still repeats it answers the generic `Invalid value` rather than the value (H31 #308). Any other message, the app's
 * own included, is kept as it is. `cut` tells whether the message was not kept whole (`publicIssue` turns an empty
 * cut into `Invalid value`), so a message the app wrote empty is kept empty.
 */
const issueMessage = (issue: LibraryIssue): IssueMessage => {
  const { message, keys } = issue;
  if (Array.isArray(keys) && keys.length > 0) {
    const at = message.indexOf(": ");
    if (at !== -1 && keys.every((key) => message.slice(at).includes(String(key)))) return { message: message.slice(0, at), cut: true };
  }
  const received = printableReceived(issue);
  if (received === undefined) return { message, cut: false };
  const folded = message.toLowerCase();
  const at = receivedAt(message, folded, receivedTails(received));
  if (at !== -1) return { message: trimSeparators(message.slice(0, at)), cut: true };
  // The value in another position: fail closed. A value the message does not carry (an app's own message, a translated
  // one that dropped it) leaves the message as written. An empty value matches every message, so it is not searched.
  return received !== "" && folded.includes(received.toLowerCase()) ? { message: INVALID_VALUE, cut: true } : { message, cut: false };
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
 * Hono `HTTPException` that `Response.resolveException` sends as it is. Its body is built through the catalog's
 * `errors.validation`, so the wire shape stays the catalog's (H5 #108 mapped thrown `ContractError`s; this path keeps
 * the plain HTTP error answer).
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

import { HTTPException } from "hono/http-exception";
import type { HonoRequest } from "hono/request";
import { config } from "@laratype/core";
import { bodyCacheOf } from "./bodyCache";
import type { BodyCache } from "./bodyCache";

/**
 * The default request body limit (docs/v1/http.md › Default body limit): JSON, urlencoded and multipart bodies are
 * capped even when the app mounts no `bodyLimit`, so one large request cannot use as much memory as it likes.
 *
 * Enforced at the start of `readBody`, before any reader touches the stream. Not with a second Hono `bodyLimit`
 * mounted by the kernel: on Hono 4.9.6 two stacked `bodyLimit`s lose bytes of a multi-chunk body, and the outer one
 * answers its own 413 over the inner one's (H44 #341); 4.13.17 buffers the body itself and no longer loses the bytes,
 * but a second limiter would still read and buffer the whole body twice. An app's own `bodyLimit` stays the one limiter
 * in front of the pipeline, and the caps here can only tighten it: an app that needs a larger body raises
 * `http.bodyLimit`.
 */

/** The built-in caps in bytes: Fastify's JSON default, and a higher multipart cap for uploads. */
export const BODY_LIMIT_DEFAULTS = {
  json: 1_048_576,
  form: 1_048_576,
  multipart: 10_485_760,
} as const;

type MediaType = keyof typeof BODY_LIMIT_DEFAULTS;

/** The media types Hono's `validator('json')` reads as JSON, with any parameters, the OWS RFC 9110 §8.3.1 allows
 * before the `;` included, and in any case: media types are case-insensitive (RFC 9110 §8.3.1). Hono's regex, which it
 * does not export, with digits and `_` in the vendor subtype too (`application/vnd.github.v3+json`, H26 #287;
 * `application/vnd.my_app+json`, RFC 6838). */
const JSON_MEDIA_TYPE = /^application\/([a-z0-9._-]+\+)?json\s*(;\s*[a-zA-Z0-9\-]+\=([^;]+))*$/i;

export const isJsonMediaType = (contentType: string | undefined): boolean =>
  contentType !== undefined && JSON_MEDIA_TYPE.test(contentType);

/** The two media types Hono's `parseBody()` reads as form fields. */
export type FormMediaType = "multipart/form-data" | "application/x-www-form-urlencoded";

/**
 * The form media type the pipeline reads, or `undefined`, when ANY of the three rules the `^4.8.0` peer range and the
 * 0.5 cap used reads the request as a form body:
 * - 4.8.0–4.12.27 (`parseBody` in `hono/utils/body.ts`): `contentType?.startsWith("multipart/form-data") || ...` on
 *   the value `headers.get("Content-Type")` returns (leading/trailing HTTP whitespace stripped by `Headers`; case and
 *   parameters as sent);
 * - 4.12.28+ (4.12.28 is the first release; `dist/utils/body.js:7`): `contentType?.split(";")[0].trim().toLowerCase()`
 *   compared exactly to the two types;
 * - the 0.5 default cap's own rule (`mediaTypeOf` before B30): `contentType.toLowerCase().startsWith(...)`, which also
 *   covers a suffixed spelling (`Application/X-WWW-Form-Urlencodedx`) the two exact rules miss. Keeping it fail-closed
 *   restores the cap such a request had before this PR.
 * Accepting a spelling any rule reads as a form is fail-closed: the pipeline parses, validates and caps it, so a peer
 * that reads it can never hand a handler fields validation did not see, and no request loses the cap it had. A spelling
 * no rule accepts is `{}` to the pipeline, as it is to `parseBody()` on every peer. `readBody` refuses a Content-Type
 * holding more than one media type (a comma outside a quoted-string) before this helper or the cap runs, so the arms
 * only see a singleton field; for one value, the classifier and the default cap both use this helper (`mediaTypeOf`), so
 * the parse and the cap read the spelling alike.
 */
export const formMediaType = (contentType: string | undefined): FormMediaType | undefined => {
  if (contentType === undefined) return undefined;
  const exact = contentType.split(";")[0]!.trim().toLowerCase();
  if (exact === "multipart/form-data" || exact === "application/x-www-form-urlencoded") return exact;
  if (contentType.startsWith("multipart/form-data")) return "multipart/form-data";
  if (contentType.startsWith("application/x-www-form-urlencoded")) return "application/x-www-form-urlencoded";
  const lower = contentType.toLowerCase();
  if (lower.startsWith("multipart/form-data")) return "multipart/form-data";
  if (lower.startsWith("application/x-www-form-urlencoded")) return "application/x-www-form-urlencoded";
  return undefined;
};

/**
 * The media type whose cap applies to a request, or `undefined` when no default cap applies (a media type the pipeline
 * does not parse). The form types come from `formMediaType`, the same union of the peer range's classifiers the parse
 * uses. `readBody` has already refused a Content-Type holding more than one media type, so the cap and the parse see the
 * same single value. JSON uses `isJsonMediaType` (Hono's `validator('json')` shape, see the regex above).
 */
const mediaTypeOf = (contentType: string | undefined): MediaType | undefined => {
  if (isJsonMediaType(contentType)) return "json";
  const form = formMediaType(contentType);
  if (form === "multipart/form-data") return "multipart";
  if (form === "application/x-www-form-urlencoded") return "form";
  return undefined;
};

/** The caps in force: the configured value, else the built-in default, per media type; `undefined` is no cap. */
type Limits = Partial<Record<MediaType, number>>;

/**
 * A configured cap: a finite byte count of 0 or more, `false` for no cap. Any other value (a string, a negative
 * number, `NaN`) is ignored and the built-in default stays, so a typo never removes the cap.
 */
const capOf = (value: unknown, fallback: number): number | undefined =>
  value === false ? undefined : (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback);

/**
 * `config()` types its path against the app's `Register` config interface. The framework reads an optional key no app
 * has to register, so the string overload is reached through this cast.
 */
const readConfig = config as unknown as (path: string) => unknown;

/**
 * Reads `http.bodyLimit` at the start of each body read. `ConfigLoadServiceProvider` runs before the kernel in an app;
 * a bare kernel (a test, a kernel booted without the config providers) has no config store yet, and the defaults apply.
 */
const configuredLimits = (): unknown => {
  try {
    return readConfig("http.bodyLimit");
  } catch {
    return undefined;
  }
};

/** The caps in force: the configured value, else the built-in default, per media type. */
const resolveLimits = (): Limits => {
  const configured = configuredLimits();
  // `bodyLimit: false` disables all three caps; a value that is not an object leaves every default in place
  if (configured === false) return {};
  const values = configured !== null && typeof configured === "object" ? (configured as Record<string, unknown>) : {};
  return {
    json: capOf(values.json, BODY_LIMIT_DEFAULTS.json),
    form: capOf(values.form, BODY_LIMIT_DEFAULTS.form),
    multipart: capOf(values.multipart, BODY_LIMIT_DEFAULTS.multipart),
  };
};

const PAYLOAD_TOO_LARGE = Symbol.for("laratype.http.payloadTooLarge");

/**
 * The 413, byte for byte Hono `bodyLimit`'s default answer: `Payload Too Large` as `text/plain`, which the exception
 * filter sends as it is. Branded, so a read turns it into this 413 and never the malformed-body 400, and another copy
 * of this module still recognizes it.
 */
const payloadTooLarge = (): HTTPException => {
  const error = new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });
  return Object.assign(error, { [PAYLOAD_TOO_LARGE]: true });
};

export const isPayloadTooLarge = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[PAYLOAD_TOO_LARGE] === true;

/**
 * The size of a body an earlier middleware already read through Hono's cache. A rejection is left to the read itself:
 * a `BodyLimitError` must reach `bodyLimit`'s handler, and a malformed body its 400. A cached `FormData` or parsed
 * fields are not measured: their bytes are already gone and spent. `undefined` when the cache holds no bytes.
 */
const cachedBytes = async (cache: BodyCache): Promise<number | undefined> => {
  const settle = async <T>(value: Promise<T>): Promise<T | undefined> => {
    try {
      return await value;
    } catch {
      return undefined;
    }
  };
  if (cache.arrayBuffer !== undefined) return (await settle(cache.arrayBuffer))?.byteLength;
  if (cache.blob !== undefined) return (await settle(cache.blob))?.size;
  if (cache.text !== undefined) {
    const text = await settle(cache.text);
    return text === undefined ? undefined : new TextEncoder().encode(text).byteLength;
  }
  return undefined;
};

/**
 * Caps the body before the pipeline reads it. A declared Content-Length over the cap is refused without reading the
 * stream. Otherwise the stream is counted: a missing or smaller Content-Length is not trusted, and the read errors on
 * the chunk that crosses the cap, so the source is not pulled further (the streams' own read-ahead aside).
 */
export const enforceBodyLimit = async (request: HonoRequest): Promise<void> => {
  const type = mediaTypeOf(request.header("Content-Type"));
  const cap = type === undefined ? undefined : resolveLimits()[type];
  if (cap === undefined) return;
  const cache = bodyCacheOf(request);
  if (cache.arrayBuffer !== undefined || cache.blob !== undefined || cache.text !== undefined) {
    const bytes = await cachedBytes(cache);
    if (bytes !== undefined && bytes > cap) throw payloadTooLarge();
    // The cache serves the read; there is no stream left to wrap
    if (bytes !== undefined) return;
  }
  const raw = request.raw;
  if (raw.body === null || raw.bodyUsed) return;
  const contentLength = raw.headers.get("Content-Length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isInteger(declared) && declared > cap) throw payloadTooLarge();
  }
  let size = 0;
  const limited = raw.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > cap) controller.error(payloadTooLarge());
        else controller.enqueue(chunk);
      },
    }),
  );
  // Hono's own bodyLimit replaces `raw` the same way; Node's fetch needs `duplex` for a streamed request body
  const init: RequestInit & { duplex: "half" } = { body: limited, duplex: "half" };
  request.raw = new Request(raw, init);
};

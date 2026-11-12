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
 * answers its own 413 over the inner one's (H44 #341). An app's own `bodyLimit` stays the one limiter in front of the
 * pipeline, and the caps here can only tighten it: an app that needs a larger body raises `http.bodyLimit`.
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

/** The media type whose cap applies to a request, or `undefined` when the pipeline never reads its body. */
const mediaTypeOf = (contentType: string | undefined): MediaType | undefined => {
  if (isJsonMediaType(contentType)) return "json";
  if (contentType?.startsWith("multipart/form-data")) return "multipart";
  if (contentType?.startsWith("application/x-www-form-urlencoded")) return "form";
  return undefined;
};

/** The media types Hono's `parseBody()` reads as form fields; a request of any other type has no body, `{}`. */
export const isFormMediaType = (contentType: string | undefined): boolean => {
  const type = mediaTypeOf(contentType);
  return type === "form" || type === "multipart";
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

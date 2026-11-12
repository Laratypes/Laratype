import { HTTPException } from "hono/http-exception";
import type { HonoRequest } from "hono/request";
import { config } from "@laratype/core";

/**
 * The default request body limit (docs/v1/http.md › Default body limit): JSON, urlencoded and multipart bodies are
 * capped even when the app mounts no `bodyLimit`, so one large request cannot use as much memory as it likes.
 *
 * Enforced at the start of `readBody`, before any reader touches the stream. Not with a second Hono `bodyLimit`
 * mounted by the kernel: on Hono 4.9.6 two stacked `bodyLimit`s lose bytes of a multi-chunk body, and the outer one
 * answers its own 413 over the inner one's (H44 #341, #369). An app's own `bodyLimit` stays the one limiter in front
 * of the pipeline, and the caps here can only tighten it: an app that needs a larger body raises `http.bodyLimit`.
 */

/** The built-in caps in bytes: Fastify's JSON default, and a higher multipart cap for uploads. */
export const BODY_LIMIT_DEFAULTS = {
  json: 1_048_576,
  form: 1_048_576,
  multipart: 10_485_760,
} as const;

/** One cap: a byte count, or `false` to read that media type unbounded. */
export type BodyLimit = number | false;

/** `app/config/http.ts`'s `bodyLimit`: a cap per media type the pipeline reads (`false` disables one). */
export interface BodyLimitConfig {
  readonly json?: BodyLimit;
  readonly form?: BodyLimit;
  readonly multipart?: BodyLimit;
}

/** The media types Hono's `validator('json')` reads as JSON, with any parameters, the OWS RFC 9110 §8.3.1 allows
 * before the `;` included, and in any case: media types are case-insensitive (RFC 9110 §8.3.1). Hono's regex, which it
 * does not export, with digits and `_` in the vendor subtype too (`application/vnd.github.v3+json`, H26 #287;
 * `application/vnd.my_app+json`, RFC 6838). */
const JSON_MEDIA_TYPE = /^application\/([a-z0-9._-]+\+)?json\s*(;\s*[a-zA-Z0-9\-]+\=([^;]+))*$/i;

export const isJsonMediaType = (contentType: string | undefined): boolean =>
  contentType !== undefined && JSON_MEDIA_TYPE.test(contentType);

/** A multipart form body, the type Hono's `parseBody()` reads as fields and `File`s. */
export const isMultipartMediaType = (contentType: string | undefined): boolean =>
  contentType !== undefined && contentType.startsWith("multipart/form-data");

/** A urlencoded form body, text by definition: Hono's `parseBody()` reads its fields. */
export const isUrlencodedMediaType = (contentType: string | undefined): boolean =>
  contentType !== undefined && contentType.startsWith("application/x-www-form-urlencoded");

/** The media types Hono's `parseBody()` reads as form fields; a request of any other type has no body, `{}`. */
export const isFormMediaType = (contentType: string | undefined): boolean =>
  isMultipartMediaType(contentType) || isUrlencodedMediaType(contentType);

type Limits = { json?: number; form?: number; multipart?: number };

/**
 * A configured cap: a finite byte count of 0 or more. Any other value (a string, a negative number, `NaN`) is ignored
 * and the built-in default stays, so a typo never removes the cap.
 */
const capOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

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
  // `bodyLimit: false` disables all three caps; a malformed value leaves every default in place
  if (configured === false) return {};
  const values = configured !== null && typeof configured === "object" ? (configured as Record<string, unknown>) : {};
  return {
    json: values.json === false ? undefined : (capOf(values.json) ?? BODY_LIMIT_DEFAULTS.json),
    form: values.form === false ? undefined : (capOf(values.form) ?? BODY_LIMIT_DEFAULTS.form),
    multipart: values.multipart === false ? undefined : (capOf(values.multipart) ?? BODY_LIMIT_DEFAULTS.multipart),
  };
};

/** The cap in force for a request, or `undefined` when its media type is not read by the pipeline or its cap is off. */
const capFor = (request: HonoRequest): number | undefined => {
  const contentType = request.header("Content-Type");
  const type = isJsonMediaType(contentType)
    ? "json"
    : isMultipartMediaType(contentType)
      ? "multipart"
      : isUrlencodedMediaType(contentType)
        ? "form"
        : undefined;
  return type === undefined ? undefined : resolveLimits()[type];
};

/**
 * The 413, byte for byte Hono `bodyLimit`'s default answer: `Payload Too Large` as `text/plain`, which the exception
 * filter sends as it is. A subclass, so a read turns it into this 413 and never the malformed-body 400.
 */
class PayloadTooLarge extends HTTPException {
  constructor() {
    super(413, { res: new Response("Payload Too Large", { status: 413 }) });
  }
}

export const isPayloadTooLarge = (error: unknown): boolean => error instanceof PayloadTooLarge;

const payloadTooLarge = (): PayloadTooLarge => new PayloadTooLarge();

/** Hono's request body cache at runtime (Hono 4.9.6); see `input.ts` for the full shape. */
interface BodyCache {
  text?: Promise<string>;
  arrayBuffer?: Promise<ArrayBuffer>;
  blob?: Promise<Blob>;
  formData?: Promise<FormData> | FormData;
  parsedBody?: unknown;
}

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
 * the chunk that crosses the cap, so at most one chunk past it is pulled and nothing else is buffered.
 */
export const enforceBodyLimit = async (request: HonoRequest): Promise<void> => {
  const cap = capFor(request);
  if (cap === undefined) return;
  const cache = request.bodyCache as unknown as BodyCache;
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

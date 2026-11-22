import type { HonoRequest } from "hono/request";

/**
 * Hono's request body cache at runtime: its types say the plain value, but `text()`, `arrayBuffer()` and `blob()`
 * cache the promise the raw request answered. 4.9.6's `parseBody()` cached its parsed fields as a plain `parsedBody`
 * and left a `formData` a `formData()` read; 4.13.17 caches its FormData as a `formData` promise and no `parsedBody`.
 * The pipeline and the default body limit read those internals only through this module, and handle both shapes across
 * the `^4.8.0` peer range.
 */
export interface BodyCache {
  text?: Promise<string>;
  arrayBuffer?: Promise<ArrayBuffer>;
  blob?: Promise<Blob>;
  formData?: Promise<FormData> | FormData;
  parsedBody?: unknown;
}

export const bodyCacheOf = (request: HonoRequest): BodyCache => request.bodyCache as unknown as BodyCache;

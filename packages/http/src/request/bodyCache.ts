import type { HonoRequest } from "hono/request";

/**
 * Hono's request body cache at runtime (Hono 4.9.6): its types say the plain value, but `text()`, `arrayBuffer()` and
 * `blob()` cache the promise the raw request answered, while `parseBody()` and `validator('form')` cache plain values.
 * The pipeline and the default body limit read those internals only through this module.
 */
export interface BodyCache {
  text?: Promise<string>;
  arrayBuffer?: Promise<ArrayBuffer>;
  blob?: Promise<Blob>;
  formData?: Promise<FormData> | FormData;
  parsedBody?: unknown;
}

export const bodyCacheOf = (request: HonoRequest): BodyCache => request.bodyCache as unknown as BodyCache;

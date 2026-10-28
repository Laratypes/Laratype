// H43 #345: the pipeline reads a request body through Hono's body cache, so these pin the Hono behaviour it relies on.
// A bump that changes it fails here, instead of silently breaking a later c.req.parseBody(), json() or formData().
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { HonoRequest } from "hono/request";
import { bufferToFormData } from "hono/utils/buffer";

const require = createRequire(import.meta.url);

/** The installed Hono's package.json: `require.resolve` lands in `dist`, whose own package.json has no name. */
const honoPackageJsonPath = (): string => {
  let dir = dirname(require.resolve("hono"));
  for (;;) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate) && (JSON.parse(readFileSync(candidate, "utf8")) as { name?: string }).name === "hono") {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("hono package.json not found");
    dir = parent;
  }
};

const { version } = JSON.parse(readFileSync(honoPackageJsonPath(), "utf8")) as { version: string };

const asJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const multipart: RequestInit = {
  method: "POST",
  headers: { "Content-Type": "multipart/form-data; boundary=x" },
  body: "--x\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\nada\r\n--x--\r\n",
};

/** A request as a handler gets it: a HonoRequest with an empty `bodyCache`. */
const requestOf = (init: RequestInit): HonoRequest => new HonoRequest(new Request("http://localhost/", init));

const promiseOf = (value: unknown): { then?: unknown } => value as { then?: unknown };

describe("Hono body cache (H43 #345)", () => {
  it("is the version the pipeline's cached-read behaviour was read from", () => {
    // The pipeline casts `bodyCache` to the shapes below and relies on `#cachedBody`'s first-key lookup: read the
    // semantics here again on a bump, and update both sides together
    expect(version).toBe("4.9.6");
  });

  it("caches each reader's promise under the reader's own key", async () => {
    const textRequest = requestOf(asJson({ name: "ada" }));
    const text = textRequest.text();
    expect(textRequest.bodyCache.text).toBe(text);
    expect(typeof promiseOf(text).then).toBe("function");
    await text;

    const bytesRequest = requestOf(asJson({ name: "ada" }));
    const bytes = bytesRequest.arrayBuffer();
    expect(bytesRequest.bodyCache.arrayBuffer).toBe(bytes);
    expect(typeof promiseOf(bytes).then).toBe("function");
    await bytes;

    const blobRequest = requestOf(asJson({ name: "ada" }));
    const blob = blobRequest.blob();
    expect(blobRequest.bodyCache.blob).toBe(blob);
    expect(typeof promiseOf(blob).then).toBe("function");
    await blob;

    const formRequest = requestOf(multipart);
    const formData = formRequest.formData();
    expect(formRequest.bodyCache.formData).toBe(formData);
    expect(typeof promiseOf(formData).then).toBe("function");
    await formData;
  });

  it("caches parseBody()'s result as a plain value and does not read a JSON stream", async () => {
    const request = requestOf(asJson({ name: "ada" }));
    await expect(request.parseBody()).resolves.toEqual({});
    // A JSON media type answers `{}` without touching `raw`: the stream is still the pipeline's to read
    expect(Object.keys(request.bodyCache)).toEqual(["parsedBody"]);
    expect(promiseOf(request.bodyCache.parsedBody).then).toBeUndefined();
    expect(request.raw.bodyUsed).toBe(false);
  });

  it("chains every other reader from the first cache entry, which must be a promise", async () => {
    const request = requestOf(asJson({ name: "ada" }));
    await request.parseBody();
    // `bodyCache.text` is unset, so `#cachedBody` takes `Object.keys(bodyCache)[0]` (the plain `{}` of parsedBody) and
    // calls `.then` on it: the read throws synchronously, before any of the pipeline's mapping
    expect(() => request.text()).toThrow(TypeError);
    expect(() => request.arrayBuffer()).toThrow(TypeError);

    // The same fallback, with a promise first: the later read is served from the cached bytes
    const bytesRequest = requestOf(asJson({ name: "ada" }));
    await bytesRequest.arrayBuffer();
    expect(Object.keys(bytesRequest.bodyCache)).toEqual(["arrayBuffer"]);
    await expect(bytesRequest.text()).resolves.toBe('{"name":"ada"}');
  });

  it("serves a FormData a middleware put in the cache, without reading the raw stream", async () => {
    const request = requestOf(multipart);
    const formData = new FormData();
    formData.append("name", "ada");
    request.bodyCache.formData = formData;
    // `formData()` answers the cached FormData itself, not a promise, and `parseBody()` converts it
    const data = await request.formData();
    expect(data).toBe(formData);
    await expect(request.parseBody()).resolves.toEqual({ name: "ada" });
    expect(request.raw.bodyUsed).toBe(false);
  });

  it("needs the request's Content-Type to rebuild a FormData from bytes", async () => {
    // Hono's cached-bytes fallback builds `new Response(body)` with no headers; `formData()` then rejects on the
    // missing boundary. `bufferToFormData` is the exported parse that keeps the Content-Type, which the pipeline uses.
    const body = '--x\r\nContent-Disposition: form-data; name="name"\r\n\r\nada\r\n--x--\r\n';
    const bytes = new TextEncoder().encode(body);
    const expected = "multipart/form-data; boundary=x";
    await expect(bufferToFormData(bytes.buffer as ArrayBuffer, expected)).resolves.toBeInstanceOf(FormData);
    await expect(new Response(bytes).formData()).rejects.toThrow(TypeError);
  });
});

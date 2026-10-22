import type { Http2Bindings, HttpBindings } from "@hono/node-server";

type Fetch = (request: Request, env: HttpBindings | Http2Bindings, ...rest: never[]) => unknown;

/**
 * The body a Response carries, read without materializing @hono/node-server's lightweight Response:
 * its `body` getter builds a full Response, which would take a string body off the adapter's fast path.
 * The lightweight Response keeps `[status, body, headers]` under a symbol described "cache".
 */
const peekBody = (res: Response): { body: unknown, cache?: [number, unknown, HeadersInit] } => {
  for (const key of Object.getOwnPropertySymbols(res)) {
    const value = (res as unknown as Record<symbol, unknown>)[key];
    if (key.description === "cache" && Array.isArray(value) && value.length === 3) {
      return { body: value[1], cache: value as [number, unknown, HeadersInit] };
    }
  }
  // A native Response, or a lightweight one already materialized (or a future layout: slower, still correct)
  return { body: res.body };
}

/**
 * The class to rebuild `res` with, so the adapter takes the same path as before: its lightweight Response while it
 * still holds its body, else the native one (the lightweight class has it as prototype). A native Response goes
 * through the adapter's path that reads short bodies and sets Content-Length.
 */
const responseClass = (res: Response, cached: boolean): typeof Response => {
  const own = res.constructor as typeof Response;
  const parent = Object.getPrototypeOf(own);
  return cached || parent === Function.prototype ? own : parent;
}

/**
 * A pass-through of `body` that never errors. When `body` fails, the response is destroyed (the client sees
 * an aborted response), the error is reported once, and the stream handed to the adapter ends.
 */
const guardBody = (
  body: ReadableStream<Uint8Array>,
  outgoing: HttpBindings["outgoing"] | Http2Bindings["outgoing"],
  report: (error: unknown) => void,
) => {
  const reader = body.getReader();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let failed = false;
  const fail = (error: unknown) => {
    if (failed) {
      return;
    }
    failed = true;
    // Already destroyed: the client went away first, and a body tied to the request signal failed because of it
    const clientGone = outgoing.destroyed;
    // First, before the adapter ends the response: the socket closes and nothing more reaches the client
    outgoing.destroy();
    try {
      controller.close();
    }
    catch {
      // Already closed or canceled
    }
    if (clientGone) {
      return;
    }
    try {
      report(error);
    }
    catch {
      // A failing reporter must not error the stream: the adapter would write its message to the client
    }
  }
  // Also when no read is pending (the adapter waits for `drain`): the response is aborted at once
  reader.closed.catch(fail);
  // The source is canceled when the response closes, even if the adapter never read or canceled the guarded stream
  // (the client left before the adapter started writing): else `outgoing` lives as long as the source (an SSE stream).
  // Already destroyed (an async handler resolved after the client left): the adapter never reads it, cancel at once
  const cancelSource = () => {
    reader.cancel().catch(() => {});
  }
  if (outgoing.destroyed) {
    cancelSource();
  }
  else {
    outgoing.once("close", cancelSource);
  }

  return new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    async pull(c) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      }
      catch (error) {
        fail(error);
        return;
      }
      if (result.done) {
        c.close();
      }
      else {
        c.enqueue(result.value);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  }, { highWaterMark: 0 });
}

/**
 * Wraps the fetch callback given to @hono/node-server (#276). When a response body stream fails partway,
 * the adapter's own handler logs it and can write `Error: ${err.message}` to the client. Here the error is
 * logged once on the server and the response is destroyed, so the message never reaches the client.
 */
export const guardStreamErrors = <F extends Fetch>(
  fetch: F,
  report: (error: unknown) => void = (error) => console.error(error),
) => {
  const guard = (res: unknown, env: HttpBindings | Http2Bindings | undefined) => {
    // Not `instanceof Response`: the adapter replaces the global Response, and a native one (from fetch) is not an instance of it
    if (!env?.outgoing || typeof res !== "object" || res === null || !("body" in res && "headers" in res && "status" in res)) {
      return res;
    }
    const { body, cache } = peekBody(res as Response);
    if (typeof (body as ReadableStream | null)?.getReader !== "function") {
      return res;
    }
    const guarded = guardBody(body as ReadableStream<Uint8Array>, env.outgoing, report);
    // Status and headers only: the adapter never writes a statusText, and reading it would materialize the Response.
    // The same kind of Response as before, so the adapter takes the same path (and sets Content-Length the same way).
    // A cached one keeps its tuple's status and headers as they are: the `headers` getter turns plain headers into
    // a Headers, and the adapter then adds a default Content-Type the response never had
    const { status, headers } = cache ? { status: cache[0], headers: cache[2] } : res as Response;
    return new (responseClass(res as Response, cache !== undefined))(guarded, { status, headers });
  }

  return ((request: Request, env: HttpBindings | Http2Bindings, ...rest: never[]) => {
    const res = fetch(request, env, ...rest);
    return typeof (res as PromiseLike<unknown> | null)?.then === "function"
      ? Promise.resolve(res).then((value) => guard(value, env))
      : guard(res, env);
  }) as F;
}

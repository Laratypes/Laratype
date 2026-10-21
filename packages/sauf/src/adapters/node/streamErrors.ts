import type { Http2Bindings, HttpBindings } from "@hono/node-server";

type Fetch = (request: Request, env: HttpBindings | Http2Bindings) => unknown;

/**
 * The body a Response carries, read without materializing @hono/node-server's lightweight Response:
 * its `body` getter builds a full Response, which would take a string body off the adapter's fast path.
 * The lightweight Response keeps `[status, body, headers]` under a symbol described "cache".
 */
const peekBody = (res: Response): unknown => {
  for (const key of Object.getOwnPropertySymbols(res)) {
    const value = (res as unknown as Record<symbol, unknown>)[key];
    if (key.description === "cache" && Array.isArray(value) && value.length === 3) {
      return value[1];
    }
  }
  // A native Response, or a lightweight one already materialized (or a future layout: slower, still correct)
  return res.body;
}

/**
 * A pass-through of `body` that never errors. When `body` fails, the error is reported once and the
 * response is destroyed (the client sees an aborted response), and the stream handed to the adapter ends.
 */
const guardBody = (
  body: ReadableStream<Uint8Array>,
  outgoing: HttpBindings["outgoing"] | Http2Bindings["outgoing"],
  report: (error: unknown) => void,
) => {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      }
      catch (error) {
        report(error);
        // Before the adapter ends the response: the socket closes and nothing more reaches the client
        outgoing.destroy();
        controller.close();
        return;
      }
      if (result.done) {
        controller.close();
      }
      else {
        controller.enqueue(result.value);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  }, { highWaterMark: 0 });
}

/**
 * Wraps the fetch callback given to @hono/node-server (#276). When a response body stream fails partway,
 * the adapter's own handler logs it and writes `Error: ${err.message}` to the client. Here the error is
 * logged once on the server and the response is destroyed, so the message never reaches the client.
 */
export const guardStreamErrors = <F extends Fetch>(fetch: F, report: (error: unknown) => void = console.error) => {
  const guard = (res: unknown, env: HttpBindings | Http2Bindings) => {
    // Not `instanceof Response`: the adapter replaces the global Response, and a native one (from fetch) is not an instance of it
    if (typeof res !== "object" || res === null || !("body" in res && "headers" in res && "status" in res)) {
      return res;
    }
    const body = peekBody(res as Response);
    if (typeof (body as ReadableStream | null)?.getReader !== "function") {
      return res;
    }
    const guarded = guardBody(body as ReadableStream<Uint8Array>, env.outgoing, report);
    // Status and headers only: the adapter never writes a statusText, and reading it would materialize the Response
    const { status, headers } = res as Response;
    return new Response(guarded, { status, headers });
  }

  return ((request: Request, env: HttpBindings | Http2Bindings) => {
    const res = fetch(request, env);
    return res instanceof Promise ? res.then((value) => guard(value, env)) : guard(res, env);
  }) as F;
}

import { createServer, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { getRequestListener, type HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { guardStreamErrors } from "../src/adapters/node/streamErrors";

// #276 (H25): a response body stream that fails partway must not send its error message to the client
// on the Node adapter (@hono/node-server). The error is logged once on the server and the response is aborted.

const SECRET = "db password is hunter2";
const encoder = new TextEncoder();

/** A stream that sends one chunk, then errors: in the same tick, or after a delay. */
const failingStream = (delay?: number) => new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(encoder.encode("first-chunk;"));
    if (delay === undefined) {
      controller.error(new Error(SECRET));
    }
  },
  pull(controller) {
    if (delay !== undefined) {
      return new Promise<void>((resolve) => setTimeout(resolve, delay)).then(() => controller.error(new Error(SECRET)));
    }
  },
});

/**
 * A 64 KiB chunk, then an error while the adapter waits for `drain`: no read is pending, so without the guard the
 * adapter's handler ends the response with `Error: ${message}` and a terminating chunk.
 */
const backpressureStream = () => {
  let pulls = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls++ === 0) {
        controller.enqueue(new Uint8Array(64 * 1024).fill(97));
        return;
      }
      queueMicrotask(() => controller.error(new Error(SECRET)));
    },
  });
}

/** A 4 MiB chunk, then an error 20ms later: with a client that does not read, the adapter is still waiting for `drain`. */
const stalledStream = () => new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(new Uint8Array(4 * 1024 * 1024).fill(97));
    setTimeout(() => controller.error(new Error(SECRET)), 20);
  },
});

/** The native Response, under the adapter's lightweight Response installed globally (read at request time). */
const NativeResponse = () => Object.getPrototypeOf(Response) as typeof Response;

/** The raw bytes the client receives for `GET path`, until the server closes the connection. */
const rawGet = (port: number, path: string) => new Promise<string>((resolve) => {
  let data = "";
  const socket = connect(port, "127.0.0.1", () => {
    socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
  });
  socket.on("data", (chunk) => {
    data += chunk.toString();
  });
  socket.on("error", () => {});
  socket.on("close", () => resolve(data));
});

describe("guardStreamErrors (Node adapter)", () => {
  const report = vi.fn();
  const slowCanceled = vi.fn();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
  let server: Server;
  let port = 0;
  let stalledResponse: HttpBindings["outgoing"] | undefined;

  const app = new Hono();
  app.get("/later", (c) => c.body(failingStream(20)));
  app.get("/sync", (c) => c.body(failingStream()));
  app.get("/backpressure", (c) => c.body(backpressureStream()));
  app.get("/chunked", (c) => c.body(failingStream(20), 200, { "transfer-encoding": "chunked" }));
  // A native Response, which is not an instance of the Response the adapter installs globally
  app.get("/native", () => new (NativeResponse())(failingStream(20)));
  app.get("/native-short", () => new (NativeResponse())(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("short"));
      controller.close();
    },
  })));
  app.get("/stalled", (c) => {
    stalledResponse = (c.env as HttpBindings).outgoing;
    return c.body(stalledStream());
  });
  // One chunk, then nothing until the client goes away
  app.get("/slow", (c) => c.body(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("first-chunk;"));
    },
    cancel: slowCanceled,
  })));
  app.get("/thenable", () => ({
    then: (resolve: (value: Response) => void) => resolve(new Response(failingStream(20))),
  }) as unknown as Response);
  app.get("/ok", (c) => c.body(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("a;"));
      controller.enqueue(encoder.encode("b;"));
      controller.close();
    },
  }), 201, { "x-test": "1" }));
  app.get("/text", (c) => c.text("hello"));

  beforeAll(async () => {
    server = createServer(getRequestListener(guardStreamErrors(app.fetch, report)));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(() => {
    report.mockClear();
    consoleError.mockClear();
    consoleInfo.mockClear();
  });

  it("returns the response as is without Node bindings", () => {
    const response = new Response(failingStream(20));

    expect(guardStreamErrors(() => response)(new Request("http://localhost/"), undefined as never)).toBe(response);
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    consoleError.mockRestore();
    consoleInfo.mockRestore();
  });

  it.each(["/later", "/sync", "/backpressure", "/chunked", "/native", "/thenable"])("%s: never sends the error message, and logs the error once", async (path) => {
    const raw = await rawGet(port, path);

    expect(raw).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain("Error");
    // Aborted, not ended: no terminating chunk, so the client cannot take the body as complete
    expect(raw).not.toMatch(/\r\n0\r\n\r\n$/);
    // Logged once, by the guard only: the adapter's own handler never sees the error
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((report.mock.calls[0][0] as Error).message).toBe(SECRET);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("/later: the first chunk still reaches the client", async () => {
    const raw = await rawGet(port, "/later");

    expect(raw).toContain("first-chunk;");
  });

  it("aborts at once when the stream fails while the client does not read", async () => {
    stalledResponse = undefined;
    const socket = connect(port, "127.0.0.1", () => {
      socket.write("GET /stalled HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      socket.pause();
    });
    socket.on("error", () => {});
    try {
      // Reported and destroyed while the client still has not read anything
      await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1), { timeout: 2_000 });
      await vi.waitFor(() => expect(stalledResponse!.destroyed).toBe(true), { timeout: 2_000 });
      expect(consoleError).not.toHaveBeenCalled();
    }
    finally {
      socket.destroy();
    }
  });

  it("does not report a client abort", async () => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write("GET /slow HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    });
    socket.on("error", () => {});
    await new Promise((resolve) => socket.once("data", resolve));
    socket.destroy();

    await vi.waitFor(() => expect(slowCanceled).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(report).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("never sends the error message when the reporter throws", async () => {
    const throwingServer = createServer(getRequestListener(guardStreamErrors(app.fetch, () => {
      throw new Error("reporter failed");
    })));
    await new Promise<void>((resolve) => throwingServer.listen(0, "127.0.0.1", resolve));
    try {
      const port = (throwingServer.address() as AddressInfo).port;
      for (const path of ["/later", "/backpressure"]) {
        const raw = await rawGet(port, path);

        expect(raw).not.toContain(SECRET);
        expect(raw).not.toContain("reporter failed");
      }
    }
    finally {
      await new Promise((resolve) => throwingServer.close(resolve));
    }
  });

  it("keeps a native Response native: a short body still gets its Content-Length", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/native-short`);

    expect(res.headers.get("content-length")).toBe("5");
    expect(await res.text()).toBe("short");
  });

  it("logs with console.error by default", async () => {
    const defaultServer = createServer(getRequestListener(guardStreamErrors(app.fetch)));
    await new Promise<void>((resolve) => defaultServer.listen(0, "127.0.0.1", resolve));
    try {
      const raw = await rawGet((defaultServer.address() as AddressInfo).port, "/later");

      expect(raw).not.toContain(SECRET);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect((consoleError.mock.calls[0][0] as Error).message).toBe(SECRET);
    }
    finally {
      await new Promise((resolve) => defaultServer.close(resolve));
    }
  });

  it("passes a stream that completes through unchanged", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/ok`);

    expect(res.status).toBe(201);
    expect(res.headers.get("x-test")).toBe("1");
    expect(await res.text()).toBe("a;b;");
    expect(report).not.toHaveBeenCalled();
  });

  it("returns a response without a stream body as is", async () => {
    const response = new Response("hello");
    const fetchCallback = guardStreamErrors(() => response);

    // Also pins the adapter's lightweight Response layout: a string body is read without materializing it
    expect(fetchCallback(new Request("http://localhost/"), { outgoing: {} } as never)).toBe(response);

    const res = await fetch(`http://127.0.0.1:${port}/text`);
    expect(await res.text()).toBe("hello");
  });
});

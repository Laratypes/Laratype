// B30 #410 r2: the pipeline's form decision must cover every `hono` peer in `^4.8.0`. 4.8.0–4.12.27's `parseBody()`
// matches the header as sent with a case-sensitive `startsWith`; 4.12.28+ splits at `;`, trims, lowercases and compares
// exactly. The pipeline reads a request as a form when EITHER rule does (fail closed), so a spelling one peer parses can
// never reach a handler unvalidated because another peer's rule was copied. The suite runs under Node (vitest); the
// runtime-dependent expectations below come from Hono's own parse on the running runtime, so Bun's parser differences
// (leading U+00A0, old-only urlencoded) do not hard-code Node behavior.
import "reflect-metadata";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Container, depsRegistry } from "@laratype/core";
import { HTTP_APP } from "@laratype/support";
import { Controller, Request as RequestSupport, RequestKernel, ResponseKernel } from "../../src/index";
import type { AdHocRouteParams } from "../../src/index";
import { BODY_LIMIT_DEFAULTS, formMediaType } from "../../src/request/bodyLimit";

const bootApp = (): Hono => {
  const container = new Container({ deps: depsRegistry });
  const app = new Hono();
  container.instance(HTTP_APP, app);
  new RequestKernel(container).boot();
  new ResponseKernel(container).boot();
  return app;
};

beforeAll(() => {
  globalThis.__laratype_route_model_bindings = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fresh Hono app per call, so `parseBody()` runs on a request the pipeline never read or cached. */
const parseWithHono = async (header: string, body: string): Promise<{ ok: true; value: unknown } | { ok: false }> => {
  const app = new Hono();
  let result: { ok: true; value: unknown } | { ok: false } = { ok: false };
  app.post("/", async (c) => {
    try {
      result = { ok: true, value: await c.req.parseBody({ dot: true }) };
    } catch {
      result = { ok: false };
    }
    return c.text("ok");
  });
  await app.request("/", { method: "POST", headers: { "Content-Type": header }, body });
  return result;
};

/** A fresh pipeline app per call: a 0.5 route whose handler records `input()`. */
const sendThroughPipeline = async (header: string, body: string) => {
  const app = bootApp();
  const captured: { input?: unknown } = {};
  const route = {
    method: "post",
    path: "/form",
    modelBinding: false,
    handler: (req: RequestSupport) => {
      captured.input = req.input();
      return { ok: true };
    },
  } satisfies AdHocRouteParams;
  app.post("/form", RequestKernel.handle(route));
  const response = await app.request("/form", { method: "POST", headers: { "Content-Type": header }, body });
  return { status: response.status, input: captured.input };
};

const URLENCODED = "a=1";
const MULTIPART = "--x\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\n1\r\n--x--\r\n";

/** 4.8.0–4.12.27's rule: `contentType?.startsWith(...)` on the header as sent (case-sensitive, no trim). */
const oldRule = (header: string): boolean =>
  header.startsWith("multipart/form-data") || header.startsWith("application/x-www-form-urlencoded");

/** 4.12.28+'s rule: `split(";")[0].trim().toLowerCase()` compared exactly. */
const newRule = (header: string): boolean => {
  const mediaType = header.split(";")[0]!.trim().toLowerCase();
  return mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded";
};

type FormCase = { header: string; kind: "both" | "old" | "new" | "neither"; multipart?: boolean };

const CASES: FormCase[] = [
  { header: "application/x-www-form-urlencoded", kind: "both" },
  { header: "application/x-www-form-urlencoded; charset=utf-8", kind: "both" },
  { header: "application/x-www-form-urlencoded ; charset=utf-8", kind: "both" },
  { header: "multipart/form-data; boundary=x", kind: "both", multipart: true },
  { header: "multipart/form-data", kind: "both", multipart: true },
  { header: "\u00a0application/x-www-form-urlencoded", kind: "new" },
  { header: "\tapplication/x-www-form-urlencoded", kind: "new" },
  { header: " application/x-www-form-urlencoded ", kind: "new" },
  { header: "\u00a0application/x-www-form-urlencoded; charset=utf-8", kind: "new" },
  { header: "Application/X-WWW-Form-Urlencoded", kind: "new" },
  { header: "Multipart/Form-Data; boundary=x", kind: "new", multipart: true },
  { header: "\u00a0Multipart/Form-Data; boundary=x", kind: "new", multipart: true },
  { header: "\u00a0multipart/form-data; boundary=x", kind: "new", multipart: true },
  { header: "application/x-www-form-urlencodedx", kind: "old" },
  { header: "multipart/form-datax", kind: "old", multipart: true },
  { header: "", kind: "neither" },
  { header: "text/plain", kind: "neither" },
  { header: "Application/X-WWW-Form-Urlencodedx", kind: "neither" },
];

describe("form media type across the hono ^4.8.0 peer range (B30 #410)", () => {
  it.each(CASES)("classifies and parses $header exactly as the union of Hono's rules", async ({ header, kind, multipart }) => {
    const body = multipart ? MULTIPART : URLENCODED;
    const union = oldRule(header) || newRule(header);
    expect(kind, `the case is labelled with the rules it exercises`).toBe(
      oldRule(header) && newRule(header) ? "both" : oldRule(header) ? "old" : newRule(header) ? "new" : "neither",
    );
    expect(formMediaType(header) !== undefined).toBe(union);

    const pipeline = await sendThroughPipeline(header, body);
    const hono = await parseWithHono(header, body);

    if (!union) {
      // Neither rule reads it as a form: the pipeline leaves it `{}` and Hono's `parseBody()` returns `{}` on every peer
      expect(hono).toEqual({ ok: true, value: {} });
      expect(pipeline.status).toBe(200);
      expect(pipeline.input).toEqual({});
      return;
    }

    if (newRule(header)) {
      // The installed Hono (4.13.17) classifies it as a form: the pipeline must agree, field for field. A platform
      // parse rejection (a leading U+00A0 on Node) is the malformed-form 400, not a `{}` that skips validation.
      if (hono.ok) {
        expect(pipeline.status).toBe(200);
        expect(pipeline.input).toEqual(hono.value);
      } else {
        expect(pipeline.status).toBe(400);
      }
      return;
    }

    // Only the old rule reads it as a form; Hono 4.13.17 answers `{}` but the pipeline must still parse it (or answer
    // the malformed-form 400 where the platform's parser refuses the media type), never hand over `{}` as if it were
    // not a form. On Bun `application/x-www-form-urlencodedx` parses; on Node the platform rejects it.
    expect([200, 400]).toContain(pipeline.status);
    if (pipeline.status === 200) expect(pipeline.input).toEqual({ a: "1" });
    else expect(pipeline.input).toBeUndefined();
  });

  it("caps every spelling either rule reads as a form", async () => {
    for (const { header, multipart } of CASES.filter((item) => oldRule(item.header) || newRule(item.header))) {
      const cap = multipart ? BODY_LIMIT_DEFAULTS.multipart : BODY_LIMIT_DEFAULTS.form;
      const body = multipart
        ? `--x\r\nContent-Disposition: form-data; name="data"\r\n\r\n${"a".repeat(cap + 1)}\r\n--x--\r\n`
        : `name=${"a".repeat(cap + 1)}`;
      const { status } = await sendThroughPipeline(header, body);
      expect(status, `${JSON.stringify(header)} over its ${multipart ? "multipart" : "form"} cap`).toBe(413);
    }
  });

  it("does not cap a spelling neither rule reads as a form", async () => {
    const body = `name=${"a".repeat(BODY_LIMIT_DEFAULTS.form + 1)}`;
    const pipeline = await sendThroughPipeline("text/plain", body);
    expect(pipeline.status).toBe(200);
    expect(pipeline.input).toEqual({});
  });

  it("stops a handler-side c.req.parseBody() at the cap for a whitespace-prefixed form", async () => {
    let reached = false;
    let parsed: unknown;
    class FormRequest extends RequestSupport {
      parse() {
        return this.requestCtx.parseBody({ dot: true });
      }
    }
    class Users extends Controller {
      async store(req: FormRequest) {
        reached = true;
        parsed = await req.parse();
        return { ok: true };
      }
    }
    const app = bootApp();
    app.post("/users", RequestKernel.handle({ method: "post", path: "/users", request: FormRequest, controller: [Users, "store"] }));
    const body = `name=${"a".repeat(BODY_LIMIT_DEFAULTS.form + 1)}`;
    const response = await app.request("/users", { method: "POST", headers: { "Content-Type": "\tapplication/x-www-form-urlencoded" }, body });
    expect(response.status).toBe(413);
    expect(reached).toBe(false);
    expect(parsed).toBeUndefined();
  });

  it("caps a chunked whitespace-prefixed form without a Content-Length", async () => {
    const bytes = new TextEncoder().encode(`name=${"a".repeat(BODY_LIMIT_DEFAULTS.form + 1)}`);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 64 * 1024) controller.enqueue(bytes.slice(at, at + 64 * 1024));
        controller.close();
      },
    });
    const app = bootApp();
    const captured: { input?: unknown } = {};
    app.post(
      "/form",
      RequestKernel.handle({
        method: "post",
        path: "/form",
        modelBinding: false,
        handler: (req: RequestSupport) => {
          captured.input = req.input();
          return { ok: true };
        },
      }),
    );
    const init = { method: "POST", headers: { "Content-Type": "\tapplication/x-www-form-urlencoded" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" };
    const response = await app.request("/form", init);
    expect(response.status).toBe(413);
    expect(captured.input).toBeUndefined();
  });
});

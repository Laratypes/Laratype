// B30 #410 r2: the pipeline's form decision must cover every `hono` rule the framework has declared, the `^4.8.0`
// arm through `^4.13.23`'s. 4.8.0–4.12.27's `parseBody()` matches the header as sent with a case-sensitive
// `startsWith`; 4.12.28+ (every peer since the floor moved to `^4.13.23`) splits at `;`, trims, lowercases and compares
// exactly. The pipeline reads a request as a form when EITHER rule does (fail closed), so a spelling one peer parses can
// never reach a handler unvalidated because another peer's rule was copied. A Content-Type holding more than one media
// type is the 400 before either rule, and so is a form type name anywhere outside the leading media type (Bun's
// `formData()` picks the type by a substring search over the whole header; B30 #410 security fixes). The suite runs
// under Node (vitest); the runtime-dependent expectations below come from Hono's own parse on the running runtime, so
// Bun's parser differences (leading U+00A0, old-only urlencoded) do not hard-code Node behavior.
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
  // A 400 is the pipeline's JSON answer; the route's 200 is JSON too, and a 413 is text
  const message = response.status === 400 ? ((await response.json()) as { message?: string }).message : undefined;
  return { status: response.status, input: captured.input, message };
};

const URLENCODED = "a=1";
const MULTIPART = "--x\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\n1\r\n--x--\r\n";
const WEBKIT_BOUNDARY = "----WebKitFormBoundaryAbC123";
const WEBKIT_MULTIPART = `--${WEBKIT_BOUNDARY}\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--${WEBKIT_BOUNDARY}--\r\n`;
const FORM_MESSAGE = "Invalid Content-Type header: a form media type name outside the leading media type.";

/** 4.8.0–4.12.27's rule: `contentType?.startsWith(...)` on `headers.get()` (leading/trailing HTTP whitespace stripped). */
const oldRule = (header: string): boolean =>
  header.startsWith("multipart/form-data") || header.startsWith("application/x-www-form-urlencoded");

/** 4.12.28+'s rule: `split(";")[0].trim().toLowerCase()` compared exactly. */
const newRule = (header: string): boolean => {
  const mediaType = header.split(";")[0]!.trim().toLowerCase();
  return mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded";
};

/** The 0.5 default cap's rule (and r1's classifier): `contentType.toLowerCase().startsWith(...)`. */
const masterRule = (header: string): boolean => {
  const lower = header.toLowerCase();
  return lower.startsWith("multipart/form-data") || lower.startsWith("application/x-www-form-urlencoded");
};

type FormCase = { header: string; kind: "both" | "old" | "new" | "master" | "neither"; multipart?: boolean };

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
  { header: "", kind: "neither" },
  { header: "text/plain", kind: "neither" },
];

describe("form media type over the hono ^4.13.23 peer's rule and the older arms (B30 #410)", () => {
  it.each(CASES)("classifies and parses $header exactly as the union of Hono's rules", async ({ header, kind, multipart }) => {
    const body = multipart ? MULTIPART : URLENCODED;
    const union = oldRule(header) || newRule(header) || masterRule(header);
    const expectedKind =
      oldRule(header) && newRule(header)
        ? "both"
        : oldRule(header)
          ? "old"
          : newRule(header)
            ? "new"
            : masterRule(header)
              ? "master"
              : "neither";
    expect(kind, `the case is labelled with the rules it exercises`).toBe(expectedKind);
    expect(formMediaType(header) !== undefined).toBe(union);

    const pipeline = await sendThroughPipeline(header, body);
    const hono = await parseWithHono(header, body);

    if (!union) {
      // No rule reads it as a form: the pipeline leaves it `{}` and Hono's `parseBody()` returns `{}` on every peer
      expect(hono).toEqual({ ok: true, value: {} });
      expect(pipeline.status).toBe(200);
      expect(pipeline.input).toEqual({});
      return;
    }

    if (newRule(header)) {
      // The installed Hono (4.13.23) classifies it as a form: the pipeline must agree, field for field. A platform
      // parse rejection (a leading U+00A0 on Node) is the malformed-form 400, not a `{}` that skips validation.
      if (hono.ok) {
        expect(pipeline.status).toBe(200);
        expect(pipeline.input).toEqual(hono.value);
      } else {
        expect(pipeline.status).toBe(400);
      }
      return;
    }
  });

  it("caps every spelling any rule reads as a form", async () => {
    for (const { header, multipart } of CASES.filter(
      (item) => oldRule(item.header) || newRule(item.header) || masterRule(item.header),
    )) {
      const cap = multipart ? BODY_LIMIT_DEFAULTS.multipart : BODY_LIMIT_DEFAULTS.form;
      const body = multipart
        ? `--x\r\nContent-Disposition: form-data; name="data"\r\n\r\n${"a".repeat(cap + 1)}\r\n--x--\r\n`
        : `name=${"a".repeat(cap + 1)}`;
      const { status } = await sendThroughPipeline(header, body);
      expect(status, `${JSON.stringify(header)} over its ${multipart ? "multipart" : "form"} cap`).toBe(413);
    }
  });

  it.each([
    ["a comma-joined mixed-case multipart", "MULTIPART/FORM-DATA, multipart/form-data; boundary=x", MULTIPART],
    [
      "a comma-joined mixed-case urlencoded",
      "Application/X-WWW-Form-Urlencoded, application/x-www-form-urlencoded",
      URLENCODED,
    ],
    ["an unterminated quoted-string", 'multipart/form-data; boundary=x; note="a,b', MULTIPART],
    ["an escaped comma in an unterminated quoted-string", 'text/plain; x="\\, application/x-www-form-urlencoded', URLENCODED],
  ] as const)("answers 400 for %s Content-Type", async (_label, header, body) => {
    // Two media types in one singleton field (RFC 9110 §8.3): the pipeline refuses it before classifying or capping,
    // instead of parsing a form the platform reads from the last value (B30 #410 security fix). An unterminated
    // quoted-string is no quoted-string, so its comma separates values too (fail closed).
    const { status, input, message } = await sendThroughPipeline(header, body);
    expect(status).toBe(400);
    expect(message).toBe("Invalid Content-Type header: more than one media type.");
    expect(input).toBeUndefined();
  });

  it.each([
    ["a form name in a parameter", 'multipart/form-data; boundary=x; t="application/x-www-form-urlencoded"', URLENCODED],
    ["a form name as a quoted boundary", 'multipart/form-data; boundary="application/x-www-form-urlencoded"', URLENCODED],
    ["a form name on a non-form type", 'text/plain; t="application/x-www-form-urlencoded"', "u=1"],
    ["a form name in an octet-stream parameter", "application/octet-stream; boundary=x; t=multipart/form-data", "u=1"],
    ["both form names outside the leading type", "text/plain; a=multipart/form-data; b=application/x-www-form-urlencoded", "u=1"],
    ["a form name as a suffix", "application/x-www-form-urlencodedx", URLENCODED],
    ["a form name embedded in another type", "x-multipart/form-data", URLENCODED],
  ] as const)("answers 400 for %s in the Content-Type", async (_label, header, body) => {
    // Bun's formData() picks the type by a case-sensitive substring search anywhere in the header, while the pipeline
    // classifies and caps the leading type only; a form name outside that leading type is refused before either.
    const { status, input, message } = await sendThroughPipeline(header, body);
    expect(status).toBe(400);
    expect(message).toBe(FORM_MESSAGE);
    expect(input).toBeUndefined();
  });

  it.each([
    ["application/x-www-form-urlencodedx", "application/x-www-form-urlencoded"],
    ["multipart/form-datax", "multipart/form-data"],
    ["Application/X-WWW-Form-Urlencodedx", "application/x-www-form-urlencoded"],
  ] as const)("keeps the three-arm classifier for %s while readBody refuses it", async (header, expected) => {
    expect(formMediaType(header)).toBe(expected);
    const { status, message } = await sendThroughPipeline(header, URLENCODED);
    expect(status).toBe(400);
    expect(message).toBe(FORM_MESSAGE);
  });

  it.each([
    ["multipart/form-data; boundary=x", MULTIPART, { a: "1" }],
    [`multipart/form-data; boundary="${WEBKIT_BOUNDARY}"`, WEBKIT_MULTIPART, { a: "1" }],
    ["application/x-www-form-urlencoded; charset=utf-8", URLENCODED, { a: "1" }],
    ["Multipart/Form-Data; boundary=x", MULTIPART, { a: "1" }],
    ["text/plain; charset=utf-8", URLENCODED, {}],
    ["application/json", '{"a":1}', { a: 1 }],
  ] as const)("keeps %s a single accepted type", async (header, body, expected) => {
    // The valid leading types, a browser-style boundary and a non-form type with no form name stay parsed as before.
    const parsed = await sendThroughPipeline(header, body);
    expect(parsed.status).toBe(200);
    expect(parsed.input).toEqual(expected);
  });

  it.each([
    [
      "a comma inside a quoted boundary",
      'multipart/form-data; boundary="a,b"',
      '--a,b\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--a,b--\r\n',
    ],
    ["an escaped quote before a comma", 'multipart/form-data; boundary=x; note="a\\",b"', MULTIPART],
    ["a long quoted parameter with a comma", `multipart/form-data; boundary=x; note="${"a".repeat(10_000)},b"`, MULTIPART],
    ["a unicode quoted parameter with a comma", 'multipart/form-data; boundary=x; note="é,à"', MULTIPART],
    ["OWS before the parameters", "multipart/form-data ; boundary=x", MULTIPART],
  ] as const)("reads %s as one media type", async (_label, header, body) => {
    // A comma inside a quoted-string is not a second value (RFC 9110 §5.6.4), and a quoted `\"` is not the closing
    // quote; the header is still one form media type, so the body parses as usual.
    const parsed = await sendThroughPipeline(header, body);
    expect(parsed.status).toBe(200);
    expect(parsed.input).toEqual({ a: "1" });
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

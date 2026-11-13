// H44 #341: the default request body limit. JSON and urlencoded bodies over 1 MiB, and multipart bodies over 10 MiB,
// answer 413 without an app `bodyLimit`; the caps live in `app/config/http.ts` (`bodyLimit`), and a route or app
// `bodyLimit` mounted before the pipeline's read can only tighten them (docs/v1/http.md › Default body limit).
import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { Container, depsRegistry, setConfigs } from "@laratype/core";
import { HTTP_APP } from "@laratype/support";
import { defineApi, defineContract, endpoint } from "@laratype/contract";
import { BODY_LIMIT_DEFAULTS, isPayloadTooLarge } from "../../src/request/bodyLimit";
import { Controller, Request as RequestSupport, RequestKernel, ResponseKernel, Route } from "../../src/index";
import type { Ctx } from "../../src/index";

const MIB = 1_048_576;

/** The config store `setConfigs` fills; deleted after each test so a boot reads the built-in defaults again. */
const store = globalThis as { __laratype_configs?: unknown };

afterEach(() => {
  delete store.__laratype_configs;
  vi.restoreAllMocks();
});

const quiet = () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return vi.spyOn(console, "error").mockImplementation(() => {});
};

/**
 * An app booted like `sauf dev`: `ConfigLoadServiceProvider` has filled the store (with `{}` when the app has no
 * `app/config/http.ts`), then RequestKernel and ResponseKernel. `http` is the `http` config file's content.
 */
const bootApp = (http?: unknown, loadConfigs = true): Hono => {
  if (!loadConfigs) delete store.__laratype_configs;
  else if (http === undefined) setConfigs({});
  else setConfigs({ http });
  const container = new Container({ deps: depsRegistry });
  const app = new Hono();
  container.instance(HTTP_APP, app);
  new RequestKernel(container).boot();
  new ResponseKernel(container).boot();
  return app;
};

/** A 0.5 route (`Route.group`'s kernel) or a `Route.api` contract route, both POST /users and answer 201. */
const mount = (app: Hono, kind: "0.5" | "Route.api"): void => {
  if (kind === "0.5") {
    class Users extends Controller {
      store() {
        return { ok: true };
      }
    }
    app.post("/users", RequestKernel.handle({ method: "post", path: "/users", controller: [Users, "store"] }));
    return;
  }
  const users = defineContract()({
    store: endpoint.post("/").body(z.object({ name: z.string() })).response(z.unknown(), 201),
  });
  class Users {
    store(ctx: Ctx<typeof users.store>) {
      // Echo the parsed body, so a test can see it arrived intact under a limit
      return { name: ctx.body.name };
    }
  }
  Route.api(defineApi({ users: { contract: users, path: "/users", scopes: [] } }), (r) => [r.contract(users, Users)]).mount(app);
};

const json = (body: unknown, contentType = "application/json") => ({
  method: "POST",
  headers: { "Content-Type": contentType },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

const form = (body: string, contentType = "application/x-www-form-urlencoded") => ({
  method: "POST",
  headers: { "Content-Type": contentType },
  body,
});

/** A mixed-case form media type: media types are case-insensitive (RFC 9110 §8.3.1). */
const MIXED_CASE_MULTIPART = "Multipart/Form-Data; boundary=x";
const MIXED_CASE_FORM = "Application/X-WWW-Form-Urlencoded";

/** The same, with a Content-Length: the default limit then compares the header and answers 413 without reading. */
const sized = (init: { method: string; headers: Record<string, string>; body: string }) => ({
  ...init,
  headers: { ...init.headers, "Content-Length": String(init.body.length) },
});

/** `Payload Too Large` as a text body, Hono's `bodyLimit` answer and the shape an app `bodyLimit` gives today. */
const expect413 = async (response: Response): Promise<void> => {
  expect(response.status).toBe(413);
  expect(response.headers.get("Content-Type")).toMatch(/^text\/plain/);
  expect(await response.text()).toBe("Payload Too Large");
};

/** A multipart body of one field, `bytes` bytes of `a`, with the framing and boundary counted in the raw size. */
const multipart = (bytes: number) =>
  `--x\r\nContent-Disposition: form-data; name="data"\r\n\r\n${"a".repeat(bytes)}\r\n--x--\r\n`;

/** Both kernels the default covers: a 0.5 route and a `Route.api` contract route. */
const KINDS = [
  ["0.5", "0.5"],
  ["Route.api", "Route.api"],
] as const;

describe("the default body limit (H44 #341)", () => {
  it("applies the built-in defaults when the app has no config store at all", async () => {
    quiet();
    // No ConfigLoadServiceProvider: config() throws, and the kernel boots on the defaults instead of failing
    const app = bootApp(undefined, false);
    mount(app, "0.5");
    await expect413(await app.request("/users", sized(json({ name: "a".repeat(MIB) }))));
  });

  it.each(KINDS)("answers a JSON body over 1 MiB with 413 on a %s route", async (_label, kind) => {
    quiet();
    const app = bootApp();
    mount(app, kind);
    await expect413(await app.request("/users", sized(json({ name: "a".repeat(MIB) }))));
  });

  it.each(KINDS)("answers a urlencoded body over 1 MiB with 413 on a %s route", async (_label, kind) => {
    quiet();
    const app = bootApp();
    mount(app, kind);
    await expect413(await app.request("/users", sized(form(`name=${"a".repeat(MIB)}`))));
  });

  it.each(KINDS)("answers a multipart body over 10 MiB with 413 on a %s route", async (_label, kind) => {
    quiet();
    const app = bootApp();
    mount(app, kind);
    const body = multipart(BODY_LIMIT_DEFAULTS.multipart);
    const init = sized({ method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=x" }, body });
    await expect413(await app.request("/users", init));
  });

  it("lets a JSON, urlencoded and multipart body under the defaults through", async () => {
    quiet();
    const app = bootApp();
    mount(app, "0.5");
    expect((await app.request("/users", json({ name: "ada" }))).status).toBe(201);
    expect((await app.request("/users", form("name=ada"))).status).toBe(201);
    const data = new FormData();
    data.append("name", "ada");
    expect((await app.request("/users", { method: "POST", body: data })).status).toBe(201);
  });

  it("stops a chunked JSON body without Content-Length at the limit", async () => {
    quiet();
    const app = bootApp();
    mount(app, "0.5");
    // No Content-Length: the body is counted and errors at 1 MiB, before the parser sees the rest
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(JSON.stringify({ name: "a".repeat(MIB) }));
        for (let at = 0; at < bytes.length; at += 64 * 1024) controller.enqueue(bytes.slice(at, at + 64 * 1024));
        controller.close();
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      duplex: "half",
    };
    await expect413(await app.request("/users", init));
  });

  it("counts the stream even when Content-Length claims less", async () => {
    quiet();
    const app = bootApp({ bodyLimit: { json: 1_024 } });
    mount(app, "0.5");
    const text = JSON.stringify({ d: "a".repeat(4_096 - 8) });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(text);
        for (let at = 0; at < bytes.length; at += 64) controller.enqueue(bytes.slice(at, at + 64));
        controller.close();
      },
    });
    // A declared length under the cap is not trusted: the stream is counted anyway
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "10" },
      body,
      duplex: "half",
    };
    await expect413(await app.request("/users", init));
  });

  it("refuses a declared Content-Length over the cap without reading the stream", async () => {
    quiet();
    const app = bootApp({ bodyLimit: { json: 4_096 } });
    mount(app, "0.5");
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1_024;
        controller.enqueue(new Uint8Array(1_024));
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "4097" },
      body,
      duplex: "half",
    };
    await expect413(await app.request("/users", init));
    // The stream's own read-ahead fills one chunk; the declared length is refused before any other pull
    expect(pulled).toBeLessThanOrEqual(1_024);
  });

  it("stops pulling the source at the cap instead of buffering the whole body", async () => {
    quiet();
    const app = bootApp({ bodyLimit: { json: 4_096 } });
    mount(app, "0.5");
    const chunk = 1_024;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 100 * chunk) {
          controller.close();
          return;
        }
        pulled += chunk;
        controller.enqueue(new Uint8Array(chunk));
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      duplex: "half",
    };
    await expect413(await app.request("/users", init));
    // At most the chunk that crossed the cap and the streams' own read-ahead: never the 100 KB the body holds
    expect(pulled).toBeLessThanOrEqual(8 * chunk);
  });

  it("passes a body exactly at the cap and answers 413 one byte over", async () => {
    quiet();
    const app = bootApp({ bodyLimit: { json: 1_024 } });
    mount(app, "0.5");
    // `{"d":"..."}`: the JSON text is exactly 1024 bytes with 1016 filler bytes, 1025 with 1017
    expect((await app.request("/users", json(`{"d":"${"a".repeat(1_016)}"}`))).status).toBe(201);
    await expect413(await app.request("/users", json(`{"d":"${"a".repeat(1_017)}"}`)));
  });
});

describe("a body an earlier middleware already read (H44 #341)", () => {
  const cachedApp = (limit: number) => {
    const app = bootApp({ bodyLimit: { json: limit } });
    // Reads the body through Hono's reader before the kernel: the bytes are in Hono's cache, not the stream
    app.use(async (c, next) => {
      await c.req.text();
      await next();
    });
    mount(app, "0.5");
    return app;
  };

  it("measures a cached body and answers 413 over the cap", async () => {
    quiet();
    const app = cachedApp(1_024);
    await expect413(await app.request("/users", json({ d: "a".repeat(2_048) })));
  });

  it("serves a cached body under the cap", async () => {
    quiet();
    const app = cachedApp(1_024);
    expect((await app.request("/users", json({ name: "ada" }))).status).toBe(201);
  });

  it("measures cached bytes as well as cached text", async () => {
    quiet();
    const app = bootApp({ bodyLimit: { json: 1_024 } });
    app.use(async (c, next) => {
      await c.req.arrayBuffer();
      await next();
    });
    mount(app, "0.5");
    await expect413(await app.request("/users", json({ d: "a".repeat(2_048) })));
  });
});

describe("multipart raw bytes (H44 #341)", () => {
  it("caps the raw multipart bytes before parsing, not the field value", async () => {
    quiet();
    const app = bootApp({ bodyLimit: { multipart: 2_048 } });
    mount(app, "0.5");
    // A 2000-byte field fits the cap, but its boundary and headers push the raw body over it
    const body = multipart(2_000);
    expect(body.length).toBeGreaterThan(2_048);
    await expect413(await app.request("/users", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=x" }, body }));
  });
});

describe("an app or route bodyLimit over the default (H44 #341)", () => {
  it("an app bodyLimit mounted before the read tightens the default, with its own 413", async () => {
    quiet();
    const app = bootApp();
    // An app middleware, as a provider's boot() mounts it: it runs before the pipeline's read, so its smaller cap
    // sees the stream first and answers its own 413; the default would have let this under-1-MiB body through
    app.use(bodyLimit({ maxSize: 256, onError: () => new Response("app limit", { status: 413 }) }));
    mount(app, "Route.api");
    // Under the app's own cap the body reaches the handler intact
    const under = await app.request("/users", json({ name: "ada" }));
    expect(under.status).toBe(201);
    expect(await under.json()).toEqual({ name: "ada" });
    const response = await app.request("/users", json({ name: "a".repeat(512) }));
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("app limit");
  });

  it("a route bodyLimit tightens the default, with its own 413", async () => {
    quiet();
    const app = bootApp();
    class Users extends Controller {
      store() {
        return { ok: true };
      }
    }
    app.post(
      "/users",
      bodyLimit({ maxSize: 256, onError: () => new Response("route limit", { status: 413 }) }),
      RequestKernel.handle({ method: "post", path: "/users", controller: [Users, "store"] }),
    );
    const response = await app.request("/users", json({ name: "a".repeat(512) }));
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("route limit");
  });

  it("cannot raise the default: a larger app bodyLimit does not lift it", async () => {
    quiet();
    const app = bootApp();
    app.use(bodyLimit({ maxSize: 2 * MIB }));
    mount(app, "0.5");
    // Over the default and under the app's own cap: the default still answers 413
    await expect413(await app.request("/users", json({ name: "a".repeat(MIB) })));
  });
});

describe("app/config/http.ts bodyLimit (H44 #341)", () => {
  it("raises a cap", async () => {
    quiet();
    const app = bootApp({ bodyLimit: { json: 2 * MIB } });
    mount(app, "0.5");
    expect((await app.request("/users", json({ name: "a".repeat(MIB + 512) }))).status).toBe(201);
    await expect413(await app.request("/users", json({ name: "a".repeat(2 * MIB) })));
  });

  it("lowers one type and leaves the others at their defaults", async () => {
    quiet();
    const app = bootApp({ bodyLimit: { multipart: 2_048 } });
    mount(app, "0.5");
    const body = multipart(4_096);
    await expect413(
      await app.request("/users", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=x" }, body }),
    );
    // JSON keeps its 1 MiB default: this body is well under it
    expect((await app.request("/users", json({ name: "a".repeat(1_024) }))).status).toBe(201);
  });

  it("disables one type with false", async () => {
    quiet();
    const app = bootApp({ bodyLimit: { json: false } });
    mount(app, "0.5");
    expect((await app.request("/users", json({ name: "a".repeat(MIB + 512) }))).status).toBe(201);
    // The form cap stays: a urlencoded body over 1 MiB is still 413
    await expect413(await app.request("/users", form(`name=${"a".repeat(MIB)}`)));
  });

  it("disables every cap with bodyLimit: false", async () => {
    quiet();
    const app = bootApp({ bodyLimit: false });
    mount(app, "0.5");
    expect((await app.request("/users", json({ name: "a".repeat(MIB + 512) }))).status).toBe(201);
    expect((await app.request("/users", form(`name=${"a".repeat(MIB + 512)}`))).status).toBe(201);
  });

  it("keeps the built-in default for an invalid cap instead of failing open", async () => {
    quiet();
    // Runtime config is not validated: a typo must not remove the cap
    const app = bootApp({ bodyLimit: { json: "2mb" } });
    mount(app, "0.5");
    await expect413(await app.request("/users", json({ name: "a".repeat(MIB) })));
  });
});

describe("mixed-case form media types (H44 security review)", () => {
  /** A 0.5 route that echoes its input, so a test can tell a parsed form from the pipeline's `{}`. */
  const mountInput = (app: Hono): void => {
    class Users extends Controller {
      store(req: RequestSupport) {
        return { input: req.input() };
      }
    }
    app.post("/users", RequestKernel.handle({ method: "post", path: "/users", controller: [Users, "store"] }));
  };

  it.each(KINDS)("answers a mixed-case multipart body over 10 MiB with 413 on a %s route", async (_label, kind) => {
    quiet();
    const app = bootApp();
    mount(app, kind);
    const body = multipart(BODY_LIMIT_DEFAULTS.multipart);
    const init = sized({ method: "POST", headers: { "Content-Type": MIXED_CASE_MULTIPART }, body });
    await expect413(await app.request("/users", init));
  });

  it.each(KINDS)("answers a mixed-case urlencoded body over 1 MiB with 413 on a %s route", async (_label, kind) => {
    quiet();
    const app = bootApp();
    mount(app, kind);
    await expect413(await app.request("/users", sized(form(`name=${"a".repeat(MIB)}`, MIXED_CASE_FORM))));
  });

  it("leaves a mixed-case form body under the cap unparsed, as Hono's parseBody does", async () => {
    quiet();
    const app = bootApp();
    mountInput(app);
    const response = await app.request("/users", form("name=ada", MIXED_CASE_FORM));
    expect(response.status).toBe(201);
    // Hono 4.9.6's parseBody() matches the form media types case-sensitively: a handler gets no fields, and the
    // pipeline does not parse them either, so the limit and the parse stay separate classifiers
    expect(await response.json()).toEqual({ input: {} });
  });

  it("fails the contract validation of a mixed-case form body, which no layer parsed", async () => {
    quiet();
    const app = bootApp();
    mount(app, "Route.api");
    // The route's body schema needs `name`; the mixed-case body is `{}` to the pipeline, so it is a 422, not a 201
    expect((await app.request("/users", form("name=ada", MIXED_CASE_FORM))).status).toBe(422);
    // The lowercase spelling of the same body is parsed and passes
    expect((await app.request("/users", form("name=ada"))).status).toBe(201);
  });

  it("never gives a handler the bytes of a mixed-case over-cap body through c.req.formData()", async () => {
    quiet();
    const app = bootApp({ bodyLimit: { multipart: 2_048 } });
    let fields: FormData | undefined;
    let failure: unknown;
    /** A 0.5 request class exposes the Hono reader the security probe used after the pipeline. */
    class FormDataRequest extends RequestSupport {
      readFormData(): Promise<FormData> {
        return this.requestCtx.formData();
      }
    }
    class Users extends Controller {
      async store(req: FormDataRequest) {
        try {
          fields = await req.readFormData();
        } catch (error) {
          failure = error;
        }
        return { ok: true };
      }
    }
    app.post(
      "/users",
      RequestKernel.handle({ method: "post", path: "/users", controller: [Users, "store"], request: FormDataRequest }),
    );
    // No Content-Length: the pipeline does not read a mixed-case form body, so the handler's formData() is the reader
    // and the counting stream is what must stop it
    const text = new TextEncoder().encode(multipart(4_096));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < text.length; at += 512) controller.enqueue(text.slice(at, at + 512));
        controller.close();
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "Content-Type": MIXED_CASE_MULTIPART },
      body,
      duplex: "half",
    };
    const response = await app.request("/users", init);
    expect(response.status).toBe(201);
    // The parse never resolves with the body, and what stopped it is the default limit's own 413
    expect(fields).toBeUndefined();
    expect(isPayloadTooLarge(failure)).toBe(true);
  });
});

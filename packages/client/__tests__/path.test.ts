import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createPathClient } from "@laratype/client";
import type { ClientOptions, FetchLike } from "@laratype/client";
import type { ApiTypes } from "@laratype/contract";
import type { AppApi } from "./fixtures/.laratype/api/index.gen";

type Api = ApiTypes<AppApi>;

/** The five methods of a path client with their types erased: a runtime-only path that no API endpoint has. */
type Loose = Record<"get" | "post" | "put" | "patch" | "delete", (path: string, input?: object) => Promise<unknown>>;

/** A fake fetch that records each request and answers with `body` as JSON. */
const fakeFetch = (body: unknown = {}, status = 200) => {
  const calls: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
    signal: AbortSignal | undefined;
  }> = [];
  const fetch = vi.fn<FetchLike>(async (input: string | Request, init?: RequestInit) => {
    const request = typeof input === "string" ? undefined : input;
    calls.push({
      url: request ? request.url : (input as string),
      method: request ? request.method : init!.method!,
      headers: Object.fromEntries(new Headers(request ? request.headers : init!.headers).entries()),
      body: request ? (request.body ? await request.text() : undefined) : init!.body,
      signal: request ? request.signal : (init!.signal ?? undefined),
    });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return { fetch, calls };
};

describe("createPathClient", () => {
  it("has one frozen, null-prototype call per HTTP method", () => {
    const api = createPathClient<Api>();
    expect(Object.keys(api)).toEqual(["get", "post", "put", "patch", "delete"]);
    expect(Object.getPrototypeOf(api)).toBeNull();
    expect(Object.isFrozen(api)).toBe(true);
  });

  it("sends the full path as given, with encoded params, the query, the body and the method", async () => {
    const { fetch, calls } = fakeFetch();
    const api = createPathClient<Api>({ fetch });
    await api.get("/api/users/:user", { params: { user: "a b/c" } });
    await api.get("/api/users/:user/posts", { params: { user: 1 }, query: { q: "x&y", tags: ["a", "b"] } });
    await api.patch("/api/users/:user/posts/:post", { params: { user: 1, post: 2 }, body: { title: "Hi" } });
    await api.get("/api/users", { query: { page: 2 } });
    expect(calls.map((c) => c.url)).toEqual([
      "/api/users/a%20b%2Fc",
      "/api/users/1/posts?q=x%26y&tags=a&tags=b",
      "/api/users/1/posts/2",
      "/api/users?page=2",
    ]);
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "PATCH", "GET"]);
    expect(calls[2]!.body).toBe('{"title":"Hi"}');
  });

  it("dispatches every method: get, post, put, patch and delete", async () => {
    const { fetch, calls } = fakeFetch();
    const api = createPathClient<Api>({ fetch }) as unknown as Loose;
    for (const method of ["get", "post", "put", "patch", "delete"] as const) await api[method]("/api/users");
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  });

  it("merges options.headers, the call headers and the JSON content-type as the named style does", async () => {
    const { fetch, calls } = fakeFetch();
    const api = createPathClient<Api>({ fetch, headers: { authorization: "Bearer t", "x-tenant": "default" } });
    await api.post("/api/users", { body: { name: "Ada", email: "ada@example.com" }, headers: { "x-tenant": "t1" } });
    await api.get("/api/users");
    expect(calls[0]!.body).toBe('{"name":"Ada","email":"ada@example.com"}');
    expect(calls[0]!.headers).toEqual({
      authorization: "Bearer t",
      "content-type": "application/json",
      "x-tenant": "t1",
    });
    expect(calls[1]!.body).toBeUndefined();
    expect(calls[1]!.headers).toEqual({ authorization: "Bearer t", "x-tenant": "default" });
  });

  it("joins the full path to baseUrl and checks baseUrl as createClient does", async () => {
    const { fetch, calls } = fakeFetch();
    await createPathClient<Api>({ fetch, baseUrl: "https://example.com/" }).get("/api/users");
    expect(calls[0]!.url).toBe("https://example.com/api/users");
    expect(() => createPathClient<Api>({ baseUrl: "localhost:3000/api" })).toThrow(
      new TypeError(
        '[@laratype/client] createClient: baseUrl "localhost:3000/api" must be an absolute URL (https://…) or a path starting with /',
      ),
    );
  });

  it("reads options at each call and runs onRequest and onResponse", async () => {
    const first = fakeFetch();
    const second = fakeFetch();
    const seen: string[] = [];
    const options: ClientOptions = {
      fetch: first.fetch,
      onRequest: (r) => void seen.push(`> ${r.url}`),
      onResponse: (r) => void seen.push(`< ${r.status}`),
    };
    const api = createPathClient<Api>(options);
    await api.get("/api/users");
    options.fetch = second.fetch;
    await api.get("/api/users");
    expect(seen).toEqual(["> /api/users", "< 200", "> /api/users", "< 200"]);
    expect(first.fetch).toHaveBeenCalledTimes(1);
    expect(second.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a path that would leave the page origin under a same-origin baseUrl", async () => {
    const { fetch } = fakeFetch();
    const api = createPathClient<Api>({ fetch }) as unknown as Loose;
    await expect(api.get("\t/evil.com/x")).rejects.toThrow(
      new TypeError('[@laratype/client] route path "\t/evil.com/x" would leave the page\'s origin: "/\t/evil.com/x"'),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends redirect: "manual" by default, like the named style', async () => {
    const modes: Array<RequestRedirect | undefined> = [];
    const fetch = vi.fn<FetchLike>(async (_input, init) => {
      modes.push(init.redirect);
      return new Response(null, { status: 302, headers: { location: "/login" } });
    });
    const result = await createPathClient<Api>({ fetch }).get("/api/users");
    await createPathClient<Api>({ fetch, redirect: "follow" }).get("/api/users");
    expect(modes).toEqual(["manual", "follow"]);
    expect(result).toMatchObject({ ok: false, unexpected: true, status: 302 });
    expect(result.response!.headers.get("location")).toBe("/login");
  });

  it("takes any 2xx status as the success when its body is JSON, since the route contract is not available at runtime", async () => {
    // users.store declares 201; a 200 is still the success of this type-only client, and its JSON body is the data
    const fetch = vi.fn<FetchLike>(async () => Response.json({ id: 7, title: "T" }, { status: 200 }));
    const result = await createPathClient<Api>({ fetch }).post("/api/users", { body: { name: "A", email: "a@b.c" } });
    expect(result).toMatchObject({ ok: true, status: 200, data: { id: 7, title: "T" } });
  });

  it("a 204 is a success with no data, and a non-JSON 2xx is unexpected", async () => {
    const noContent = vi.fn<FetchLike>(async () => new Response(null, { status: 204 }));
    expect(await createPathClient<Api>({ fetch: noContent }).get("/api/users")).toMatchObject({
      ok: true,
      status: 204,
      data: undefined,
    });
    const notJson = vi.fn<FetchLike>(async () => new Response("<html>ok</html>", { status: 200 }));
    expect(await createPathClient<Api>({ fetch: notJson }).get("/api/users")).toMatchObject({
      ok: false,
      unexpected: true,
      status: 200,
      text: "<html>ok</html>",
    });
  });

  it("a code on an endpoint that declares no errors is outside the type, as the known gap says", async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ code: "BOOM", message: "x" }), { status: 500 }));
    const result = await createPathClient<Api>({ fetch }).get("/api/v1/health");
    // the runtime trusts the path; ClientResult<health> has no failure branch, so `code` is typed undefined
    expect(result).toMatchObject({ ok: false, status: 500, code: "BOOM", error: { message: "x" } });
    expect(result.unexpected).toBeUndefined();
  });

  it("returns a 4xx/5xx JSON body with a code as an error even when the code is not declared", async () => {
    // the path names the endpoint, so the code is trusted; the types only know the declared ones
    const fetch = vi.fn<FetchLike>(async () => Response.json({ code: "TEAPOT", message: "x" }, { status: 418 }));
    const result = await createPathClient<Api>({ fetch }).get("/api/users");
    expect(result).toMatchObject({ ok: false, status: 418, code: "TEAPOT", error: { message: "x" } });
    expect(result).not.toHaveProperty("unexpected");
  });

  it("a non-JSON 500 is unexpected with its text", async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response("<html>oops</html>", { status: 500 }));
    const result = await createPathClient<Api>({ fetch }).get("/api/users");
    expect(result).toMatchObject({ ok: false, unexpected: true, status: 500, text: "<html>oops</html>" });
    if (!result.ok) expect(result.error).toBeInstanceOf(SyntaxError);
  });
});

/** The type text of a path that matches no endpoint, a method it does not have, an ambiguous path and a wide path. */
describe("path diagnostics", () => {
  it("names the method and the path that matched nothing, the ambiguity and the literal rule", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\\/g, "/");
    const virtual = `${root}packages/client/__tests__/fixtures/path/errors.ts`;
    const source = [
      "import type { ApiTypes } from '@laratype/contract'",
      "import { createPathClient } from '@laratype/client'",
      "import type { AppApi } from '../.laratype/api/index.gen'",
      "type E1 = {",
      "  method: 'get'; path: '/api/dup'; params: {}; query: undefined; body: undefined; headers: undefined;",
      "  response: string; status: 200; errors: never",
      "}",
      "type Dup = { a: { x: E1 }; b: { y: Omit<E1, 'response'> & { response: number } } }",
      "type Rec = Record<string, E1>",
      "type Pattern = { a: { x: Omit<E1, 'path'> & { path: `/api/users/${string}` } } }",
      "const api = createPathClient<ApiTypes<AppApi>>()",
      "const dup = createPathClient<Dup>()",
      "const rec = createPathClient<Rec>()",
      "const pattern = createPathClient<Pattern>()",
      "const wide: string = '/api/users'",
      "void api.get('/api/nope')",
      "void api.post('/api/users/:user', { params: { user: 1 } })",
      "void dup.get('/api/dup')",
      "void rec.get('/api/dup')",
      "void pattern.get('/api/users/archive')",
      "void api.post(wide, { body: { name: 'A', email: 'a' }, headers: { 'x-tenant': 't' } })",
      "void api.delete('/api/users')",
    ].join("\n");
    const { config } = ts.readConfigFile(`${root}tsconfig.app.json`, ts.sys.readFile);
    const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root);
    const compilerOptions: ts.CompilerOptions = {
      ...options,
      noEmit: true,
      composite: false,
      declaration: false,
      incremental: false,
    };
    const host = ts.createCompilerHost(compilerOptions);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
      fileName.replace(/\\/g, "/") === virtual
        ? ts.createSourceFile(fileName, source, languageVersion, true)
        : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    const program = ts.createProgram([virtual], compilerOptions, host);
    const text = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n")
      // tsc escapes the quotes of the template literal type in its message
      .replaceAll('\\"', '"');
    expect(text).toContain('[@laratype/client] createPathClient: no GET endpoint at path "/api/nope"');
    expect(text).toContain('[@laratype/client] createPathClient: no POST endpoint at path "/api/users/:user"');
    expect(text).toContain(
      '[@laratype/client] createPathClient: more than one endpoint answers GET at path "/api/dup"',
    );
    expect(text).toContain("[@laratype/client] createPathClient: the path must be a literal");
    expect(text).toContain('[@laratype/client] createPathClient: no DELETE endpoint at path "/api/users"');
    expect(text).toContain("[@laratype/client] createPathClient: the API type must declare literal keys");
    expect(text).toContain(
      "[@laratype/client] createPathClient: the API declares a GET path that is not a single literal",
    );
  }, 60_000);
});

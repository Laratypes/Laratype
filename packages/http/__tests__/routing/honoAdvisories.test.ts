// B33 #438: the Hono advisories fixed in 4.13.23, pinned where the framework relies on them.
// GHSA-mhwf: on Bun, a request without a usable `Host` header (an HTTP/1.0 request, or an empty `Host`) reaches the
// fetch handler with a path-only URL; `getPath()` must keep its first segment so the router sees the path a proxy
// checked. Node and the other runtimes always build an absolute URL, so the request is shaped here by hand.
// GHSA-586x: TrieRouter must group a constrained param's alternation, or `/items/:kind{public|draft}` matches
// `/items/publicXYZ`.
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { TrieRouter } from "hono/router/trie-router";
import type { H, RouterRoute } from "hono/types";
import { getPath } from "hono/utils/url";

/**
 * A request as Bun hands one to the fetch handler when the `Host` header is missing or empty: `url` is the request
 * target, with no scheme and host. `Request` refuses to construct one on Node ("Invalid URL"), even on Bun, so the
 * test builds an absolute request and overrides `url`, which is the only property `getPath()` reads.
 */
const requestWithoutHost = (target: string): Request => {
  const request = new Request(`http://localhost${target}`);
  Object.defineProperty(request, "url", { value: target });
  return request;
};

describe("getPath (GHSA-mhwf)", () => {
  it("keeps the first path segment of a request whose URL has no scheme and host", () => {
    expect(getPath(requestWithoutHost("/admin/secret"))).toBe("/admin/secret");
  });

  it("routes such a request by the path it carries", async () => {
    const app = new Hono();
    app.get("/admin/secret", (c) => c.text("admin"));
    app.get("/secret", (c) => c.text("secret"));
    const response = await app.fetch(requestWithoutHost("/admin/secret"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("admin");
  });
});

describe("TrieRouter constrained param alternation (GHSA-586x)", () => {
  const app = new Hono({ router: new TrieRouter<[H, RouterRoute]>() });
  app.get("/items/:kind{public|draft}", (c) => c.json({ kind: c.req.param("kind") }));

  it("matches each alternative whole", async () => {
    expect(await (await app.request("/items/public")).json()).toEqual({ kind: "public" });
    expect(await (await app.request("/items/draft")).json()).toEqual({ kind: "draft" });
  });

  it("does not match a path that only starts or ends with an alternative", async () => {
    // Before the fix the anchors wrapped the alternation (`^public|draft$`), so both paths reached the handler
    expect((await app.request("/items/publicXYZ")).status).toBe(404);
    expect((await app.request("/items/XYZdraft")).status).toBe(404);
  });
});

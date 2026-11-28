// Runtime tests for createQueryApi (CL5 #141): keys, query and mutation functions, typed errors, diagnostics.
import { describe, expect, it } from "vitest";
import { createClient } from "@laratype/client";
import {
  CLIENT_QUERY_ERROR,
  ClientQueryApiError,
  ClientQueryError,
  createQueryApi,
  isClientQueryError,
} from "@laratype/client-query";
import { appApi } from "./fixtures/api";
import { failingFetch, fakeFetch } from "./support/fetch";

const User = { id: 1, name: "Ada", email: "ada@example.com" };

/** One context as TanStack hands it to a `queryFn`; only `queryKey` and `signal` are read. */
const context = (queryKey: readonly unknown[], signal?: AbortSignal) => ({
  queryKey,
  signal: signal ?? new AbortController().signal,
});

/** The error a rejected promise carries, so a test can assert on its type and message. */
const rejection = async (pending: Promise<unknown>): Promise<unknown> => {
  try {
    await pending;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
};

describe("createQueryApi", () => {
  const api = createClient(appApi, { fetch: fakeFetch(User).fetch });

  it("mirrors the client tree, frozen, with a key prefix on every node", () => {
    const q = createQueryApi(api);
    expect(Object.keys(q)).toEqual(["users", "health", "queryKey"]);
    expect(Object.keys(q.users)).toEqual(["index", "show", "store", "posts", "queryKey"]);
    expect(Object.keys(q.users.posts)).toEqual(["index", "update", "remove", "queryKey"]);
    expect(Object.keys(q.users.show)).toEqual(["queryKey", "queryOptions", "mutationOptions"]);
    expect(Object.isFrozen(q)).toBe(true);
    expect(Object.isFrozen(q.users.posts)).toBe(true);
    expect(Object.isFrozen(q.users.show)).toBe(true);
    expect(q.queryKey).toEqual(["laratype"]);
    expect(q.users.queryKey).toEqual(["laratype", "users"]);
    expect(q.users.posts.queryKey).toEqual(["laratype", "users", "posts"]);
    expect(Object.isFrozen(q.users.queryKey)).toBe(true);
  });

  it("builds an endpoint key from its name segments and its input", () => {
    const q = createQueryApi(api);
    expect(q.users.show.queryKey({ params: { user: 1 } })).toEqual([
      "laratype",
      "users",
      "show",
      { params: { user: 1 } },
    ]);
    expect(q.users.index.queryKey({ query: { page: 2 } })).toEqual([
      "laratype",
      "users",
      "index",
      { query: { page: 2 } },
    ]);
    expect(q.users.posts.update.queryKey({ params: { user: 1, post: 2 }, body: { title: "Hi" } })).toEqual([
      "laratype",
      "users",
      "posts",
      "update",
      { params: { user: 1, post: 2 }, body: { title: "Hi" } },
    ]);
  });

  it("leaves out what a key cannot hold: the signal, undefined entries and an empty input", () => {
    const q = createQueryApi(api);
    const signal = new AbortController().signal;
    const key = q.users.show.queryKey({ params: { user: 1 } });
    // the same query with an abort signal is the same cache entry
    expect(q.users.show.queryKey({ params: { user: 1 }, signal })).toEqual(key);
    expect(q.health.check.queryKey()).toEqual(["laratype", "health", "check"]);
    expect(q.health.check.queryKey({})).toEqual(["laratype", "health", "check"]);
    expect(q.users.index.queryKey({ query: undefined })).toEqual(q.users.index.queryKey());
  });

  it("has node keys that prefix the keys below them, so invalidation matches a folder", () => {
    const q = createQueryApi(api);
    const key = q.users.posts.update.queryKey({ params: { user: 1, post: 2 }, body: { title: "Hi" } });
    expect(key.slice(0, q.users.posts.queryKey.length)).toEqual([...q.users.posts.queryKey]);
    expect(q.queryKey).toEqual(["laratype"]);
  });

  it("resolves a query's data through the endpoint call", async () => {
    const { fetch, calls } = fakeFetch(User);
    const q = createQueryApi(createClient(appApi, { fetch }));
    const options = q.users.show.queryOptions({ params: { user: 1 } });
    await expect(options.queryFn(context(options.queryKey))).resolves.toEqual(User);
    expect(calls[0]!.url).toBe("/api/users/1");
    expect(calls[0]!.method).toBe("GET");
  });

  it("forwards TanStack's abort signal, and keeps the call's own signal", async () => {
    const { fetch, calls } = fakeFetch(User);
    const q = createQueryApi(createClient(appApi, { fetch }));
    const controller = new AbortController();
    await q.users.show.queryOptions({ params: { user: 1 } }).queryFn(context([], controller.signal));
    const own = new AbortController();
    await q.users.show.queryOptions({ params: { user: 1 }, signal: own.signal }).queryFn(context([], new AbortController().signal));
    expect(calls[0]!.signal).toBe(controller.signal);
    expect(calls[1]!.signal).toBe(own.signal);
  });

  it("holds the input in the key, so a refetch after the caller mutates it sends the key's input", async () => {
    const { fetch, calls } = fakeFetch([]);
    const q = createQueryApi(createClient(appApi, { fetch }));
    const input = { query: { page: 2 } };
    const options = q.users.index.queryOptions(input);
    // A Vue `reactive` filter changes in place after the options were built: the key must not follow it.
    input.query.page = 3;
    await options.queryFn(context(options.queryKey));
    input.query.page = 4;
    await options.queryFn(context(options.queryKey));
    expect(calls.map((call) => call.url)).toEqual(["/api/users?page=2", "/api/users?page=2"]);
    expect(options.queryKey).toEqual(["laratype", "users", "index", { query: { page: 2 } }]);
  });

  it("throws a ClientQueryError carrying a declared failure", async () => {
    const body = { code: "EMAIL_TAKEN", message: "The email is taken.", email: "ada@example.com" };
    const { fetch } = fakeFetch(body, 409);
    const q = createQueryApi(createClient(appApi, { fetch }));
    const error = await rejection(q.users.store.mutationOptions().mutationFn({ body: { name: "Ada", email: body.email } }));
    expect(error).toBeInstanceOf(ClientQueryError);
    expect(isClientQueryError(error)).toBe(true);
    const typed = error as ClientQueryError;
    expect(typed.name).toBe("ClientQueryError");
    expect(typed.status).toBe(409);
    expect(typed.code).toBe("EMAIL_TAKEN");
    expect(typed.message).toBe('[@laratype/client-query] "users.store" failed with code "EMAIL_TAKEN" (status 409)');
    expect(typed.result.ok).toBe(false);
    expect(typed.result.code).toBe("EMAIL_TAKEN");
    expect(typed.result.error).toEqual({ message: "The email is taken.", email: body.email });
    expect(typed.cause).toEqual(typed.result.error);
    expect(typed[CLIENT_QUERY_ERROR]).toBe(true);
  });

  it("throws an unexpected result as an error with status 0 on a network failure", async () => {
    const failure = new TypeError("fetch failed");
    const q = createQueryApi(createClient(appApi, { fetch: failingFetch(failure) }));
    const options = q.users.show.queryOptions({ params: { user: 1 } });
    const error = (await rejection(options.queryFn(context(options.queryKey)))) as ClientQueryError;
    expect(error.status).toBe(0);
    expect(error.code).toBeUndefined();
    expect(error.message).toBe('[@laratype/client-query] "users.show" failed unexpectedly (status 0)');
    expect(error.result.unexpected).toBe(true);
    expect(error.result.response).toBeUndefined();
    expect(error.cause).toBe(failure);
  });

  it("throws an undeclared status or code as an unexpected result", async () => {
    const { fetch } = fakeFetch({ message: "Server Error" }, 500);
    const q = createQueryApi(createClient(appApi, { fetch }));
    const options = q.users.show.queryOptions({ params: { user: 1 } });
    const error = (await rejection(options.queryFn(context(options.queryKey)))) as ClientQueryError;
    expect(error.status).toBe(500);
    expect(error.code).toBeUndefined();
    expect(error.result.unexpected).toBe(true);
    expect(error.result.response?.status).toBe(500);
  });

  it("lets a rejected call (a programming error) reject as it is, not as a ClientQueryError", async () => {
    const { fetch } = fakeFetch(User);
    const q = createQueryApi(createClient(appApi, { fetch }));
    // a missing required param is a type error; at runtime the client rejects before fetch
    const options = q.users.show.queryOptions({} as never);
    const error = await rejection(options.queryFn(context(options.queryKey)));
    expect(error).not.toBeInstanceOf(ClientQueryError);
    expect((error as Error).message).toBe('[@laratype/contract] buildUrl: missing param "user" for "/api/users/:user"');
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves a mutation's data, and undefined for an endpoint without a response schema", async () => {
    const created = fakeFetch(User, 201);
    const q = createQueryApi(createClient(appApi, { fetch: created.fetch }));
    const createdUser = await q.users.store.mutationOptions().mutationFn({
      body: { name: "Ada", email: "ada@example.com" },
    });
    expect(createdUser).toEqual(User);
    expect(created.calls[0]!.method).toBe("POST");

    const removed = fakeFetch(undefined, 204);
    const posts = createQueryApi(createClient(appApi, { fetch: removed.fetch }));
    await expect(posts.users.posts.remove.mutationOptions().mutationFn({ params: { user: 1, post: 2 } })).resolves.toBeUndefined();
    expect(removed.calls[0]!.url).toBe("/api/users/1/posts/2");
    expect(removed.calls[0]!.method).toBe("DELETE");
  });

  it("rejects a value that is not a client", () => {
    expect(() => createQueryApi(null as never)).toThrow(ClientQueryApiError);
    expect(() => createQueryApi(null as never)).toThrow(
      "[@laratype/client-query] createQueryApi: expected the client from createClient",
    );
    expect(() => createQueryApi([] as never)).toThrow(
      "[@laratype/client-query] createQueryApi: expected the client from createClient",
    );
  });

  it("rejects a leaf that is not an endpoint", () => {
    expect(() => createQueryApi({ users: 1 } as never)).toThrow(
      '[@laratype/client-query] createQueryApi: "users" is not an endpoint or a node: expected the client from createClient',
    );
    expect(() => createQueryApi({ users: { show: 1 } } as never)).toThrow(
      '[@laratype/client-query] createQueryApi: "users.show" is not an endpoint or a node: expected the client from createClient',
    );
  });

  it("rejects a route named queryKey, which a node key would hide", () => {
    expect(() => createQueryApi({ queryKey: async () => ({}) } as never)).toThrow(
      '[@laratype/client-query] createQueryApi: "queryKey" is named "queryKey", which a node query key uses',
    );
    expect(() => createQueryApi({ users: { queryKey: async () => ({}) } } as never)).toThrow(
      '[@laratype/client-query] createQueryApi: "users.queryKey" is named "queryKey", which a node query key uses',
    );
  });

  it("names the API misuse error", () => {
    const error = new ClientQueryApiError("misuse");
    expect(error.name).toBe("ClientQueryApiError");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("misuse");
  });

  it("recognizes a ClientQueryError by its brand, not by instanceof", () => {
    const result = { ok: false as const, unexpected: true as const, status: 0, error: "x", response: undefined };
    expect(isClientQueryError(new ClientQueryError("users.show", result))).toBe(true);
    expect(isClientQueryError(new Error("plain"))).toBe(false);
    expect(isClientQueryError(undefined)).toBe(false);
    expect(isClientQueryError({ name: "ClientQueryError" })).toBe(false);
  });
});

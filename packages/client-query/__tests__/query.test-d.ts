// Type tests for createQueryApi (CL5 #141): keys, query data and error types, mutation variables, and the
// inference of @tanstack/vue-query and @tanstack/react-query from the options the adapter returns.
import { describe, expectTypeOf, test } from "vitest";
import { useMutation as useReactMutation, useQuery as useReactQuery } from "@tanstack/react-query";
import { useMutation as useVueMutation, useQuery as useVueQuery } from "@tanstack/vue-query";
import { createClient } from "@laratype/client";
import type { ClientOf, HeaderValues } from "@laratype/client";
import { createQueryApi, isClientQueryError } from "@laratype/client-query";
import type {
  AnyEndpointCall,
  ClientMutationOptions,
  ClientQueryContext,
  ClientQueryError,
  ClientQueryOptions,
  ClientShape,
  QueryEndpoint,
  QueryKey,
  QueryKeyOf,
  QueryTree,
} from "@laratype/client-query";
import { appApi } from "./fixtures/api";
import type { AppApi } from "./fixtures/api";

const typeOnly = (_fn: () => void) => {};

const api = createClient(appApi);
const q = createQueryApi(api);

type User = { id: number; name: string; email: string };
type ShowInput = Parameters<typeof api.users.show>[0];
type ShowKey = QueryKeyOf<typeof api.users.show, readonly ["users", "show"]>;
type ShowFailure = Exclude<Awaited<ReturnType<typeof api.users.show>>, { ok: true }>;
type StoreInput = Parameters<typeof api.users.store>[0];
type StoreFailure = Exclude<Awaited<ReturnType<typeof api.users.store>>, { ok: true }>;
declare const failure: ClientQueryError<StoreFailure>;

describe("createQueryApi", () => {
  test("the exported types describe the client's calls", () => {
    expectTypeOf<QueryKey>().toEqualTypeOf<readonly unknown[]>();
    expectTypeOf<typeof api.users.show>().toMatchTypeOf<AnyEndpointCall>();
    expectTypeOf<ClientShape<{ show: typeof api.users.show }>>().toEqualTypeOf<{ readonly show: AnyEndpointCall }>();
    expectTypeOf<ClientQueryContext<ShowKey>>().toEqualTypeOf<{
      readonly queryKey: ShowKey;
      readonly signal: AbortSignal;
      readonly meta?: unknown;
    }>();
    expectTypeOf<QueryEndpoint<typeof api.users.show, readonly ["users", "show"]>>().toHaveProperty("mutationOptions");
  });

  test("mirrors the client tree, with the client's call types", () => {
    expectTypeOf(q).toEqualTypeOf<QueryTree<ClientOf<AppApi>>>();
    expectTypeOf(q.users.posts).toHaveProperty("update");
    // @ts-expect-error unknown endpoint
    void q.users.nope;
  });

  test("keys: the name segments, then the call input without signal", () => {
    expectTypeOf(q.queryKey).toEqualTypeOf<readonly ["laratype"]>();
    expectTypeOf(q.users.posts.queryKey).toEqualTypeOf<readonly ["laratype", "users", "posts"]>();
    expectTypeOf(q.users.show.queryKey({ params: { user: 1 } })).toEqualTypeOf<ShowKey>();
    expectTypeOf<ShowKey>().toEqualTypeOf<
      readonly ["laratype", "users", "show", { params: { user: string | number }; headers?: HeaderValues }]
    >();
    // an optional input stays optional in the key, and may be given
    expectTypeOf(q.health.check.queryKey()).toEqualTypeOf<
      readonly ["laratype", "health", "check", { headers?: HeaderValues }?]
    >();
    expectTypeOf(q.users.posts.update.queryKey({ params: { user: 1, post: 2 }, body: { title: "Hi" } })).toEqualTypeOf<
      readonly [
        "laratype",
        "users",
        "posts",
        "update",
        { params: { user: string | number; post: string | number }; body: { title: string }; headers?: HeaderValues },
      ]
    >();
  });

  test("rejects a key input the call does not accept", () => {
    typeOnly(() => {
      // @ts-expect-error a required param cannot be omitted
      q.users.show.queryKey({ params: {} });
      // @ts-expect-error an unknown input key
      q.users.show.queryOptions({ params: { user: 1 }, nope: true });
    });
  });

  test("query options: the success data and the typed error", () => {
    const options = q.users.show.queryOptions({ params: { user: 1 } });
    expectTypeOf(options).toEqualTypeOf<ClientQueryOptions<User, ClientQueryError<ShowFailure> | Error, ShowKey>>();
    expectTypeOf(options.queryFn).returns.toEqualTypeOf<Promise<User>>();
    expectTypeOf(q.users.index.queryOptions({ query: { page: 2 } }).queryFn).returns.toEqualTypeOf<Promise<User[]>>();
  });

  test("useQuery of both frameworks infers data and error from the options", () => {
    typeOnly(() => {
      const react = useReactQuery(q.users.show.queryOptions({ params: { user: 1 } }));
      expectTypeOf(react.data).toEqualTypeOf<User | undefined>();
      expectTypeOf(react.error).toEqualTypeOf<ClientQueryError<ShowFailure> | Error | null>();

      const vue = useVueQuery(q.users.show.queryOptions({ params: { user: 1 } }));
      expectTypeOf(vue.data.value).toEqualTypeOf<User | undefined>();
      expectTypeOf(vue.error.value).toEqualTypeOf<ClientQueryError<ShowFailure> | Error | null>();
    });
  });

  test("mutation options: the call input as variables, and the typed error", () => {
    const store = q.users.store.mutationOptions();
    expectTypeOf(store).toEqualTypeOf<ClientMutationOptions<User, ClientQueryError<StoreFailure> | Error, StoreInput>>();
    expectTypeOf(store.mutationFn).parameter(0).toEqualTypeOf<StoreInput>();
    expectTypeOf(store.mutationFn).returns.toEqualTypeOf<Promise<User>>();
    expectTypeOf(q.users.store.mutationOptions).parameters.toEqualTypeOf<[]>();
    // an endpoint whose input is all optional takes `mutate()` with no argument ...
    expectTypeOf(q.health.check.mutationOptions().mutationFn).parameter(0).toEqualTypeOf<
      Parameters<typeof api.health.check>[0] | void
    >();
    // ... and still accepts it
    expectTypeOf(q.health.check.mutationOptions().mutationFn).toBeCallableWith({ headers: { "x-test": "1" } });
  });

  test("useMutation of both frameworks infers data, variables and error", () => {
    typeOnly(() => {
      const react = useReactMutation(q.users.store.mutationOptions());
      expectTypeOf(react.data).toEqualTypeOf<User | undefined>();
      expectTypeOf(react.error).toEqualTypeOf<ClientQueryError<StoreFailure> | Error | null>();
      react.mutate({ body: { name: "Ada", email: "ada@example.com" } });
      // @ts-expect-error a required body cannot be omitted
      react.mutate({});

      const vue = useVueMutation(q.users.store.mutationOptions());
      expectTypeOf(vue.data.value).toEqualTypeOf<User | undefined>();
      expectTypeOf(vue.error.value).toEqualTypeOf<ClientQueryError<StoreFailure> | Error | null>();
      vue.mutate({ body: { name: "Ada", email: "ada@example.com" } });

      // an endpoint whose input is all optional takes `mutate()` with no argument in both frameworks
      const check = useReactMutation(q.health.check.mutationOptions());
      check.mutate();
      const checkVue = useVueMutation(q.health.check.mutationOptions());
      checkVue.mutate();
    });
  });

  test("the error channel is a ClientQueryError or a plain Error, so the result needs a guard", () => {
    typeOnly(() => {
      const { error } = useReactQuery(q.users.show.queryOptions({ params: { user: 1 } }));
      // @ts-expect-error a call that rejects (a programming error) throws a plain Error: narrow before reading result
      void error?.result;
      if (isClientQueryError(error)) {
        expectTypeOf(error.result.status).toEqualTypeOf<number>();
        void error.result.code;
      }
    });
  });

  test("a ClientQueryError narrows through its result, like a failed call", () => {
    typeOnly(() => {
      expectTypeOf(failure.status).toEqualTypeOf<number>();
      if (failure.result.code === "EMAIL_TAKEN") {
        expectTypeOf(failure.result.status).toEqualTypeOf<409>();
        expectTypeOf(failure.result.error).toEqualTypeOf<{ message: string; email: string }>();
      }
      if (failure.result.code === undefined) {
        expectTypeOf(failure.result.unexpected).toEqualTypeOf<true>();
        expectTypeOf(failure.result.response).toEqualTypeOf<Response | undefined>();
      }
    });
  });

  test("an endpoint without a response schema gets a type-level diagnostic, not undefined query data", () => {
    const diagnostic = q.users.posts.remove.queryOptions({ params: { user: 1, post: 2 } });
    expectTypeOf(diagnostic.error).toEqualTypeOf<
      "queryOptions: the endpoint has no response schema, so its data is undefined"
    >();
    // @ts-expect-error the diagnostic carries no queryKey
    void diagnostic.queryKey;
    // a mutation works for the same endpoint
    expectTypeOf(q.users.posts.remove.mutationOptions().mutationFn).returns.toEqualTypeOf<Promise<undefined>>();
  });

  test("only a client builds a query tree", () => {
    typeOnly(() => {
      // @ts-expect-error a number is not an endpoint or a node
      createQueryApi({ users: 1 });
      // @ts-expect-error an endpoint call is not a client node
      createQueryApi(api.users.show);
    });
  });
});

// docs/v1/client.md: the TanStack Query adapter (CL5 #141). In an app, `appApi` comes from `$api`.
// The options are framework-agnostic: they go to `useQuery`/`useMutation` of @tanstack/vue-query or
// @tanstack/react-query unchanged, which is what the Vue and React tests in packages/client-query check.
import { expectTypeOf } from "vitest";
import { createClient } from "@laratype/client";
import type { HeaderValues } from "@laratype/client";
import { ClientQueryError, createQueryApi } from "@laratype/client-query";
import { appApi } from "../../contract/proposed/contracts";

const api = createClient(appApi, { baseUrl: "https://example.com" });
const q = createQueryApi(api);

export function queryKeys() {
  // A node key is the prefix of everything below it: use it to invalidate a folder.
  expectTypeOf(q.users.queryKey).toEqualTypeOf<readonly ["laratype", "users"]>();
  expectTypeOf(q.users.posts.queryKey).toEqualTypeOf<readonly ["laratype", "users", "posts"]>();
  // An endpoint key is its name segments, then the call input without signal.
  const key = q.users.show.queryKey({ params: { user: 1 } });
  expectTypeOf(key).toEqualTypeOf<
    readonly ["laratype", "users", "show", { params: { user: string | number }; headers?: HeaderValues }]
  >();
  return key;
}

export function useUser(user: number) {
  // `useQuery(q.users.show.queryOptions({ params: { user } }))`, in Vue or React
  const options = q.users.show.queryOptions({ params: { user } });
  expectTypeOf(options.queryFn).returns.toEqualTypeOf<Promise<{ id: number; name: string; email: string }>>();
  return options;
}

export function useCreateUser() {
  // `useMutation(q.users.store.mutationOptions())`, in Vue or React; mutate takes the call input
  const options = q.users.store.mutationOptions();
  expectTypeOf(options.mutationFn).parameter(0).toEqualTypeOf<{
    body: { name: string; email: string };
    headers?: HeaderValues;
    signal?: AbortSignal;
  }>();
  return options;
}

export async function createUser(name: string, email: string) {
  try {
    // 201, the created user
    return await q.users.store.mutationOptions().mutationFn({ body: { name, email } });
  } catch (error) {
    // the failure keeps its result: narrow by code, as a failed call
    if (error instanceof ClientQueryError && error.result.code === "EMAIL_TAKEN") return error.result.error.email;
    throw error;
  }
}

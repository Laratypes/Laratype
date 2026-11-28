// One Vue component that renders query data and one that runs a mutation, through @tanstack/vue-query (CL5 #141).
// The adapter is framework-agnostic: `q.users.show.queryOptions(...)` is all Vue needs, and React uses the same.
// @vitest-environment happy-dom
// biome-ignore-all lint/correctness/useHookAtTopLevel: Vue's setup() is a component body; the rule models React's rules of hooks.
import { describe, expect, it, vi } from "vitest";
import { createApp, h, onMounted, type Component } from "vue";
import { QueryClient, VueQueryPlugin, useMutation, useQuery } from "@tanstack/vue-query";
import { createClient } from "@laratype/client";
import { createQueryApi } from "@laratype/client-query";
import { appApi } from "./fixtures/api";
import { fakeFetch } from "./support/fetch";

const User = { id: 1, name: "Ada", email: "ada@example.com" };

/** Mounts a component with the plugin and a retry-free client; returns the element and the app. */
const mount = (component: Component, queryClient: QueryClient) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const app = createApp(component);
  app.use(VueQueryPlugin, { queryClient });
  app.mount(el);
  return { el, app };
};

const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("createQueryApi in Vue", () => {
  it("renders the query data a component reads", async () => {
    const { fetch, calls } = fakeFetch(User);
    const q = createQueryApi(createClient(appApi, { fetch }));
    const UserName = {
      setup() {
        const user = useQuery(q.users.show.queryOptions({ params: { user: 1 } }));
        return () => h("div", user.isPending.value ? "loading" : user.data.value?.name);
      },
    };

    const { el, app } = mount(UserName, queryClient());
    await vi.waitFor(() => expect(el.textContent).toBe("Ada"));
    expect(calls[0]!.url).toBe("/api/users/1");
    app.unmount();
  });

  it("runs a mutation and renders its data", async () => {
    const { fetch, calls } = fakeFetch(User, 201);
    const q = createQueryApi(createClient(appApi, { fetch }));
    const StoreUser = {
      setup() {
        const created = useMutation(q.users.store.mutationOptions());
        onMounted(() => created.mutate({ body: { name: "Ada", email: "ada@example.com" } }));
        return () => h("div", created.data.value?.name ?? "pending");
      },
    };

    const { el, app } = mount(StoreUser, queryClient());
    await vi.waitFor(() => expect(el.textContent).toBe("Ada"));
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toBe('{"name":"Ada","email":"ada@example.com"}');
    app.unmount();
  });

  it("renders the error of a failed query", async () => {
    const { fetch } = fakeFetch({ code: "UNAUTHORIZED", message: "Sign in." }, 401);
    const q = createQueryApi(createClient(appApi, { fetch }));
    const UserName = {
      setup() {
        const user = useQuery(q.users.show.queryOptions({ params: { user: 1 } }));
        return () => h("div", user.isError.value ? user.error.value?.code : "pending");
      },
    };

    const { el, app } = mount(UserName, queryClient());
    // the typed error reaches the component: `UNAUTHORIZED` is declared by the contract's auth
    await vi.waitFor(() => expect(el.textContent).toBe("UNAUTHORIZED"));
    app.unmount();
  });
});

// One React component that renders query data and one that runs a mutation, through @tanstack/react-query (CL5 #141).
// The adapter is framework-agnostic: `q.users.show.queryOptions(...)` is all React needs, and Vue uses the same.
// @vitest-environment happy-dom
import { act, createElement, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createClient } from "@laratype/client";
import { createQueryApi } from "@laratype/client-query";
import { appApi } from "./fixtures/api";
import { fakeFetch } from "./support/fetch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const User = { id: 1, name: "Ada", email: "ada@example.com" };

const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Renders a component with a provider and a retry-free client; `waitForText` flushes React's effects while it polls. */
const render = async (child: ReactElement, client: QueryClient) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root: Root = createRoot(el);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, child));
  });
  // every wait runs inside act, so the query's state updates are flushed while a test polls
  const waitForText = async (text: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (el.textContent === text) return;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    expect(el.textContent).toBe(text);
  };
  return { el, root, waitForText };
};

describe("createQueryApi in React", () => {
  it("renders the query data a component reads", async () => {
    const { fetch, calls } = fakeFetch(User);
    const q = createQueryApi(createClient(appApi, { fetch }));
    function UserName() {
      const user = useQuery(q.users.show.queryOptions({ params: { user: 1 } }));
      return createElement("div", null, user.isPending ? "loading" : user.data?.name);
    }

    const { root, waitForText } = await render(createElement(UserName), queryClient());
    await waitForText("Ada");
    expect(calls[0]!.url).toBe("/api/users/1");
    await act(async () => root.unmount());
  });

  it("runs a mutation and renders its data", async () => {
    const { fetch, calls } = fakeFetch(User, 201);
    const q = createQueryApi(createClient(appApi, { fetch }));
    function StoreUser() {
      const created = useMutation(q.users.store.mutationOptions());
      useEffect(() => {
        created.mutate({ body: { name: "Ada", email: "ada@example.com" } });
      }, [created.mutate]);
      return createElement("div", null, created.data?.name ?? "pending");
    }

    const { root, waitForText } = await render(createElement(StoreUser), queryClient());
    await waitForText("Ada");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toBe('{"name":"Ada","email":"ada@example.com"}');
    await act(async () => root.unmount());
  });

  it("renders the error of a failed query", async () => {
    const { fetch } = fakeFetch({ code: "UNAUTHORIZED", message: "Sign in." }, 401);
    const q = createQueryApi(createClient(appApi, { fetch }));
    function UserName() {
      const user = useQuery(q.users.show.queryOptions({ params: { user: 1 } }));
      return createElement("div", null, user.isError ? String(user.error.code) : "pending");
    }

    const { root, waitForText } = await render(createElement(UserName), queryClient());
    // the typed error reaches the component: `UNAUTHORIZED` is declared by the contract's auth
    await waitForText("UNAUTHORIZED");
    await act(async () => root.unmount());
  });
});

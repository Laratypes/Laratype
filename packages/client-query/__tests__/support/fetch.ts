// Test support: fake fetches that record what the client sends, shaped as `FetchLike` takes them.
import { vi } from "vitest";
import type { FetchLike } from "@laratype/client";

/** One call the client made, as the fake fetch saw it. */
export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal | undefined;
}

/** A `fetch` that answers `body` as JSON with `status` (no body for 204 and 205), and records each request. */
export const fakeFetch = (body: unknown = {}, status = 200) => {
  const calls: RecordedRequest[] = [];
  const fetch = vi.fn<FetchLike>(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      signal: init.signal ?? undefined,
    });
    return status === 204 || status === 205
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return { fetch, calls };
};

/** A `fetch` that rejects with `error`, as a network failure or an abort does. */
export const failingFetch = (error: unknown) => vi.fn<FetchLike>(async () => Promise.reject(error));

import type { ClientOptions, HttpMethod } from "./types";

type Input = { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal };

/** The only runtime every client option shares: path interpolation, query, JSON, result union. */
export async function request(
  opts: ClientOptions,
  method: HttpMethod,
  path: string,
  input: Input = {},
  declaredErrors?: readonly number[],
): Promise<any> {
  const url = new URL(
    path.replace(/:(\w+)\??/g, (_, k) => encodeURIComponent(String(input.params?.[k] ?? ""))).replace(/\/+$/, "") || "/",
    opts.baseUrl,
  );
  for (const [k, v] of Object.entries(input.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const res = await (opts.fetch ?? fetch)(url, {
    method: method.toUpperCase(),
    headers: { accept: "application/json", ...(input.body !== undefined && { "content-type": "application/json" }), ...opts.headers, ...input.headers },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal: input.signal,
  });
  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (res.ok) return { ok: true, status: res.status, data };
  return declaredErrors && !declaredErrors.includes(res.status)
    ? { ok: false, status: res.status, error: data, unexpected: true }
    : { ok: false, status: res.status, error: data };
}

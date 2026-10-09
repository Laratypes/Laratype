// Option (c): name-style calls driven by a generated slim manifest (method + path + declared error codes),
// typed by an API type that is either `ApiTypes<AppApi>` (monorepo, import type) or a generated interface.
import { request } from "./request";
import type { ApiShape, CallArgs, CallResult, ClientOptions, HttpMethod } from "./types";

export type Manifest<A extends ApiShape> = {
  readonly [C in keyof A]: { readonly [K in keyof A[C]]: readonly [method: A[C][K]["method"], path: A[C][K]["path"], errors?: readonly number[]] };
};
export type ManifestClient<A extends ApiShape> = {
  [C in keyof A]: { [K in keyof A[C]]: (...args: CallArgs<A[C][K]>) => Promise<CallResult<A[C][K]>> };
};

export function createManifestClient<A extends ApiShape>(manifest: Manifest<A>, opts: ClientOptions): ManifestClient<A> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [c, eps] of Object.entries(manifest as Record<string, Record<string, readonly [HttpMethod, string, (readonly number[])?]>>)) {
    out[c] = {};
    for (const [k, [m, p, errs]] of Object.entries(eps)) out[c][k] = (input?: any) => request(opts, m, p, input, errs);
  }
  return out as ManifestClient<A>;
}

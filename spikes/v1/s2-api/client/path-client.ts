// Option (b): path-style calls, type-only. `api.get('/users/:user', { params })`.
// The API type comes from `import type` (monorepo) or a generated .d.ts (separate repo): zero contract runtime.
import { request } from "./request";
import type { ApiShape, CallArgs, CallResult, ClientOptions, EndpointShape, HttpMethod } from "./types";

type AllEndpoints<A extends ApiShape> = { [C in keyof A]: A[C][keyof A[C]] }[keyof A];
type ByMethod<A extends ApiShape, M extends HttpMethod> = Extract<AllEndpoints<A>, { method: M }>;
type At<A extends ApiShape, M extends HttpMethod, P> = Extract<ByMethod<A, M>, { path: P }>;

type Caller<A extends ApiShape, M extends HttpMethod> = <P extends ByMethod<A, M>["path"]>(
  path: P,
  ...args: CallArgs<At<A, M, P>>
) => Promise<CallResult<At<A, M, P>>>;

export type PathClient<A extends ApiShape> = { [M in HttpMethod]: Caller<A, M> };

export function createPathClient<A extends ApiShape>(opts: ClientOptions): PathClient<A> {
  const call = (m: HttpMethod) => (path: string, input?: any) => request(opts, m, path, input);
  return { get: call("get"), post: call("post"), put: call("put"), patch: call("patch"), delete: call("delete") } as PathClient<A>;
}

export type { EndpointShape };

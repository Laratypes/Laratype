import { ClientQueryApiError, ClientQueryError } from "./error";
import type { AnyEndpointCall, ClientQueryContext, ClientShape, QueryKey, QueryTree } from "./types";

const fail = (message: string): never => {
  throw new ClientQueryApiError(`[@laratype/client-query] ${message}`);
};

/**
 * A deep copy of the plain objects and arrays a call input holds, taken when its key is built. The key describes one
 * request, so a later mutation of the caller's input (a Vue `reactive` filter, say) must not change the key or the
 * request it stands for. A `Date` is copied; any other leaf (an `AbortSignal`, a `Headers`-like value) is kept.
 */
const snapshot = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(snapshot);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime());
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, snapshot(entry)]));
};

/** A call input deep-copied once, so `queryOptions` can hold it for both the key and the request. */
const snapshotInput = (input: unknown): unknown => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, snapshot(value)]));
};

/**
 * The input as a key holds it: no `signal` (not serializable) and no `undefined` entry, so `queryKey()`,
 * `queryKey({})` and `queryKey({ query: undefined })` are the same key.
 */
const keyInput = (input: unknown): Record<string, unknown> | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const entries = Object.entries(input).filter(([key, value]) => key !== "signal" && value !== undefined);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
};

/** The call input plus TanStack's `AbortSignal`, unless the input already carries a signal of its own. */
const withSignal = (input: unknown, signal: AbortSignal | undefined): unknown => {
  if (signal === undefined) return input;
  if (typeof input !== "object" || input === null) return { signal };
  const own = (input as { readonly signal?: AbortSignal }).signal;
  return own === undefined ? { ...input, signal } : input;
};

/**
 * One endpoint of the query tree, frozen. `queryOptions` and `mutationOptions` run the endpoint: a success resolves
 * the data, and a failed result throws `ClientQueryError` with that result; a call that rejects (a programming error:
 * a missing param, a body JSON cannot carry) rejects as it is. The endpoint keeps the object prototype, so
 * `String(endpoint)` works; only the nodes need the null one, which keeps a `__proto__` route harmless.
 */
const buildEndpoint = (call: AnyEndpointCall, segments: readonly string[], name: string): object => {
  const keyOfSnapshot = (input: unknown): QueryKey => {
    const extra = keyInput(input);
    return Object.freeze(extra === undefined ? ["laratype", ...segments] : ["laratype", ...segments, extra]);
  };
  const keyOf = (...input: unknown[]): QueryKey => keyOfSnapshot(snapshotInput(input[0]));
  const run = async (input: unknown, signal?: AbortSignal): Promise<unknown> => {
    const result = await call(withSignal(input, signal));
    if (result.ok) return result.data;
    throw new ClientQueryError(name, result);
  };
  return Object.freeze({
    queryKey: keyOf,
    queryOptions: (...input: unknown[]) => {
      // One snapshot for both, so the key and the request always describe the same input.
      const held = snapshotInput(input[0]);
      return {
        queryKey: keyOfSnapshot(held),
        queryFn: (context: ClientQueryContext) => run(held, context.signal),
      };
    },
    mutationOptions: () => ({
      mutationFn: (input: unknown) => run(input),
    }),
  });
};

/**
 * One node of the query tree (or its root): its children, and the `queryKey` prefix of everything below it. A route
 * named `queryKey` would be hidden by the node's own key, so it is refused.
 */
const buildNode = (node: object, segments: readonly string[], name: string): object => {
  const out: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(node)) {
    const full = name === "" ? key : `${name}.${key}`;
    if (key === "queryKey") fail(`createQueryApi: "${full}" is named "queryKey", which a node query key uses`);
    if (typeof value === "function") {
      out[key] = buildEndpoint(value as AnyEndpointCall, [...segments, key], full);
    } else if (typeof value === "object" && value !== null) {
      out[key] = buildNode(value, [...segments, key], full);
    } else {
      fail(`createQueryApi: "${full}" is not an endpoint or a node: expected the client from createClient`);
    }
  }
  out.queryKey = Object.freeze(["laratype", ...segments]);
  return Object.freeze(out);
};

/**
 * A value `createQueryApi` refuses at the type level: one endpoint call, not a client node or its root. It keeps
 * the check in a parameter, like `CheckApi` does, so the error names the fix.
 */
type CheckClient<C> = C extends AnyEndpointCall
  ? { readonly error: "createQueryApi: expected the client from createClient" }
  : unknown;

/**
 * The query tree of a client: every endpoint gets its key, query options and mutation options, and every node the
 * key prefix of its endpoints. Build it once and share it. Keys are relative to the client root, so a node client
 * (`createClient(appApi.users)`) gets local names.
 *
 * @example
 * const api = createClient(appApi)
 * const q = createQueryApi(api)
 * const users = useQuery(q.users.index.queryOptions({ query: { page: 2 } }))
 * const store = useMutation(q.users.store.mutationOptions())
 */
export function createQueryApi<C extends ClientShape<C>>(client: C & CheckClient<C>): QueryTree<C> {
  if (typeof client !== "object" || client === null || Array.isArray(client)) {
    fail("createQueryApi: expected the client from createClient");
  }
  return buildNode(client as object, [], "") as QueryTree<C>;
}

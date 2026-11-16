import type { ClientQueryError } from "./error";

/** A query key: `['laratype', ...name segments]` for a node or the root, and one input element for an endpoint. */
export type QueryKey = readonly unknown[];

/** One endpoint call of a client (`createClient`): what `createQueryApi` maps onto query and mutation options. */
export type AnyEndpointCall = (...input: any[]) => Promise<any>;

/**
 * The shape of a client tree: every leaf is an endpoint call, every other value a node.
 * It is a self-constraint (`C extends ClientShape<C>`), like `ApiShape`: a `ClientOf<AppApi>` matches it, and a
 * non-client (a number, an object with a non-function leaf) does not.
 */
export type ClientShape<C> = {
  readonly [K in keyof C]: C[K] extends AnyEndpointCall
    ? AnyEndpointCall
    : C[K] extends object
      ? ClientShape<C[K]>
      : never;
};

/** One call as the client returns it: `ClientResult<E>`, inferred from the endpoint call. */
type CallResult<F extends AnyEndpointCall> = Awaited<ReturnType<F>>;

/** The data of a successful call: the wire type of the response schema, `undefined` without one. */
type CallData<F extends AnyEndpointCall> = Extract<CallResult<F>, { ok: true }>["data"];

/** A failed call: its declared errors and the unexpected variant. */
type CallFailure<F extends AnyEndpointCall> = Exclude<CallResult<F>, { ok: true }>;

/** The input element of a query key: the call input without `signal`, which a key cannot hold. */
type KeyInput<Input> = Input extends undefined ? undefined : Omit<Input, "signal">;

/** The input element of an endpoint's key: required when the call input is, optional when the call may omit it. */
type InputElement<F extends AnyEndpointCall> = Parameters<F>["length"] extends 0
  ? []
  : undefined extends Parameters<F>[0]
    ? [input?: KeyInput<Parameters<F>[0]>]
    : [input: KeyInput<Parameters<F>[0]>];

/** The key of one endpoint: `['laratype', ...name segments]`, then its input when the call has one. */
export type QueryKeyOf<F extends AnyEndpointCall, Segments extends readonly string[]> = readonly [
  "laratype",
  ...Segments,
  ...InputElement<F>,
];

/** The variables of a mutation: the call input, or `void` for a call that takes none. */
type VariablesOf<F extends AnyEndpointCall> = Parameters<F>["length"] extends 0 ? void : Parameters<F>[0];

/** The context TanStack passes to a `queryFn`: the key, an `AbortSignal` and the query's `meta`. */
export interface ClientQueryContext<Key extends QueryKey = QueryKey> {
  readonly queryKey: Key;
  readonly signal: AbortSignal;
  readonly meta?: unknown;
}

/**
 * What `queryOptions(input)` returns, for `useQuery` of `@tanstack/vue-query` and `@tanstack/react-query`.
 * The shape is structural, so the package imports no `@tanstack/query-core`: an app keeps its own copy.
 */
export interface ClientQueryOptions<Data, Error, Key extends QueryKey = QueryKey> {
  readonly queryKey: Key;
  readonly queryFn: (context: ClientQueryContext<Key>) => Promise<Data>;
  /**
   * Declared only to type the error channel: TanStack infers `TError` from the retry positions, and `queryKey` and
   * `queryFn` carry no error type. The runtime sets no `retry`, so the `QueryClient`'s default applies.
   */
  readonly retry?: boolean | number | ((failureCount: number, error: Error) => boolean);
}

/**
 * What `mutationOptions()` returns, for `useMutation` of both frameworks. `Variables` is the endpoint's call input,
 * so `mutate` takes it; it is `undefined` for a call that omits its input, so `mutate()` takes no argument.
 */
export interface ClientMutationOptions<Data, Error, Variables> {
  readonly mutationFn: (variables: Variables) => Promise<Data>;
  /**
   * Declared only to type the error and variable channels: TanStack infers `TError` and `TVariables` from these
   * positions. The runtime sets no `onError`, so the callbacks of the `useMutation` call apply.
   */
  readonly onError?: (error: Error, variables: Variables, context: unknown) => unknown;
}

/**
 * The `queryOptions` of one endpoint. An endpoint without a response schema has no query data, which TanStack
 * refuses at runtime, so its `queryOptions` is this type-level diagnostic instead.
 */
type QueryOptionsOf<F extends AnyEndpointCall, Segments extends readonly string[]> = [CallData<F>] extends [undefined]
  ? (...input: Parameters<F>) => {
      /** Use `mutationOptions()`, or give the endpoint a response schema. */
      readonly error: "queryOptions: the endpoint has no response schema, so its data is undefined";
    }
  : (...input: Parameters<F>) => ClientQueryOptions<CallData<F>, ClientQueryError<CallFailure<F>>, QueryKeyOf<F, Segments>>;

/** One endpoint of the query tree: a key factory, the query options and the mutation options. */
export interface QueryEndpoint<F extends AnyEndpointCall, Segments extends readonly string[]> {
  /** The endpoint's key: `['laratype', ...segments], then its input` (`QueryKeyOf`). */
  readonly queryKey: (...input: Parameters<F>) => QueryKeyOf<F, Segments>;
  /** `{ queryKey, queryFn }` for `useQuery`: resolves the success data, throws `ClientQueryError` on `ok: false`. */
  readonly queryOptions: QueryOptionsOf<F, Segments>;
  /** `{ mutationFn }` for `useMutation`: resolves the success data, throws `ClientQueryError` on `ok: false`. */
  readonly mutationOptions: () => ClientMutationOptions<CallData<F>, ClientQueryError<CallFailure<F>>, VariablesOf<F>>;
}

/**
 * The query tree of a client: each node mirrors the client's and holds the `queryKey` prefix of everything below
 * it, each endpoint its `queryKey`, `queryOptions` and `mutationOptions`. `Prefix` is the key prefix of the node
 * the type is built for.
 */
export type QueryTree<C, Prefix extends readonly string[] = []> = {
  readonly [K in keyof C]: C[K] extends AnyEndpointCall
    ? QueryEndpoint<C[K], readonly [...Prefix, K & string]>
    : QueryTree<C[K], readonly [...Prefix, K & string]>;
} & { readonly queryKey: readonly ["laratype", ...Prefix] };

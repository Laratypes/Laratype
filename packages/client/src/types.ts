import type { ApiTypes, EndpointShape, Prettify } from "@laratype/contract";

type NotJson = undefined | symbol | ((...args: any[]) => unknown);

/** An array item that JSON cannot hold becomes `null`, as `JSON.stringify` does. */
type JsonItem<T> = T extends NotJson ? null : Jsonify<T>;

/** A property JSON keeps: a string key whose value is not only `undefined`, functions or symbols. */
type JsonKey<T, K extends keyof T> = K extends symbol ? never : [Exclude<T[K], undefined>] extends [NotJson] ? never : K;

/**
 * An object's wire type. `JSON.stringify` drops a property whose value is `undefined`, so a property that may be
 * `undefined` (`x?: X` or `x: X | undefined`) is optional on the wire.
 */
type JsonObject<T> = Prettify<
  { -readonly [K in keyof T as undefined extends T[K] ? never : JsonKey<T, K>]: Jsonify<T[K]> } & {
    -readonly [K in keyof T as undefined extends T[K] ? JsonKey<T, K> : never]?: Jsonify<T[K]>;
  }
>;

/**
 * The wire type of a value after `JSON.stringify` + `JSON.parse` (#107, #110): `Date` → `string` (through `toJSON`),
 * `undefined` / functions / symbols are removed from unions and their properties dropped, a property that may be
 * `undefined` is optional, `bigint` → `never`, `Map` / `Set` → `{}`. Internal for now; CL2 (#110) types the result data with it.
 */
export type Jsonify<T> = unknown extends T
  ? T
  : T extends { toJSON(...args: any[]): infer J }
    ? Jsonify<J>
    : T extends string | number | boolean | null
      ? T
      : T extends NotJson | bigint
        ? never
        : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>
          ? {}
          : T extends readonly unknown[]
            ? { -readonly [K in keyof T]: JsonItem<T[K]> }
            : JsonObject<T>;

/** Headers a call can send; a `headers` schema types its keys on top. */
export type HeaderValues = Record<string, string>;

/** `{ [K]: T }`, optional when `T` accepts `{}` (all keys optional), and nothing when the endpoint has no such schema. */
type Part<K extends string, T> = [T] extends [undefined] ? {} : {} extends T ? { [_ in K]?: T } : { [_ in K]: T };

type ParamsPart<P> = [keyof P] extends [never] ? {} : Part<"params", { [K in keyof P]: string | number }>;

type HeadersPart<H> = [H] extends [undefined] ? { headers?: HeaderValues } : {} extends H ? { headers?: H & HeaderValues } : { headers: H & HeaderValues };

/** The argument of an endpoint call: path params, query, JSON body, headers and an `AbortSignal`. */
export type CallInput<E extends EndpointShape> = Prettify<
  ParamsPart<E["params"]> & Part<"query", E["query"]> & Part<"body", E["body"]> & HeadersPart<E["headers"]> & { signal?: AbortSignal }
>;

/** The parsed body of a successful response: the wire type of the response schema, `unknown` without one. */
export type ResponseData<E extends EndpointShape> = [E["response"]] extends [undefined] ? unknown : Jsonify<E["response"]>;

/** The fetch `Response`, with `json()` typed by the endpoint's response schema. Non-2xx responses resolve too. */
export interface ClientResponse<T> extends Response {
  json(): Promise<T>;
}

/** One endpoint call. The argument is optional when nothing in it is required. */
export type EndpointCall<E extends EndpointShape> = {} extends CallInput<E>
  ? (input?: CallInput<E>) => Promise<ClientResponse<ResponseData<E>>>
  : (input: CallInput<E>) => Promise<ClientResponse<ResponseData<E>>>;

/** The client for an API projection (`ApiTypes<AppApi>` or a generated `AppApi`): the same tree, with a call per endpoint. */
export type Client<T> = { readonly [K in keyof T]: T[K] extends EndpointShape ? EndpointCall<T[K]> : Client<T[K]> };

/** The client `createClient(api)` returns: `ClientOf<typeof appApi>`. */
export type ClientOf<A> = Client<ApiTypes<A>>;

/** One route of the generated `manifest` (`sauf types:generate`, api.ts): method, full path, error codes. */
export interface ManifestRoute {
  readonly method: string;
  readonly path: string;
  readonly errors?: readonly string[];
}

/** The generated `manifest`: route name (`"users.posts.update"`) → route. Typed by the generated `AppApi`. */
export type Manifest = Readonly<Record<string, ManifestRoute>>;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** Origin the contract paths are appended to. Default `""`: same origin, since contract paths are full (`/api/...`). */
  baseUrl?: string;
  /** The fetch to call. Default: the global `fetch`, read at call time. */
  fetch?: FetchLike;
  /** Headers sent with every call; a call's own `headers` override them. */
  headers?: HeadersInit;
}

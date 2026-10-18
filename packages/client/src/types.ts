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
 * `undefined` is optional, `bigint` → `never`, `Map` / `Set` → `{}`. Internal: it types the result `data` and `error`.
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

/**
 * The data of a successful response: the wire type of the response schema, and `undefined` for an endpoint with no
 * response schema or a declared body-less status (204, 205).
 */
export type ResponseData<E extends EndpointShape> = [E["response"]] extends [undefined]
  ? undefined
  : [E["status"]] extends [204 | 205]
    ? undefined
    : Jsonify<E["response"]>;

/**
 * The declared 2xx: `status` is the endpoint's declared status, and `data` its parsed JSON body (see `ResponseData`).
 * `response` has its body consumed; when `data` is `undefined` the client doesn't read it, and cancels it unless it is a 204 or 205.
 */
export interface ClientSuccess<E extends EndpointShape> {
  ok: true;
  status: E["status"];
  data: ResponseData<E>;
  response: Response;
  code?: undefined;
  unexpected?: undefined;
}

type Failure<Er> = Er extends { status: infer St; code: infer Code; body: infer Body }
  ? { ok: false; status: St; code: Code; error: Jsonify<Body>; response: Response; unexpected?: undefined }
  : never;

/**
 * One declared error of the endpoint: its derived errors (422, 404, 401, 403, 429) and its `throws` from every level.
 * `error` is the error body; narrow by `code`, since two errors can share a status.
 */
export type ClientFailure<E extends EndpointShape> = Failure<E["errors"]>;

/**
 * Anything the contract doesn't declare:
 * - a network failure or abort before the headers arrive: `status: 0`, no `response`, `error` is the thrown error;
 * - an error while the body is read (an abort or network error after the headers): the HTTP status, `response`, that error;
 * - a 2xx other than the declared status, or an empty body where a response schema is declared;
 * - a status or code the endpoint doesn't declare, or a body that isn't JSON.
 * `error` is the thrown error or the parsed body.
 */
export interface UnexpectedResult {
  ok: false;
  unexpected: true;
  status: number;
  error: unknown;
  response: Response | undefined;
  /** The raw body when it isn't JSON (`error` is then the `SyntaxError`), since the body is already consumed. */
  text?: string;
  code?: undefined;
}

/** What a call resolves to. Narrow by `ok`, then by `code` (or `unexpected`). */
export type ClientResult<E extends EndpointShape> = ClientSuccess<E> | ClientFailure<E> | UnexpectedResult;

/** One endpoint call. The argument is optional when nothing in it is required. */
export type EndpointCall<E extends EndpointShape> = {} extends CallInput<E>
  ? (input?: CallInput<E>) => Promise<ClientResult<E>>
  : (input: CallInput<E>) => Promise<ClientResult<E>>;

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

// Client-side types. Self-contained on purpose: no import from the contract lib or any schema lib,
// so a separate-repo FE can type-check against generated types alone (option c).

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface EndpointShape {
  method: HttpMethod;
  path: string;
  params: object;
  query: unknown;
  body: unknown;
  response: unknown;
  status: number;
  errors: { status: number; body: unknown };
}
export type ApiShape = { [contract: string]: { [endpoint: string]: EndpointShape } };

type Prettify<T> = { [K in keyof T]: T[K] } & {};
type OptionalIfEmpty<K extends string, V> = [V] extends [undefined] ? {} : {} extends V ? { [P in K]?: V } : { [P in K]: V };

export type CallInput<E extends EndpointShape> = Prettify<
  OptionalIfEmpty<"params", E["params"]> &
    OptionalIfEmpty<"query", E["query"]> &
    OptionalIfEmpty<"body", E["body"]> & { headers?: Record<string, string>; signal?: AbortSignal }
>;
/** input is optional when nothing in it is required */
export type CallArgs<E extends EndpointShape> = {} extends CallInput<E> ? [input?: CallInput<E>] : [input: CallInput<E>];

export type CallResult<E extends EndpointShape> =
  | { ok: true; status: E["status"]; data: E["response"] }
  | (E["errors"] extends infer Er extends { status: number; body: unknown } ? { ok: false; status: Er["status"]; error: Er["body"] } : never)
  | { ok: false; status: number; error: unknown; unexpected: true };

export interface ClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

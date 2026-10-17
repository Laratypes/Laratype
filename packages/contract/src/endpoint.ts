import { checkAuth, checkThrottle, checkThrows } from "./capabilities";
import type { AuthOption, ThrottleOptions } from "./capabilities";
import type { AnyErrorDef } from "./errors";
import type { PathParams } from "./path";
import type { StandardSchemaV1 } from "./standard-schema";

export type Method = "get" | "post" | "put" | "patch" | "delete";

/** Runtime description of an endpoint, consumed by the router, the client and OpenAPI. */
export interface EndpointDef {
  readonly method: Method;
  readonly path: string;
  readonly query?: StandardSchemaV1;
  readonly body?: StandardSchemaV1;
  readonly headers?: StandardSchemaV1;
  readonly response?: StandardSchemaV1;
  readonly status: number;
  /** Domain errors declared with `.throws()`, in call order. */
  readonly throws: readonly AnyErrorDef[];
  /** `false`: `.public()`. Unset: inherited from the contract or a scope. */
  readonly auth?: AuthOption | false;
  /** `false`: `.authorize(false)` skips every inherited check. */
  readonly authorize?: boolean;
  /** `false`: `.throttle(false)`. Unset: inherited. */
  readonly throttle?: ThrottleOptions | false;
}

type Schema = StandardSchemaV1 | undefined;

/** Type-level capability state of one endpoint. `undefined` means "inherit". */
export interface EndpointCaps {
  auth: AuthOption | false | undefined;
  authorize: boolean | undefined;
  throttle: boolean | undefined;
}

export type DefaultCaps = { auth: undefined; authorize: undefined; throttle: undefined };

/**
 * Brand of an endpoint. A `Symbol.for` key, like `API_NODE` and `CONTRACT`, so `isEndpoint` recognizes endpoints
 * from another bundle or package copy (ESM + CJS), where `instanceof Endpoint` fails. Non-enumerable.
 */
export const ENDPOINT: unique symbol = Symbol.for("laratype.endpoint");

// Copy before freezing: the constructor is public, so a caller's def and throws array stay mutable
const freeze = (def: EndpointDef): EndpointDef =>
  Object.freeze({ ...def, throws: Object.freeze([...def.throws]) });

/** Immutable builder: every method returns a new Endpoint and leaves `this` untouched. */
export class Endpoint<
  M extends Method = Method,
  P extends string = string,
  Q extends Schema = undefined,
  B extends Schema = undefined,
  H extends Schema = undefined,
  R extends Schema = undefined,
  St extends number = 200,
  E extends AnyErrorDef = never,
  C extends EndpointCaps = DefaultCaps,
> {
  /** phantom: type-level only, never set at runtime */
  declare readonly __types: {
    method: M;
    path: P;
    params: PathParams<P>;
    query: Q;
    body: B;
    headers: H;
    response: R;
    status: St;
    throws: E;
    caps: C;
  };

  readonly def: EndpointDef;

  constructor(def: EndpointDef) {
    this.def = freeze(def);
    Object.defineProperty(this, ENDPOINT, { value: true });
  }

  query<S extends StandardSchemaV1>(schema: S): Endpoint<M, P, S, B, H, R, St, E, C> {
    return new Endpoint({ ...this.def, query: schema });
  }

  body<S extends StandardSchemaV1>(schema: S): Endpoint<M, P, Q, S, H, R, St, E, C> {
    return new Endpoint({ ...this.def, body: schema });
  }

  headers<S extends StandardSchemaV1>(schema: S): Endpoint<M, P, Q, B, S, R, St, E, C> {
    return new Endpoint({ ...this.def, headers: schema });
  }

  // NoInfer: a contextual return type (e.g. AnyEndpoint) must not infer C, so the 200 default applies
  response<S extends StandardSchemaV1, Code extends number = 200>(schema: S, status?: Code): Endpoint<M, P, Q, B, H, S, NoInfer<Code>, E, C> {
    return new Endpoint({ ...this.def, response: schema, status: status ?? 200 });
  }

  /** Domain errors this endpoint may throw, added to the ones inherited from its contract and scopes. */
  throws<const Es extends readonly AnyErrorDef[]>(...errs: Es): Endpoint<M, P, Q, B, H, R, St, E | Es[number], C> {
    return new Endpoint({ ...this.def, throws: [...this.def.throws, ...checkThrows(errs, "throws()")] });
  }

  /** Requires a signed-in user for this endpoint: `true` is the default guard, a string a named guard. */
  auth<const A extends AuthOption = true>(guard?: A): Endpoint<M, P, Q, B, H, R, St, E, { auth: A; authorize: C["authorize"]; throttle: C["throttle"] }> {
    return new Endpoint({ ...this.def, auth: checkAuth(guard ?? true, "auth()") });
  }

  /** Opts out of an inherited `auth`: no guard runs and the 401 goes away. */
  public(): Endpoint<M, P, Q, B, H, R, St, E, { auth: false; authorize: C["authorize"]; throttle: C["throttle"] }> {
    return new Endpoint({ ...this.def, auth: false });
  }

  /** `.authorize()` adds a policy check (403); `.authorize(false)` skips every inherited one. */
  authorize<const F extends boolean = true>(enabled?: F): Endpoint<M, P, Q, B, H, R, St, E, { auth: C["auth"]; authorize: F; throttle: C["throttle"] }> {
    if (enabled !== undefined && typeof enabled !== "boolean") throw new TypeError("[@laratype/contract] authorize(): expected a boolean");
    return new Endpoint({ ...this.def, authorize: enabled ?? true });
  }

  /** `.throttle({ limit, per })` rate-limits this endpoint (429); `.throttle(false)` opts out of an inherited limit. */
  throttle<const T extends ThrottleOptions | false>(
    options: T,
  ): Endpoint<M, P, Q, B, H, R, St, E, { auth: C["auth"]; authorize: C["authorize"]; throttle: T extends false ? false : true }> {
    return new Endpoint({ ...this.def, throttle: options === false ? false : checkThrottle(options, "throttle()") });
  }
}

/** A new endpoint answers 204 (no content) until `.response(schema, status?)` gives it a body, 200 by default. */
const make = <M extends Method>(method: M) =>
  <P extends string>(path: P): Endpoint<M, P, undefined, undefined, undefined, undefined, 204> =>
    new Endpoint<M, P, undefined, undefined, undefined, undefined, 204>({ method, path, status: 204, throws: [] });

export const endpoint = {
  get: make("get"),
  post: make("post"),
  put: make("put"),
  patch: make("patch"),
  delete: make("delete"),
};

export type AnyEndpoint = Endpoint<any, any, any, any, any, any, any, any, any>;

/** Recognizes an endpoint by its brand, across bundles and package copies. */
export const isEndpoint = (value: unknown): value is AnyEndpoint =>
  typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[ENDPOINT] === true;

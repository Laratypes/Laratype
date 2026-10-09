import type { ErrorDef } from "./errors";
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
  readonly errors: readonly ErrorDef[];
}

type Schema = StandardSchemaV1 | undefined;

// Copy before freezing: the constructor is public, so a caller's def and errors array stay mutable
const freeze = (def: EndpointDef): EndpointDef =>
  Object.freeze({ ...def, errors: Object.freeze([...def.errors]) });

/** Immutable builder: every method returns a new Endpoint and leaves `this` untouched. */
export class Endpoint<
  M extends Method = Method,
  P extends string = string,
  Q extends Schema = undefined,
  B extends Schema = undefined,
  H extends Schema = undefined,
  R extends Schema = undefined,
  St extends number = 200,
  E extends ErrorDef = never,
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
    errors: E;
  };

  readonly def: EndpointDef;

  constructor(def: EndpointDef) {
    this.def = freeze(def);
  }

  query<S extends StandardSchemaV1>(schema: S): Endpoint<M, P, S, B, H, R, St, E> {
    return new Endpoint({ ...this.def, query: schema });
  }

  body<S extends StandardSchemaV1>(schema: S): Endpoint<M, P, Q, S, H, R, St, E> {
    return new Endpoint({ ...this.def, body: schema });
  }

  headers<S extends StandardSchemaV1>(schema: S): Endpoint<M, P, Q, B, S, R, St, E> {
    return new Endpoint({ ...this.def, headers: schema });
  }

  // NoInfer: a contextual return type (e.g. AnyEndpoint) must not infer C, so the 200 default applies
  response<S extends StandardSchemaV1, C extends number = 200>(schema: S, status?: C): Endpoint<M, P, Q, B, H, S, NoInfer<C>, E> {
    return new Endpoint({ ...this.def, response: schema, status: status ?? 200 });
  }

  errors<const Es extends readonly ErrorDef[]>(...errs: Es): Endpoint<M, P, Q, B, H, R, St, E | Es[number]> {
    return new Endpoint({ ...this.def, errors: [...this.def.errors, ...errs] });
  }
}

const make = <M extends Method>(method: M) =>
  <P extends string>(path: P): Endpoint<M, P> => new Endpoint<M, P>({ method, path, status: 200, errors: [] });

export const endpoint = {
  get: make("get"),
  post: make("post"),
  put: make("put"),
  patch: make("patch"),
  delete: make("delete"),
};

export type AnyEndpoint = Endpoint<any, any, any, any, any, any, any, any>;

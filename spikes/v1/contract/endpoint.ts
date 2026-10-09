import type { StandardSchemaV1 } from "./standard-schema";

export type Method = "get" | "post" | "put" | "patch" | "delete";

export interface ErrorDef<St extends number = number, Body = unknown> {
  readonly status: St;
  readonly code: string;
  /** phantom: only carries the body type */
  readonly __body?: Body;
}

export interface EndpointDef {
  readonly method: Method;
  readonly path: string;
  readonly query?: StandardSchemaV1;
  readonly body?: StandardSchemaV1;
  readonly response?: StandardSchemaV1;
  readonly status: number;
  readonly errors: readonly ErrorDef[];
}

type Schema = StandardSchemaV1 | undefined;

export class Endpoint<
  M extends Method = Method,
  P extends string = string,
  Q extends Schema = undefined,
  B extends Schema = undefined,
  R extends Schema = undefined,
  St extends number = 200,
  E extends ErrorDef = never,
> {
  declare readonly __types: { method: M; path: P; query: Q; body: B; response: R; status: St; errors: E };

  constructor(readonly def: EndpointDef) {}

  query<S extends StandardSchemaV1>(schema: S): Endpoint<M, P, S, B, R, St, E> {
    return new Endpoint({ ...this.def, query: schema });
  }

  body<S extends StandardSchemaV1>(schema: S): Endpoint<M, P, Q, S, R, St, E> {
    return new Endpoint({ ...this.def, body: schema });
  }

  response<S extends StandardSchemaV1, C extends number = 200>(schema: S, status?: C): Endpoint<M, P, Q, B, S, C, E> {
    return new Endpoint({ ...this.def, response: schema, status: status ?? 200 });
  }

  errors<const Es extends readonly ErrorDef[]>(...errs: Es): Endpoint<M, P, Q, B, R, St, E | Es[number]> {
    return new Endpoint({ ...this.def, errors: [...this.def.errors, ...errs] });
  }
}

const make = <M extends Method>(method: M) =>
  <P extends string>(path: P) => new Endpoint<M, P>({ method, path, status: 200, errors: [] });

export const endpoint = {
  get: make("get"),
  post: make("post"),
  put: make("put"),
  patch: make("patch"),
  delete: make("delete"),
};

export type AnyEndpoint = Endpoint<any, any, any, any, any, any, any>;

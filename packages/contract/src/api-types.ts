import type { EndpointContext, EndpointErrors, JoinPath, RootContext } from "./capabilities";
import type { NodeContext } from "./contract";
import type { AnyEndpoint } from "./endpoint";
import type { ErrorResponse } from "./errors";
import type { PathParams } from "./path";
import type { InferIn, InferOut } from "./standard-schema";

/**
 * Client-side view of one endpoint: plain types only, no schema types.
 * Inputs use the schema *input* (what the FE sends); the response uses the schema *output* (what the server serializes).
 * `Ctx` places the endpoint in its contract (URL prefix, scopes, contract options): the path is the full path,
 * the params include the folder params, and `errors` is the derived error union.
 * This is the shape the client consumes and `sauf types:generate` prints for separate-repo FEs (S2 option c).
 */
export type EndpointTypes<E extends AnyEndpoint, Ctx extends EndpointContext = RootContext> = {
  method: E["__types"]["method"];
  path: JoinPath<Ctx["path"], E["__types"]["path"]>;
  params: PathParams<JoinPath<Ctx["path"], E["__types"]["path"]>>;
  query: InferIn<E["__types"]["query"]>;
  body: InferIn<E["__types"]["body"]>;
  headers: InferIn<E["__types"]["headers"]>;
  response: InferOut<E["__types"]["response"]>;
  status: E["__types"]["status"];
  errors: ErrorResponse<EndpointErrors<E, Ctx>>;
};

/** `ApiTypes<typeof appApi>` → `{ users: { show: EndpointTypes<...>, posts: { ... } } }`: the schema-free projection of an API tree. */
export type ApiTypes<A> = {
  [K in keyof A & string]: A[K] extends AnyEndpoint ? EndpointTypes<A[K], NodeContext<A>> : ApiTypes<A[K]>;
};

/** Structural supertype of every `EndpointTypes<E>`, for code that consumes the projection (client, typegen output). */
export interface EndpointShape {
  method: string;
  path: string;
  params: object;
  query: unknown;
  body: unknown;
  headers: unknown;
  response: unknown;
  status: number;
  errors: { status: number; code: string; body: unknown };
}

/**
 * Constraint for API types, used as a self-constraint: `<A extends ApiShape<A>>`.
 * A mapped self-constraint accepts both `ApiTypes<typeof appApi>` and a generated `interface AppApi {...}`.
 * An index-signature constraint (`Record<string, Record<string, EndpointShape>>`) would reject interfaces,
 * since interfaces get no implicit index signature (found in S2): generated types would then have to be `type` aliases.
 * Nested groups (`users.posts`) recurse; a member with a `method` is an endpoint.
 */
export type ApiShape<A> = { [K in keyof A]: A[K] extends { method: string } ? EndpointShape : ApiShape<A[K]> };

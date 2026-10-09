import type { EndpointKeys } from "./contract";
import type { AnyEndpoint } from "./endpoint";
import type { ErrorResponse } from "./errors";
import type { InferIn, InferOut } from "./standard-schema";

/**
 * Client-side view of one endpoint: plain types only, no schema types.
 * Inputs use the schema *input* (what the FE sends); the response uses the schema *output* (what the server serializes).
 * This is the shape the client consumes and `sauf types:generate` prints for separate-repo FEs (S2 option c).
 */
export type EndpointTypes<E extends AnyEndpoint> = {
  method: E["__types"]["method"];
  path: E["__types"]["path"];
  params: E["__types"]["params"];
  query: InferIn<E["__types"]["query"]>;
  body: InferIn<E["__types"]["body"]>;
  headers: InferIn<E["__types"]["headers"]>;
  response: InferOut<E["__types"]["response"]>;
  status: E["__types"]["status"];
  errors: ErrorResponse<E["__types"]["errors"]>;
};

/** `ApiTypes<typeof appApi>` → `{ users: { show: EndpointTypes<...> } }`: the schema-free projection of a whole API. */
export type ApiTypes<A> = {
  [C in keyof A]: { [K in EndpointKeys<A[C]>]: A[C][K] extends AnyEndpoint ? EndpointTypes<A[C][K]> : never };
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
  errors: { status: number; body: unknown };
}

/**
 * Constraint for API types, used as a self-constraint: `<A extends ApiShape<A>>`.
 * A mapped self-constraint accepts both `ApiTypes<typeof appApi>` and a generated `interface AppApi {...}`.
 * An index-signature constraint (`Record<string, Record<string, EndpointShape>>`) would reject interfaces,
 * since interfaces get no implicit index signature (found in S2): generated types would then have to be `type` aliases.
 */
export type ApiShape<A> = { [C in keyof A]: { [K in keyof A[C]]: EndpointShape } };

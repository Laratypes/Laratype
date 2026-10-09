import type { AnyEndpoint, ErrorDef } from "./endpoint";
import type { EndpointKeys } from "./contract";
import type { InferIn, InferOut } from "./standard-schema";
import type { PathParams } from "./path";

type ErrorsOf<E> = E extends ErrorDef<infer S, infer B> ? { status: S; body: B } : never;

/**
 * Client-side view of one endpoint: plain types only, no schema types.
 * Inputs use the schema *input* (what the FE sends), the response uses the schema *output* (what the server serializes).
 * This is also the shape `sauf types:generate` prints for separate-repo FEs (S2 option c).
 */
export type EndpointTypes<E extends AnyEndpoint> = {
  method: E["__types"]["method"];
  path: E["__types"]["path"];
  params: PathParams<E["__types"]["path"]>;
  query: InferIn<E["__types"]["query"]>;
  body: InferIn<E["__types"]["body"]>;
  response: InferOut<E["__types"]["response"]>;
  status: E["__types"]["status"];
  errors: ErrorsOf<E["__types"]["errors"]>;
};

/** `ApiTypes<typeof appApi>`: { users: { show: EndpointTypes<...> } } */
export type ApiTypes<A> = {
  [C in keyof A]: { [K in EndpointKeys<A[C]>]: A[C][K] extends AnyEndpoint ? EndpointTypes<A[C][K]> : never };
};

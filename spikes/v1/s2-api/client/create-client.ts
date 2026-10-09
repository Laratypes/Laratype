// Option (a): createClient(appApi) — value import. Method/path come from the contract objects, and the
// schemas ship to the browser (usable for client-side form validation with the same schemas).
import type { AnyEndpoint, ApiTypes, Contract, StandardSchemaV1 } from "../../contract";
import { request } from "./request";
import type { CallArgs, CallResult, ClientOptions, EndpointShape } from "./types";

type Fn<E> = E extends EndpointShape ? (...args: CallArgs<E>) => Promise<CallResult<E>> : never;
export type Client<A> = { [C in keyof ApiTypes<A>]: { [K in keyof ApiTypes<A>[C]]: Fn<ApiTypes<A>[C][K]> } };

export function createClient<const A extends Record<string, Contract>>(api: A, opts: ClientOptions): Client<A> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [c, contract] of Object.entries(api)) {
    out[c] = {};
    for (const [k, e] of Object.entries(contract as Record<string, AnyEndpoint>)) {
      const codes = e.def.errors.map((x) => x.status);
      out[c][k] = (input?: any) => request(opts, e.def.method, e.def.path, input, codes);
    }
  }
  return out as Client<A>;
}

/** Client-side validation with the endpoint's own body schema (only possible with option a). */
export async function validateBody<E extends AnyEndpoint>(endpoint: E, value: unknown) {
  const schema = endpoint.def.body as StandardSchemaV1 | undefined;
  if (!schema) return { value };
  return schema["~standard"].validate(value);
}

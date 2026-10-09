import type { AnyEndpoint } from "./endpoint";

export const CONTRACT_NAME: unique symbol = Symbol.for("laratype.contract");

export type ContractDef = Record<string, AnyEndpoint>;
export type Contract<N extends string = string, D extends ContractDef = ContractDef> = D & { readonly [CONTRACT_NAME]: N };

export type EndpointKeys<C> = Exclude<keyof C, typeof CONTRACT_NAME> & string;

export const defineContract = <const N extends string, const D extends ContractDef>(name: N, endpoints: D): Contract<N, D> =>
  Object.assign(Object.create(null), endpoints, { [CONTRACT_NAME]: name });

/** FE-facing API: built from contracts only, never from routes/controllers */
export const defineApi = <const A extends Record<string, Contract>>(contracts: A): A => contracts;

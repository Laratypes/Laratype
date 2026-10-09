import type { AnyEndpoint, Contract, EndpointKeys, PathParams } from "../../contract";
import { CONTRACT_NAME } from "../../contract";
import type { Ctx, Result } from "./ctx";

// ---- middleware & binding (what the route *provides*) ----------------------

export interface Middleware<Ext extends object = {}> {
  /** phantom: the context keys this middleware adds */
  readonly __ext?: Ext;
  readonly handle: (ctx: Record<string, unknown>, next: (ext: Ext) => Promise<unknown>) => Promise<unknown>;
}
export const defineMiddleware = <Ext extends object = {}>(handle: Middleware<Ext>["handle"]): Middleware<Ext> => ({ handle });

type ModelClass = abstract new (...args: any) => any;
type Resolver = (value: string) => unknown;
export type Binder = ModelClass | Resolver;
/** A resolver returning `T | undefined` is a 404 on miss, so the handler sees `T`. */
type Bound<B> = B extends ModelClass ? InstanceType<B> : B extends Resolver ? NonNullable<Awaited<ReturnType<B>>> : never;

type ExtOf<M extends readonly Middleware<any>[]> = M extends readonly [Middleware<infer X>, ...infer R extends Middleware<any>[]]
  ? X & ExtOf<R>
  : {};

// ---- the check: controller declares requirements, route proves them ----------

type PathOf<E extends AnyEndpoint> = E["__types"]["path"];
type BoundParams<E extends AnyEndpoint, B> = { [K in keyof B & keyof PathParams<PathOf<E>>]: Bound<B[K]> };

/** The context the route actually builds for endpoint E. */
export type Provided<E extends AnyEndpoint, X extends object, B> = Ctx<E, X & { params: BoundParams<E, B> }>;

type RequiredKeys<O> = { [K in keyof O]-?: {} extends Pick<O, K> ? never : K }[keyof O];
type Missing<Pv, Rq> = Exclude<RequiredKeys<Rq>, keyof Pv> & string;
type Mismatched<Pv, Rq> = { [K in keyof Rq & keyof Pv]: [Pv[K]] extends [Rq[K]] ? never : K }[keyof Rq & keyof Pv] & string;
type Sub<O, K extends string> = K extends keyof O ? O[K] : {};
type Flat<O> = { [K in keyof O]: O[K] } & {};
type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/** Keys the handler needs that the route does not provide ("user", "params.user"). */
export type MissingKeys<Pv, Rq> = Missing<Pv, Rq> | `params.${Missing<Sub<Pv, "params">, Sub<Rq, "params">>}`;
/** Keys both sides have, with a provided type that does not satisfy the required one. */
export type MismatchedKeys<Pv, Rq> =
  | Exclude<Mismatched<Pv, Rq>, "params">
  | `params.${Mismatched<Sub<Pv, "params">, Sub<Rq, "params">>}`;
type At<O, P extends string> = P extends `params.${infer K}` ? Sub<Sub<O, "params">, K> : Sub<O, P>;

/*
 * Readable errors: the diagnosis lives in the PROPERTY NAMES of the error type, because tsc prints
 * "missing the following properties from type ...: <names>" in full, while property *types* get
 * truncated to `{ ...; }`. Details (provided vs required types) are in the property values.
 */
type RequirementIssues<N extends string, Pv, Rq> = {
  [M in MissingKeys<Pv, Rq> as `${N}: handler requires \`${M}\`, route does not provide it (add middleware / .bind())`]: {
    handler_requires: At<Rq, M>;
  };
} & {
  [M in MismatchedKeys<Pv, Rq> as M extends "endpoint"
    ? `${N}: handler ctx is typed for a different endpoint`
    : `${N}: \`${M}\` provided by the route does not match the handler (missing .bind()?)`]: {
    route_provides: At<Pv, M>;
    handler_requires: At<Rq, M>;
  };
};

export interface ReturnError<Expected, Got> {
  expected: Expected;
  got: Got;
}

/**
 * Conditional types, not function assignability: methods are compared bivariantly,
 * so `Ctrl extends { show(ctx: Provided): any }` would accept a handler that needs MORE than provided.
 * `[Provided] extends [Param]` is one-directional.
 */
export type HandlerIssues<N extends string, E extends AnyEndpoint, H, Pv> = H extends (ctx: infer Rq, ...rest: any[]) => infer R
  ? [Pv] extends [Rq]
    ? [Awaited<R>] extends [Result<E>]
      ? {}
      : { [_ in `${N}: return type does not match the response schema / declared errors`]: ReturnError<Result<E>, Awaited<R>> }
    : RequirementIssues<N, Pv, Rq>
  : { [_ in `${N}: controller has no handler for this endpoint`]: H };

type Name<C> = C extends { readonly [CONTRACT_NAME]: infer N extends string } ? N : "?";
type HandlerOf<I, K> = K extends keyof I ? I[K] : undefined;

export type ControllerIssues<C extends Contract, I, X extends object, B> = UnionToIntersection<
  { [K in EndpointKeys<C>]: HandlerIssues<`${Name<C>}.${K}`, C[K], HandlerOf<I, K>, Provided<C[K], X, B>> }[EndpointKeys<C>]
>;

type AllPathParams<C extends Contract> = { [K in EndpointKeys<C>]: keyof PathParams<PathOf<C[K]>> }[EndpointKeys<C>];
type BindIssues<C extends Contract, B> = {
  [K in Exclude<keyof B, AllPathParams<C>> & string as `.bind(): \`${K}\` is not a path param of any endpoint in ${Name<C>}`]: B[K];
};

/** `unknown` when the controller is valid (so `K & unknown = K`), otherwise an object whose keys are the diagnosis. */
export type VerifyController<C extends Contract, I, X extends object, B> =
  Flat<ControllerIssues<C, I, X, B> & BindIssues<C, B>> extends infer Errs ? (keyof Errs extends never ? unknown : Errs) : never;


// ---- route builder ----------------------------------------------------------

type ControllerClass = abstract new (...args: any) => any;

export interface RouteBuilder<X extends object = {}, B extends Record<string, Binder> = {}> {
  middleware<const M extends readonly Middleware<any>[]>(...m: M): RouteBuilder<X & ExtOf<M>, B>;
  bind<const NB extends Record<string, Binder>>(bindings: NB): RouteBuilder<X, B & NB>;
  /** Registers every endpoint of the contract. Compile error HERE if the controller is incomplete or under-provided. */
  contract<C extends Contract, K extends ControllerClass>(contract: C, controller: K & VerifyController<C, InstanceType<K>, X, B>): void;
}

export interface Registered {
  name: string;
  method: string;
  path: string;
  controller: ControllerClass;
  key: string;
  middleware: Middleware<any>[];
  bindings: Record<string, Binder>;
}

export function createRouter(
  registry: Registered[] = [],
  mw: Middleware<any>[] = [],
  bindings: Record<string, Binder> = {},
): RouteBuilder & { registry: Registered[] } {
  return {
    registry,
    middleware: (...m: readonly Middleware<any>[]) => createRouter(registry, [...mw, ...m], bindings) as any,
    bind: (b: Record<string, Binder>) => createRouter(registry, mw, { ...bindings, ...b }) as any,
    contract(contract: Contract, controller: ControllerClass) {
      for (const key of Object.keys(contract)) {
        const e = (contract as any)[key] as AnyEndpoint;
        registry.push({ name: `${contract[CONTRACT_NAME]}.${key}`, method: e.def.method, path: e.def.path, controller, key, middleware: mw, bindings });
      }
    },
  };
}

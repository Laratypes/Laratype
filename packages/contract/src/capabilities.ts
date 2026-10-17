import { errors } from "./errors";
import type { AnyErrorDef } from "./errors";
import type { AnyEndpoint, EndpointDef } from "./endpoint";
import type { PathParamKeys } from "./path";
import { fail } from "./internal";

// ---- options ----------------------------------------------------------------

/**
 * Guard names usable in `auth: '<guard>'`. Empty until the app augments it:
 * `declare module '@laratype/contract' { interface GuardRegistry { api: true } }`.
 */
export interface GuardRegistry {}

export type GuardName = keyof GuardRegistry & string;

/** `true` uses the default guard, a string a named guard. */
export type AuthOption = true | GuardName;

/** Seconds, or a number with a unit: `"30s"`, `"1m"`, `"1h"`, `"1d"`. */
export type Duration = number | `${number}${"s" | "m" | "h" | "d"}`;

export interface ThrottleOptions {
  readonly limit: number;
  readonly per: Duration;
}

/** Contract level of the capabilities: `defineContract(..., { auth, throws, throttle })`. */
export interface ContractOptions {
  readonly auth?: AuthOption;
  readonly throws?: readonly AnyErrorDef[];
  readonly throttle?: ThrottleOptions;
}

/** Folder scope level (`_scope.ts`): the contract options plus `authorize`. */
export interface ScopeOptions extends ContractOptions {
  readonly authorize?: boolean;
}

// ---- scopes and prefixes ----------------------------------------------------

/** Brand of a folder scope. Non-enumerable; `Symbol.for`, so two copies of the package agree on it. */
export const SCOPE: unique symbol = Symbol.for("laratype.scope");

/** A folder scope (`_scope.ts`): its options, frozen, plus the brand. */
export type Scope<O extends ScopeOptions = ScopeOptions> = Readonly<O> & { readonly [SCOPE]: true };

export type AnyScope = Scope<ScopeOptions>;

/**
 * Type-only folder context of a contract or a scope, exported as `Prefix` / `ScopePrefix` by the generated
 * `$types.d.ts`: the folder URL (its `[x]` folders as `:x` params) and the `_scope.ts` chain, outer to inner.
 * Never a runtime value.
 */
export interface ContractPrefix<Path extends string = "", Scopes extends readonly AnyScope[] = []> {
  /** phantom */
  readonly __prefix: { path: Path; scopes: Scopes };
}

export type AnyPrefix = ContractPrefix<string, readonly AnyScope[]>;

export type PrefixPath<P extends AnyPrefix> = P["__prefix"]["path"];
export type PrefixScopes<P extends AnyPrefix> = P["__prefix"]["scopes"];

// ---- inheritance (types) ----------------------------------------------------

/**
 * Where an endpoint sits: the URL prefix its path is appended to, the scope chain (outer to inner)
 * and its contract's options. The inherited capabilities and derived errors are computed from it.
 */
export interface EndpointContext {
  readonly path: string;
  readonly scopes: readonly AnyScope[];
  readonly options: ContractOptions;
}

export type RootContext = { path: ""; scopes: []; options: {} };

/** `"/api/users"` + `"/:user"`; an endpoint path of `"/"` (or `""`) is the prefix itself. */
export type JoinPath<A extends string, B extends string> = B extends "" | "/" ? (A extends "" ? "/" : A) : `${A}${B}`;

type Opt<T, K extends string> = T extends { readonly [P in K]: infer V } ? V : undefined;

/** Option `K` of each scope, outer to inner (a mapped tuple). */
type ScopeOpts<S extends readonly unknown[], K extends string> = { [I in keyof S]: Opt<S[I], K> };

/** The last level that sets a value: "the nearest wins". */
type Nearest<L extends readonly unknown[]> = L extends readonly [...infer Init, infer Last]
  ? [Last] extends [undefined] ? Nearest<Init> : Last
  : undefined;

/** The levels of one capability, outer to inner: scopes, contract, endpoint. */
type Levels<E extends AnyEndpoint, Ctx extends EndpointContext, K extends "auth" | "throttle"> = [
  ...ScopeOpts<Ctx["scopes"], K>,
  Opt<Ctx["options"], K>,
  E["__types"]["caps"][K],
];

/** The auth an endpoint resolves to: a guard, `true`, or `false`/`undefined` when it is public. */
export type ResolvedAuth<E extends AnyEndpoint, Ctx extends EndpointContext = RootContext> = Nearest<Levels<E, Ctx, "auth">>;

type IsOn<V> = [V] extends [undefined | false] ? false : true;

type ScopeAuthorize<S extends readonly unknown[]> = true extends ScopeOpts<S, "authorize">[number] ? true : false;

/** Whether a policy check (403) runs: `.authorize()`, or an inherited scope `authorize` without `.authorize(false)`. */
export type ResolvedAuthorize<E extends AnyEndpoint, Ctx extends EndpointContext = RootContext> =
  E["__types"]["caps"]["authorize"] extends true ? true
  : E["__types"]["caps"]["authorize"] extends false ? false
  : ScopeAuthorize<Ctx["scopes"]>;

type ThrowsOf<T> = Opt<T, "throws"> extends infer L ? (L extends readonly AnyErrorDef[] ? L[number] : never) : never;

type DerivedErrors<E extends AnyEndpoint, Ctx extends EndpointContext> =
  | ([E["__types"]["query"], E["__types"]["body"], E["__types"]["headers"]] extends [undefined, undefined, undefined] ? never : typeof errors.validation)
  | ([PathParamKeys<JoinPath<Ctx["path"], E["__types"]["path"]>>] extends [never] ? never : typeof errors.notFound)
  | (IsOn<ResolvedAuth<E, Ctx>> extends true ? typeof errors.unauthorized : never)
  | (ResolvedAuthorize<E, Ctx> extends true ? typeof errors.forbidden : never)
  | (IsOn<Nearest<Levels<E, Ctx, "throttle">>> extends true ? typeof errors.tooManyRequests : never);

/**
 * Every error an endpoint can answer with: the ones derived from its capabilities
 * (422 schemas, 404 path params, 401 auth, 403 authorize, 429 throttle) plus `throws` from every level.
 */
export type EndpointErrors<E extends AnyEndpoint, Ctx extends EndpointContext = RootContext> =
  | DerivedErrors<E, Ctx>
  | E["__types"]["throws"]
  | ThrowsOf<Ctx["options"]>
  | ThrowsOf<Ctx["scopes"][number]>;

/** Why an endpoint's capabilities are inconsistent, or `never`. */
export type CapabilityProblem<E extends AnyEndpoint, Ctx extends EndpointContext> =
  ResolvedAuthorize<E, Ctx> extends true
    ? IsOn<ResolvedAuth<E, Ctx>> extends true
      ? never
      : E["__types"]["caps"]["auth"] extends false
        ? E["__types"]["caps"]["authorize"] extends true
          ? ".authorize() needs auth, but the endpoint is .public()"
          : ".public() under a scope with authorize: add .authorize(false) or move the contract out of the scope"
        : ".authorize() needs auth on the endpoint, its contract or a scope"
    : never;

// ---- inheritance (runtime) --------------------------------------------------

export interface ResolvedCapabilities {
  readonly auth: AuthOption | undefined;
  readonly authorize: boolean;
  readonly throttle: ThrottleOptions | undefined;
  /** Derived errors, then `throws` from scopes (outer to inner), the contract and the endpoint; unique by code and status. */
  readonly errors: readonly AnyErrorDef[];
}

const nearest = <T>(values: ReadonlyArray<T | undefined>): T | undefined => {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== undefined) return values[i];
  return undefined;
};

/** Same rule as the `PathParams` type: a segment starting with `:` and a name. */
export const hasPathParams = (path: string): boolean => /(?:^|\/):[^/{?]/.test(path);

export const joinPath = (prefix: string, path: string): string =>
  path === "" || path === "/" ? prefix || "/" : `${prefix}${path}`;

/** Where an endpoint is resolved at runtime: its contract's URL prefix, the scope chain and the contract options. */
export interface CapabilityContext {
  readonly path: string;
  readonly scopes: readonly ScopeOptions[];
  readonly options: ContractOptions;
}

/** The inheritance rules alone, with no consistency check. */
function resolve(def: EndpointDef, ctx: CapabilityContext): ResolvedCapabilities {
  const levels: ReadonlyArray<ScopeOptions> = [...ctx.scopes, ctx.options];
  const auth = nearest([...levels.map((l) => l.auth), def.auth]);
  const throttle = nearest([...levels.map((l) => l.throttle), def.throttle]);
  const authorize = def.authorize ?? ctx.scopes.some((s) => s.authorize === true);
  const all: AnyErrorDef[] = [];
  if (def.query || def.body || def.headers) all.push(errors.validation);
  if (hasPathParams(joinPath(ctx.path, def.path))) all.push(errors.notFound);
  if (auth) all.push(errors.unauthorized);
  if (authorize) all.push(errors.forbidden);
  if (throttle) all.push(errors.tooManyRequests);
  for (const level of levels) all.push(...(level.throws ?? []));
  all.push(...def.throws);
  const seen = new Set<string>();
  return Object.freeze({
    auth: auth || undefined,
    authorize,
    throttle: throttle || undefined,
    // unique by code and status: one code may be declared with two statuses (a .throws(410 NOT_FOUND) next to the derived 404)
    errors: Object.freeze(
      all.filter((e) => {
        const key = `${e.code} ${e.status}`;
        return !seen.has(key) && !!seen.add(key);
      }),
    ),
  });
}

/** Runtime twin of `EndpointErrors` / `CapabilityProblem`; throws a TypeError for an inconsistent endpoint. */
export function resolveCapabilities(def: EndpointDef, ctx: CapabilityContext, label: string): ResolvedCapabilities {
  const resolved = resolve(def, ctx);
  if (resolved.authorize && !resolved.auth) {
    fail(
      def.auth === false && def.authorize === undefined
        ? `${label}: .public() under a scope with authorize: add .authorize(false) or move the contract out of the scope`
        : `${label}: .authorize() needs auth on the endpoint, its contract or a scope`,
    );
  }
  return resolved;
}

/**
 * Runtime twin of `EndpointErrors`: the derived errors, then `throws` from every level, unique by code and status. Unlike
 * `resolveCapabilities` it never throws, so it also works for a contract taken out of its folder (the client's
 * single-contract mode), where the scope chain, and so the consistency check, is missing.
 */
export const endpointErrors = (def: EndpointDef, ctx: CapabilityContext): readonly AnyErrorDef[] => resolve(def, ctx).errors;

// ---- validation of options --------------------------------------------------

export const isErrorDef = (value: unknown): value is AnyErrorDef =>
  typeof value === "function" &&
  typeof (value as AnyErrorDef).code === "string" &&
  typeof (value as AnyErrorDef).status === "number" &&
  typeof (value as AnyErrorDef).is === "function";

const DURATION = /^\d+(?:\.\d+)?[smhd]$/;

export const checkThrottle = (value: unknown, label: string): ThrottleOptions => {
  const t = value as ThrottleOptions | null;
  const per = t?.per;
  if (
    typeof t !== "object" || t === null ||
    !Number.isInteger(t.limit) || t.limit <= 0 ||
    !((typeof per === "number" && per > 0) || (typeof per === "string" && DURATION.test(per)))
  ) {
    fail(`${label}: throttle must be { limit: positive integer, per: seconds or "<n>s|m|h|d" }`);
  }
  return Object.freeze({ limit: t!.limit, per: per! });
};

export const checkAuth = (value: unknown, label: string): AuthOption => {
  if (value !== true && (typeof value !== "string" || value === "")) fail(`${label}: auth must be true or a guard name`);
  return value as AuthOption;
};

export const checkThrows = (value: unknown, label: string): readonly AnyErrorDef[] => {
  if (!Array.isArray(value) || !value.every(isErrorDef)) fail(`${label}: throws must be a list of errors (use defineError)`);
  return Object.freeze([...(value as AnyErrorDef[])]);
};

/** Validates and copies contract or scope options (frozen, null prototype). */
export function checkOptions<O extends ScopeOptions>(options: O, allowed: readonly (keyof ScopeOptions)[], label: string): O {
  if (typeof options !== "object" || options === null) fail(`${label}: options must be an object`);
  const out = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(options)) {
    if (!(allowed as readonly string[]).includes(key)) fail(`${label}: unknown option "${key}"`);
    if (value === undefined) continue;
    if (key === "auth") out.auth = checkAuth(value, label);
    else if (key === "throttle") out.throttle = checkThrottle(value, label);
    else if (key === "throws") out.throws = checkThrows(value, label);
    else if (key === "authorize") {
      if (typeof value !== "boolean") fail(`${label}: authorize must be a boolean`);
      out.authorize = value;
    }
  }
  return out as O;
}

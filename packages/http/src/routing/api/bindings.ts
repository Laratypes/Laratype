import { errors } from "@laratype/contract";
import { checkOptionalParameter, getPattern, splitRoutingPath } from "hono/utils/url";
import type { BindableModelClass, Binder, Bindings } from "./proof";
import { fail } from "./fail";

/**
 * The runtime of `r.bind()` (docs/v1/http.md › Model binding, H7 #118). A binder is a model class (looked up through
 * its static `findByRouteKey`) or a resolver from the raw path param; the router never parses a route key. A `null` /
 * `undefined` lookup is the contract's derived 404 (`NOT_FOUND`), and an optional param the request does not carry is
 * `undefined` without a lookup.
 */

/** A class source (`class X {}`), not an arrow or a method shorthand: such a value without `findByRouteKey` is a model class mistake. */
const isClass = (value: Function): boolean => /^class[\s{]/.test(Function.prototype.toString.call(value));

/** A model class binder: the static `findByRouteKey` tells it from a resolver (which is called with the raw param). */
const isModelClass = (binder: Binder): binder is BindableModelClass => typeof (binder as { findByRouteKey?: unknown }).findByRouteKey === "function";

/**
 * Refuses the one binding key an object cannot carry: `__proto__` names the prototype of every object, and Hono drops a
 * `:__proto__` path param from `param()` (it assigns the decoded key), so the handler would read `undefined` where its
 * types say the model. `constructor` and `prototype` are ordinary keys: a bound one is an own property of the ctx
 * params. The literal form, `{ __proto__: User }`, sets the prototype of the map instead of a key: `checkBindingMap`.
 */
const checkBindingKey = (key: string): void => {
  if (key === "__proto__") {
    fail(
      `r.bind(): \`__proto__\` cannot be a binding key: every object reads it as its prototype, so the binding would be dropped. ` +
        `Fix: name the path param something else.`,
    );
  }
};

/**
 * Checks one `r.bind()` key and value at `Route.api`: the key is not `__proto__` (`checkBindingKey`), and the value is
 * a model class with the `BindableModel` statics (`primaryKey`, optional `routeKeyName`, `findByRouteKey`), or a
 * resolver function. A class without `findByRouteKey` would be called without `new` at request time, so it fails here
 * instead.
 */
const checkBinder = (key: string, value: unknown): void => {
  checkBindingKey(key);
  if (typeof value !== "function") {
    fail(`r.bind(): \`${key}\` must be a model class (static primaryKey, optional routeKeyName, findByRouteKey(key)) or a (raw: string) => value resolver`);
  }
  const model = (value as { findByRouteKey?: unknown }).findByRouteKey;
  if (typeof model === "function") {
    if (typeof (value as { primaryKey?: unknown }).primaryKey !== "string") {
      fail(`r.bind(): \`${key}\` is a model class without a static primaryKey (the default route key of BindableModel)`);
    }
    return;
  }
  if (isClass(value as Function)) {
    fail(`r.bind(): \`${key}\` is a model class without a static findByRouteKey (BindableModel: primaryKey, optional routeKeyName, findByRouteKey(key))`);
  }
};

/** How a message names a prototype: `Foo.prototype` for a class or builtin, else the only honest label. */
const protoLabel = (proto: object): string => {
  const ctor = Object.getOwnPropertyDescriptor(proto, "constructor")?.value;
  return typeof ctor === "function" && ctor.name ? `${ctor.name}.prototype` : "an object that is not Object.prototype";
};

/** How a message names a value that is not a bindings map: a function by kind, a string quoted, the rest as is. */
const valueLabel = (value: unknown): string =>
  value === null ? "null" : typeof value === "function" ? "a function" : typeof value === "string" ? JSON.stringify(value) : String(value);

/**
 * Checks a `r.bind()` map at `Route.api` (docs/v1/http.md › Model binding) and returns the own string entries it read:
 * a plain map (`Object.prototype` or `null` as its prototype) with enumerable own string keys, whose every entry passes
 * `checkBinder`. The binder of each entry is read once, so a copy built from the result holds the values that were
 * checked (a `Proxy` map answers the copy with the same binder it answered the check with). A hand-built item's
 * `bindings` is checked here too.
 */
export const checkBindingMap = (bindings: unknown): [string, Binder][] => {
  if (typeof bindings !== "object" || bindings === null) {
    fail(`r.bind(): the bindings must be an object, one value per path param (got ${valueLabel(bindings)})`);
  }
  const proto = Object.getPrototypeOf(bindings) as object | null;
  if (proto !== Object.prototype && proto !== null) {
    if (typeof proto === "function") {
      fail(
        `r.bind(): \`{ __proto__: ${proto.name || "the value"} }\` sets the prototype of the bindings map instead of binding a key. ` +
          `Fix: name the path param something else.`,
      );
    }
    fail(
      `r.bind(): the bindings map must have Object.prototype or null as its prototype, not a class instance or an Object.create(base) object (got ${protoLabel(proto)})`,
    );
  }
  const entries: [string, Binder][] = [];
  for (const key of Object.getOwnPropertyNames(bindings)) {
    // A Proxy whose ownKeys lists a key it does not describe has no descriptor: the documented diagnostic, not a TypeError
    if (Object.getOwnPropertyDescriptor(bindings, key)?.enumerable !== true) {
      fail(
        `r.bind(): \`${key}\` is a non-enumerable property of the bindings map: r.bind() copies enumerable own properties only, so the binding would be dropped. ` +
          `Fix: declare it as a plain property, { ${key}: ... }.`,
      );
    }
    const binder = (bindings as Record<string, unknown>)[key];
    checkBinder(key, binder);
    entries.push([key, binder as Binder]);
  }
  return entries;
};

/**
 * A frozen copy of a checked `r.bind()` map, built from the entries the check read: what a getter or a `Proxy` answered
 * at mount is what every request resolves, never what a later read of the original map would answer.
 */
export const copyBindingMap = (bindings: unknown): Bindings => Object.freeze(Object.fromEntries(checkBindingMap(bindings)));

/**
 * The param names of a route path, the keys a binding may bind: `/api/users/:user/posts/:post?` gives `user`, `post`.
 * Hono's own parsing separates the segments and reads each param: a pattern may hold a `/`, nested braces
 * (`:id{[0-9]{2,4}}`), a brace in a character class (`:prefix{[{]}`) or an escaped one. The `?` of an optional param is
 * not part of the name; Hono registers a trailing optional route without it (`checkOptionalParameter`), which `getPattern`
 * would keep. A mid-path `?` stays in Hono's name: `nonTrailingOptionalParamNames` reports it.
 */
export const pathParamNames = (path: string): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const segment of splitRoutingPath(path)) {
    const pattern = getPattern(segment.endsWith("?") ? segment.slice(0, -1) : segment);
    if (pattern !== null && pattern !== "*") names.add(pattern[1]);
  }
  return names;
};

/**
 * The param names of a path's segments of one kind, as `pathParamNames` reads them: the `?` of an optional param is not
 * part of the name.
 */
const paramNamesOfKind = (path: string, optional: boolean): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const segment of splitRoutingPath(path)) {
    if (segment.endsWith("?") !== optional) continue;
    const pattern = getPattern(optional ? segment.slice(0, -1) : segment);
    if (pattern !== null && pattern !== "*") names.add(pattern[1]);
  }
  return names;
};

/** The names of the optional segments (`:name?`) of a path, whether Hono expands the path or registers it as written. */
const optionalParamNames = (path: string): ReadonlySet<string> => paramNamesOfKind(path, true);

/**
 * The names of the required segments (`:name`) of a path. A name that also occurs optional counts as required: the path
 * types intersect the two (`PathParams`), so a handler sees it as required and an expansion that omits it breaks the type.
 */
const requiredParamNames = (path: string): ReadonlySet<string> => paramNamesOfKind(path, false);

/**
 * The path params Hono registers under another name than their binding key: `checkOptionalParameter` expands a path that
 * ends with `?`, stripping the `?` from every optional segment (`/posts/:id?` registers `/posts` and `/posts/:id`), but
 * any other path is registered as written, so `/:post?/details` keeps `post?` and a binding on `post` would never run.
 */
export const nonTrailingOptionalParamNames = (path: string): ReadonlySet<string> =>
  path.endsWith("?") ? new Set<string>() : optionalParamNames(path);

/**
 * One route Hono registers for a path it expands that omits a required param: `checkOptionalParameter` turns a path
 * ending with `?` into each prefix ending at an optional segment (stripping the `?`s), so `/mixed/:first?/:post/:last?`
 * is also served as `/mixed` and `/mixed/:first`, without `post`. A binding on `post` would resolve `undefined` on those
 * routes where the proof promises the model. Returns `undefined` when Hono registers the path as written, when the param
 * is optional only (an absent optional param is `undefined` by the proof too: `BoundParams`), or when every expansion
 * carries it (`/a/:post/:opt?`) — those layouts stay valid.
 */
export const expandedPathWithoutParam = (path: string, param: string): string | undefined => {
  if (!requiredParamNames(path).has(param)) return undefined;
  const expansions = checkOptionalParameter(path);
  if (expansions === null) return undefined;
  return expansions.find((expansion) => !pathParamNames(expansion).has(param));
};

/**
 * Resolves the bindings of one route, each once per request: a model class through `findByRouteKey`, a resolver called
 * with the raw param. A key absent from `params` is an optional path param and gives `undefined`; a present one with
 * no match (`null` / `undefined`) is the 404.
 */
export const resolveBindings = async (
  bindings: Bindings,
  params: Record<string, string>,
): Promise<Record<string, unknown>> => {
  const resolved: [string, unknown][] = [];
  // In order: a miss stops the lookups after it, so a 404 never waits on (or runs) the rest of the bindings
  for (const [key, binder] of Object.entries(bindings)) {
    // Own key: an absent optional param must not read a member of Object.prototype (`:constructor?`)
    const raw = Object.hasOwn(params, key) ? params[key] : undefined;
    if (raw === undefined) {
      resolved.push([key, undefined]);
      continue;
    }
    const value = isModelClass(binder) ? await binder.findByRouteKey(raw) : await binder(raw);
    if (value === null || value === undefined) throw errors.notFound();
    resolved.push([key, value]);
  }
  // fromEntries, not an assignment: a resolved key is always an own data property, never a prototype swap
  return Object.fromEntries(resolved);
};

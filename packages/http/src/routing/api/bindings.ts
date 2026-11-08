import { errors } from "@laratype/contract";
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
 * Checks one `r.bind()` value at `Route.api`: a model class with the `BindableModel` statics (`primaryKey`, optional
 * `routeKeyName`, `findByRouteKey`), or a resolver function. A class without `findByRouteKey` would be called without
 * `new` at request time, so it fails here instead.
 */
export const checkBinder = (key: string, value: unknown): void => {
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

/**
 * The param names of a route path, the keys a binding may bind: `/api/users/:user/posts/:post?` gives `user`, `post`.
 * The `?` of an optional param and a `:name{pattern}` are not part of the name; a pattern may hold a `/`.
 */
export const pathParamNames = (path: string): ReadonlySet<string> => {
  const names = new Set<string>();
  let depth = 0;
  for (let index = 0; index < path.length; index++) {
    const char = path[index]!;
    if (char === "{") {
      depth++;
      continue;
    }
    if (char === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0 || char !== ":" || path[index - 1] !== "/") continue;
    let end = index + 1;
    while (end < path.length && !":/?{}".includes(path[end]!)) end++;
    names.add(path.slice(index + 1, end));
    index = end - 1;
  }
  return names;
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
    // Own key: an absent optional param must not read a member of Object.prototype (`:constructor?`, `:__proto__?`)
    const raw = Object.hasOwn(params, key) ? params[key] : undefined;
    if (raw === undefined) {
      resolved.push([key, undefined]);
      continue;
    }
    const value = isModelClass(binder) ? await binder.findByRouteKey(raw) : await binder(raw);
    if (value === null || value === undefined) throw errors.notFound();
    resolved.push([key, value]);
  }
  // fromEntries, not an assignment: an own `__proto__` key would swap the prototype of a plain object
  return Object.fromEntries(resolved);
};

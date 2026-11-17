import { errors } from "@laratype/contract";
import { getPattern, splitRoutingPath } from "hono/utils/url";
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

/**
 * Checks a `r.bind()` map at `Route.api`: its prototype is not a model class or resolver (an object literal
 * `{ __proto__: User }` sets one as the prototype instead of binding a key, so the map would bind nothing while the
 * types say it binds `__proto__`), and every entry passes `checkBinder`.
 */
export const checkBindingMap = (bindings: object): void => {
  const proto: unknown = Object.getPrototypeOf(bindings);
  if (typeof proto === "function") {
    fail(
      `r.bind(): \`{ __proto__: ${proto.name || "the value"} }\` sets the prototype of the bindings map instead of binding a key. ` +
        `Fix: name the path param something else.`,
    );
  }
  for (const [key, binder] of Object.entries(bindings)) checkBinder(key, binder);
};

/**
 * The param names of a route path, the keys a binding may bind: `/api/users/:user/posts/:post?` gives `user`, `post`.
 * Hono's own parsing separates the segments and reads each param: a pattern may hold a `/`, nested braces
 * (`:id{[0-9]{2,4}}`), a brace in a character class (`:prefix{[{]}`) or an escaped one. The `?` of an optional param is
 * not part of the name; Hono registers that route without it (`checkOptionalParameter`), which `getPattern` would keep.
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

import { errors } from "@laratype/contract";
import { checkOptionalParameter, getPattern, splitRoutingPath } from "hono/utils/url";
import { camelize, InternalException, ModelBindingRegistry, peekAppManifest } from "@laratype/support";
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
 * The param names of a route path, in path order and with repetitions: `/api/users/:user/posts/:post?` gives `user`,
 * `post`. Hono's own parsing separates the segments and reads each param: a pattern may hold a `/`, nested braces
 * (`:id{[0-9]{2,4}}`), a brace in a character class (`:prefix{[{]}`) or an escaped one. The `?` of an optional param is
 * not part of the name; Hono registers a trailing optional route without it (`checkOptionalParameter`), which `getPattern`
 * would keep. A mid-path `?` stays in Hono's name: `nonTrailingOptionalParamNames` reports it. The order matters:
 * Hono's handler map keeps the first params of an expansion (`expandedPathWithoutParam`).
 */
const pathParamList = (path: string): string[] => {
  const names: string[] = [];
  for (const segment of splitRoutingPath(path)) {
    const pattern = getPattern(segment.endsWith("?") ? segment.slice(0, -1) : segment);
    if (pattern !== null && pattern !== "*") names.push(pattern[1]);
  }
  return names;
};

/** The param names of a route path, the keys a binding may bind: `pathParamList` without repetitions. */
export const pathParamNames = (path: string): ReadonlySet<string> => new Set(pathParamList(path));

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
 * One route Hono registers for a path it expands whose handler map omits a bound param: `checkOptionalParameter` turns
 * a path ending with `?` into each prefix ending at an optional segment (stripping the `?`s), so
 * `/mixed/:first?/:post/:last?` is also served as `/mixed` and `/mixed/:first`, without `post`. A required binding on
 * `post` would resolve `undefined` on those routes where the proof promises the model.
 *
 * The expansion's own placeholders are not enough: Hono's `RegExpRouter` gives expansion `i` a handler param count of
 * `paramCount - expansions.length + i + 1` (`paramCount` counts the `/:` of the full path) and keeps the first `count`
 * params of the expansion (router.ts `add()` / `buildMatcherFromPreprocessedRoutes()`). A static segment after an
 * optional one adds an expansion without a param, so `/a/:post/:first?/fixed/:last?` registers `/a/:post` with
 * `3 - 4 + 0 + 1 = 0` params and `/a/:post/:first` with 1: `/a/one` answers no `post`, `/a/one/two` answers no `first`.
 * A binding on either key fails closed: an optional binding is checked on the registrations whose path names it, because
 * one that leaves the segment out binds `undefined` legitimately (BoundParams), while a required binding is checked on
 * every registration.
 *
 * Returns `undefined` when Hono registers the path as written, when the param is not a path param (or is optional and no
 * registration that names it drops it), or when every registration that names it keeps it in its handler map
 * (`/a/:post/:opt?`, `/a/:post/:first?`) — those layouts stay valid.
 */
export const expandedPathWithoutParam = (path: string, param: string): string | undefined => {
  const required = requiredParamNames(path).has(param);
  if (!required && !optionalParamNames(path).has(param)) return undefined;
  const expansions = checkOptionalParameter(path);
  if (expansions === null) return undefined;
  const paramCount = (path.match(/\/:/g) ?? []).length;
  for (let i = 0; i < expansions.length; i++) {
    const kept = Math.max(0, paramCount - expansions.length + i + 1);
    const names = pathParamList(expansions[i]);
    // An optional key is only at stake on a registration whose path names it: one without the segment cannot carry it
    if (!required && !names.includes(param)) continue;
    if (!names.slice(0, kept).includes(param)) return expansions[i];
  }
  return undefined;
};

// ---- implicit model binding (H14 #163) --------------------------------------

const NO_MODELS: ReadonlySet<string> = new Set();

/**
 * The implicit model keys of the app manifest (docs/v1/http.md › Model binding): `camelize(<file name>)` of every
 * `models` entry, or an empty set without a manifest (a bare Hono app or a test mounts no implicit binding) and for a
 * manifest whose scan failed. Names only: no model module is loaded here.
 */
export const manifestModelKeys = (): ReadonlySet<string> => {
  const manifest = peekAppManifest();
  if (manifest === undefined || manifest.error !== undefined) return NO_MODELS;
  return new Set(manifest.models.map((entry) => camelize(entry.name)));
};

/** The path params of `path` that `models` registers, in path order and without repetitions: a route's implicit keys. */
export const implicitParamNames = (path: string, models: ReadonlySet<string>): readonly string[] =>
  [...pathParamNames(path)].filter((name) => models.has(name));

/**
 * The mount-time issue of one binder on a `.scopeBindings()` route (H14 #163), or `undefined` when it can scope: every
 * binder must be a model class, and its `findByRouteKey` must take a `scope` second parameter. `Function.length` does
 * not count a default or a rest parameter, so `(key, scope = {})` and `(...args)` are refused too: declare `scope` as a
 * plain second parameter.
 */
export const scopedBinderIssue = (key: string, binder: Binder): string | undefined => {
  if (!isModelClass(binder)) {
    return `.scopeBindings(): \`${key}\` is bound by a resolver, and a resolver cannot be scoped: bind it as a model class, or drop .scopeBindings().`;
  }
  const lookup = (binder as { findByRouteKey: (...args: never[]) => unknown }).findByRouteKey;
  if (lookup.length < 2) {
    const model = binder.name || "the model";
    return (
      `model binding: \`${key}\` binds \`${model}\`, whose findByRouteKey() takes no \`scope\` parameter: a .scopeBindings() route resolves a child through its parent, ` +
      `so declare \`scope\` as a plain second parameter of findByRouteKey (a default or rest parameter does not count; docs/v1/http.md › Model binding).`
    );
  }
  return undefined;
};

/** The bindings `resolveRouteBindings()` reads: the route's explicit map, its implicit keys and whether it is scoped. */
export interface RouteBindingInput {
  /** The `r.bind()` binders of the route (its scopes' then its contract's), its path params only. */
  readonly explicit: Bindings;
  /** The path params the app's registered models bind, in path order. */
  readonly implicit: readonly string[];
  /** `r.scopeBindings()`: resolve in path order, passing each earlier model as the child's `scope`. */
  readonly scoped: boolean;
  /** The route's full path, for the path order of a scoped route. */
  readonly path: string;
};

/**
 * Resolves one route's bindings, each key once per request (docs/v1/http.md › Model binding): the implicit models of
 * the app manifest first, in path order, then the explicit `r.bind()` entries, a key both name keeping its explicit
 * binder and its position. A model class goes through `findByRouteKey` (its second argument is the models already
 * resolved for earlier params on a `.scopeBindings()` route); a resolver is called with the raw param.
 *
 * An absent optional param binds `undefined` without a lookup. On a scoped route a param present after an absent bound
 * parent is the 404 (the child cannot be proven to belong to that parent), and so is a miss (`null` / `undefined`).
 * A registered model the database provider did not load, or one whose lookup cannot scope on a scoped route, is a
 * configuration 500 (it cannot be known at mount: the classes load with the database, docs/v1/http.md › Model binding).
 */
export const resolveRouteBindings = async (
  input: RouteBindingInput,
  params: Record<string, string>,
): Promise<Record<string, unknown>> => {
  const entries = new Map<string, Binder>();
  if (input.implicit.length) {
    const registry = input.implicit.some((key) => !Object.hasOwn(input.explicit, key)) ? ModelBindingRegistry.current() : undefined;
    const models = registry?.routeModels;
    for (const key of input.implicit) {
      // An explicit binder wins the key without a registry read, so a route that binds all its models needs no database
      if (Object.hasOwn(input.explicit, key)) continue;
      // Own key: a `toString` model must not read Object.prototype.toString
      const model: unknown = models !== undefined && Object.hasOwn(models, key) ? models[key] : undefined;
      if (typeof model !== "function" || typeof (model as { findByRouteKey?: unknown }).findByRouteKey !== "function") {
        throw new InternalException(
          `[@laratype/http] implicit model binding: \`${key}\` is a model of the app manifest, but no model class is loaded for it: ` +
            `register DatabaseServiceProvider, or mount the contract from a .withoutImplicitBinding() builder`,
        );
      }
      const issue = input.scoped ? scopedBinderIssue(key, model as Binder) : undefined;
      if (issue !== undefined) throw new InternalException(`[@laratype/http] ${issue}`);
      entries.set(key, model as Binder);
    }
  }
  for (const [key, binder] of Object.entries(input.explicit)) entries.set(key, binder);

  const order = input.scoped ? [...pathParamNames(input.path)] : [];
  const ordered = input.scoped
    ? new Map([...entries].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])))
    : entries;

  const resolved: [string, unknown][] = [];
  const models = new Map<string, object>();
  let absent = false;
  // In order: a miss stops the lookups after it, so a 404 never waits on (or runs) the rest of the bindings
  for (const [key, binder] of ordered) {
    // Own key: an absent optional param must not read a member of Object.prototype (`:constructor?`)
    const raw = Object.hasOwn(params, key) ? params[key] : undefined;
    if (raw === undefined) {
      absent = true;
      resolved.push([key, undefined]);
      continue;
    }
    // A child cannot be scoped by a parent the request did not carry: answering it would read another parent's row
    if (input.scoped && absent) throw errors.notFound();
    const scope = input.scoped
      ? Object.freeze(Object.fromEntries(models)) as Readonly<Record<string, object>>
      : undefined;
    const value = isModelClass(binder)
      ? await (scope === undefined ? binder.findByRouteKey(raw) : binder.findByRouteKey(raw, scope))
      : await binder(raw);
    if (value === null || value === undefined) throw errors.notFound();
    resolved.push([key, value]);
    if (input.scoped && isModelClass(binder)) models.set(key, value as object);
  }
  // fromEntries, not an assignment: a resolved key is always an own data property, never a prototype swap
  return Object.fromEntries(resolved);
};

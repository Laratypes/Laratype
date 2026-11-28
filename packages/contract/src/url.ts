import type { PathParams } from "./path";
import { fail, isPlainObject, leavesOrigin } from "./internal";

/** A value a query string carries: a primitive, a `Date` (sent as ISO 8601), or no value (`null` and `undefined` are skipped). */
export type UrlQueryValue = string | number | bigint | boolean | Date | null | undefined;

/**
 * The query of a URL: flat values only, each key once or repeated (an array). A nested object has no defined
 * serialization (no `a[b]=1`), so it is a type error here and `buildUrl` rejects one at runtime.
 */
export type UrlQuery = { readonly [key: string]: UrlQueryValue | readonly UrlQueryValue[] };

/**
 * The shape a query must have, used as a self-constraint (`Q extends UrlQueryShape<Q>`): a mapped type checks each key,
 * so a named `interface` (which gets no implicit index signature) is accepted, while a nested object's key becomes
 * `never` and fails the constraint. `object` keeps a string or a number out.
 */
type UrlQueryShape<Q> = { [K in keyof Q]: Q[K] extends UrlQueryValue | readonly UrlQueryValue[] ? Q[K] : never };

/** The query check that is not part of the constraint: an array or a function is an object, but not a query at runtime. */
type UrlQueryCheck<Q> = Q extends readonly unknown[] | ((...args: never[]) => unknown)
  ? { readonly error: "buildUrl: query must be a plain object of keys" }
  : unknown;

/** The segments of a path: a "/" inside a param's regex (`:file{.+/.+}`) stays in its segment (the split `path.ts` uses). */
type Segments<P extends string> =
  P extends `${infer H}/${infer T}`
    ? H extends `${string}{${string}`
      ? H extends `${string}}${string}` ? H | Segments<T> : Segments<`${H}\u0000${T}`>
      : H | Segments<T>
    : P;

/** Whether a segment of the path is exactly `*`: Hono's wildcard syntax, which `buildUrl` cannot fill. */
type HasWildcard<P extends string> = string extends P ? false : "*" extends Segments<P> ? true : false;

/** The `params` of a path with a `*` segment: an error instead of keys, since `buildUrl` refuses to build the path. */
type WildcardParams<P extends string> = {
  readonly error: `buildUrl: path "${P}" has a "*" segment, which buildUrl cannot fill`;
};

/** Whether `buildUrl` takes its input: a required param, or a `*` segment, needs it. */
type NeedsInput<P extends string> = HasWildcard<P> extends true ? true : {} extends PathParams<P> ? false : true;

/** Param values for a path: each key of `PathParams<P>` takes a string or a number (optional keys stay optional). */
export type UrlParams<P extends string> = string extends P
  ? Record<string, string | number>
  : HasWildcard<P> extends true
    ? WildcardParams<P>
    : { [K in keyof PathParams<P>]: string | number };

/** `params` is required when the path has a required param, or a `*` segment (whose `params` is the error type above). */
export type UrlInput<P extends string, Q extends UrlQueryShape<Q> & object = UrlQuery> = (NeedsInput<P> extends true
  ? { params: UrlParams<P> }
  : { params?: UrlParams<P> | undefined }) & {
  query?: (Q & UrlQueryCheck<Q>) | undefined;
};

/** Encodes `text` with `encodeURIComponent`; an unpaired surrogate throws, with a diagnostic that never echoes the value. */
function encodeValue(name: string, text: string, path: string): string {
  try {
    return encodeURIComponent(text);
  } catch {
    return fail(`buildUrl: param "${name}" for "${path}" has an unpaired surrogate`);
  }
}

/**
 * A param pattern's answer for a value in the form of the router that serves it: `accepts` or `rejects`, or `unusable`
 * when `new RegExp` throws for both forms Hono compiles.
 */
type PatternAnswer = "accepts" | "rejects" | "unusable";

/**
 * The static path that follows a param, the context Hono compiles the param's pattern with: `suffix` holds its static
 * segments (from the param's `/`), and `next` is the first of them, which the trie router puts in its lookahead.
 */
type PatternContext = { readonly suffix: string; readonly next: string | undefined };

/** The static segments after a param at `rest` (empty, or starting with `/`): stops at a param, a wildcard or an empty segment. */
function patternContext(rest: string): PatternContext {
  let end = 0;
  let next: string | undefined;
  while (rest[end] === "/") {
    const start = end + 1;
    let stop = start;
    while (stop < rest.length && rest[stop] !== "/") stop++;
    const segment = rest.slice(start, stop);
    if (segment === "" || segment.startsWith(":") || segment.startsWith("*")) break;
    next ??= segment;
    end = stop;
  }
  return { suffix: rest.slice(0, end), next };
}

/** Escapes `text` for a regex source: the static segments Hono appends to a param pattern are literal path text. */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Refuses a pattern Hono cannot route: it reads a param pattern up to the first `}` inside it, then splits the route on
 * `/`, so a pattern with a `}` before a `/` (`:f{a{2}/x}`, a quantifier before a slash) is cut at that `/` and neither
 * router matches the route. A path like that can only build a URL that 404s, so `buildUrl` throws instead.
 */
function refuseSplitPattern(name: string, pattern: string, path: string): void {
  const brace = pattern.indexOf("}");
  if (brace !== -1 && pattern.indexOf("/", brace) !== -1) {
    fail(`buildUrl: param "${name}" for "${path}" has a pattern with "}" before "/", which Hono cannot route`);
  }
}

/**
 * Whether Hono 4.9.6's RegExp router compiles a param pattern: it refuses `.*`, and a capturing group it cannot turn
 * into a `(?:...)` group. SmartRouter then serves the route set with the trie router.
 */
function regexpRouterCompiles(pattern: string): boolean {
  if (pattern === ".*") return false;
  return !/\((?!\?:)/.test(pattern.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:"));
}

/**
 * Matches a param's pattern against `value` the way Hono matches a param: anchored, with no flags, and with the static
 * path that follows the param as context. A pattern Hono's RegExp router compiles is matched in its form, which wraps the
 * source in a group over the whole route (`^(?:pattern)/next$` here); a pattern that router refuses (a lookahead, `.*`,
 * a capturing group) is served by the trie router, whose form groups the pattern the same way (`^(?:pattern)$`, or
 * `^(?:pattern)(?=/next)`) against the rest of the path, since Hono 4.13.23 (GHSA-586x). Both run on the raw
 * path, where `%2F` is still an escape (Hono's `getPath` decodes with `decodeURI`, which keeps it).
 */
function matchPattern(pattern: string, value: string, context: PatternContext): PatternAnswer {
  const { suffix, next } = context;
  // both routers match from the start of the rest of the path, which starts with the value followed by the static rest
  const input = value + suffix;
  if (regexpRouterCompiles(pattern)) {
    // `^(?:pattern)$` is the RegExp router's form when the param ends the path; with a static rest, it appends it
    try {
      return new RegExp(`^(?:${pattern})${escapeRegExp(suffix)}$`).test(input) ? "accepts" : "rejects";
    } catch {
      // the RegExp form cannot compile after all; the trie form is the only one left
    }
  }
  // a param the trie router sees without a static segment next to it is matched against the whole rest, anchored, and
  // the pattern is grouped: an ungrouped `a|b` would anchor only the first and last alternatives (GHSA-586x)
  try {
    const source = next === undefined ? `^(?:${pattern})$` : `^(?:${pattern})(?=/${escapeRegExp(next)})`;
    return new RegExp(source).test(input) ? "accepts" : "rejects";
  } catch {
    return "unusable";
  }
}

/**
 * Whether Hono's routers would read `value` differently from the RegExp form: that form groups the pattern and appends
 * the static rest, while a trie router takes the matched text (`exec()[0]`) as the param, so it can stop at a prefix or
 * an inner `/next`. Both trie forms are checked: the grouped one (`^(?:pattern)$` / `^(?:pattern)(?=/next)`) that Hono
 * 4.13.23 uses (GHSA-586x), and the bare one (`^pattern$` / `^pattern(?=/next)`) an older Hono still runs, which a browser
 * client cannot rule out because `@laratype/contract` has no Hono dependency. A pattern the RegExp router refuses is
 * served by the trie router alone, so there is no disagreement. This is consulted only for a split `buildUrl` is about to
 * send; a value that stays encoded is not a router choice.
 */
function routerDisagrees(pattern: string, value: string, context: PatternContext): boolean {
  if (!regexpRouterCompiles(pattern)) return false;
  const { suffix, next } = context;
  const input = value + suffix;
  let regexp: boolean;
  try {
    regexp = new RegExp(`^(?:${pattern})${escapeRegExp(suffix)}$`).test(input);
  } catch {
    // the RegExp form cannot compile: the trie router is the only one that can serve the route
    return false;
  }
  const lookahead = next === undefined ? "$" : `(?=/${escapeRegExp(next)})`;
  for (const source of [`^(?:${pattern})${lookahead}`, `^${pattern}${lookahead}`]) {
    let trie: RegExpExecArray | null;
    try {
      trie = new RegExp(source).exec(input);
    } catch {
      // this trie form cannot compile either; skip it
      continue;
    }
    if (regexp !== (trie !== null)) return true;
    // both accept: the trie router reads the matched text as the param, so a prefix is a different value
    if (regexp && trie !== null && trie[0] !== value) return true;
  }
  return false;
}

/** Throws when a value would route differently under Hono's routers; names the param and the path, never the value. */
function failRouterDisagreement(name: string, path: string): never {
  return fail(
    `buildUrl: param "${name}" for "${path}" has a pattern Hono's two routers read differently for this value, so the URL depends on the app's router`,
  );
}

/**
 * Encodes one param value: the whole value by default, so a `/` is `%2F` and a value like `admin/all` cannot pick the
 * static `admin/all` sibling route. A value without a `/` is the encoded value and is never examined per segment: the
 * trie router reading a prefix of it is Hono's matching, not a URL choice. Only a value with a `/` that its pattern
 * rejects in that form is examined per segment: the segments joined with `/`, as `:file{.+/.+}` (a literal `/`, where
 * `%2F` would 404) needs a real split. The split is used when the pattern accepts it. Because a split that is sent turns
 * the value into path segments, a split that either trie form (grouped or bare) reads differently from the RegExp form
 * throws (the app's router decides which one serves it); a split the pattern rejects keeps the encoded value, which 404s.
 * Only a split that is used refuses an empty, `.` or `..` segment, since it must not add a segment or be resolved as a
 * dot segment.
 */
function encodeParam(name: string, text: string, path: string, pattern: string | undefined, rest: string): string {
  const encoded = encodeValue(name, text, path);
  if (pattern === undefined || !text.includes("/")) return encoded;
  const context = patternContext(rest);
  if (matchPattern(pattern, encoded, context) !== "rejects") return encoded;
  const segments = text.split("/");
  const perSegment = segments.map((segment) => encodeValue(name, segment, path)).join("/");
  if (matchPattern(pattern, perSegment, context) !== "accepts") return encoded;
  // the split is sent: every trie form in use must read it the same way as the RegExp form
  if (routerDisagrees(pattern, perSegment, context)) {
    failRouterDisagreement(name, path);
  }
  refuseEmptyOrDotSegments(name, segments, path);
  return perSegment;
}

/**
 * Refuses a segment of a split that would be sent and is empty or exactly "." or "..": it would add a segment or be
 * resolved as a dot segment. The diagnostic names the param and the path, never the value.
 */
function refuseEmptyOrDotSegments(name: string, segments: readonly string[], path: string): void {
  for (const segment of segments) {
    if (segment === "") fail(`buildUrl: param "${name}" for "${path}" has an empty segment`);
    if (segment === "." || segment === "..") {
      fail(`buildUrl: param "${name}" for "${path}" has a "." or ".." segment (a dot segment)`);
    }
  }
}

/** Replaces each `:name`, `:name?` and `:name{regex}` segment (Hono syntax, see `PathParams`). */
function fillPath(path: string, params: Readonly<Record<string, unknown>>): string {
  let out = "";
  let i = 0;
  while (i < path.length) {
    const char = path[i]!;
    // a "*" segment is a Hono wildcard: it has no value to fill, and sending "*" literally is not the route
    if (char === "*" && (i === 0 || path[i - 1] === "/") && (i + 1 === path.length || path[i + 1] === "/")) {
      fail(`buildUrl: path "${path}" has a "*" segment, which buildUrl cannot fill`);
    }
    if (char !== ":" || (i > 0 && path[i - 1] !== "/")) {
      out += char;
      i++;
      continue;
    }
    let j = i + 1;
    while (j < path.length && !"/{?".includes(path[j]!)) j++;
    const name = path.slice(i + 1, j);
    if (name === "") {
      out += char;
      i++;
      continue;
    }
    // the regex pattern may hold "/" and nested braces ("{2,3}")
    let pattern: string | undefined;
    if (path[j] === "{") {
      const start = j + 1;
      for (let depth = 0; j < path.length; j++) {
        if (path[j] === "{") depth++;
        else if (path[j] === "}" && --depth === 0) {
          pattern = path.slice(start, j);
          j++;
          break;
        }
      }
      // a pattern that never closes keeps the base behavior: the loop runs to the end of the path
      if (pattern !== undefined) refuseSplitPattern(name, pattern, path);
    }
    const optional = path[j] === "?";
    if (optional) j++;
    // an own property only: a param named "__proto__" or "constructor" must not read the object's prototype
    const value = Object.hasOwn(params, name) ? params[name] : undefined;
    if (value === undefined || value === null || value === "") {
      if (!optional) fail(`buildUrl: missing param "${name}" for "${path}"`);
      // an absent optional param drops its whole segment
      if (out.endsWith("/")) out = out.slice(0, -1);
    } else {
      if (typeof value !== "string" && typeof value !== "number") {
        fail(`buildUrl: param "${name}" for "${path}" must be a string or a number, got ${typeof value}`);
      }
      // "/users/NaN" is never the URL a caller meant: a NaN or an infinite number is a bug upstream, not a key
      if (typeof value === "number" && !Number.isFinite(value)) {
        fail(`buildUrl: param "${name}" for "${path}" must be a finite number, got ${value}`);
      }
      const text = String(value);
      // encodeURIComponent keeps dots, and URL parsing (fetch) resolves a dot segment: "/api/users/.." → "/api"
      if (text === "." || text === "..") fail(`buildUrl: param "${name}" for "${path}" cannot be "${text}" (a dot segment)`);
      // "/" stays %2F unless the param's pattern rejects the encoded value and accepts a split one: ":file{.+/.+}"
      out += encodeParam(name, text, path, pattern, path.slice(j));
    }
    i = j;
  }
  // an absent optional first segment ("/:a?//x") must not leave "//x", which URL parsing reads as another host
  if (leavesOrigin(out)) fail(`buildUrl: "${path}" builds "${out}", which a URL reads as another host`);
  return out || "/";
}

/** The value's constructor name for the query diagnostic: `Array`, `Map`, a class name, or its `typeof` for a primitive. */
function queryKind(query: unknown): string {
  if (typeof query !== "object") return typeof query;
  if (Array.isArray(query)) return "Array";
  try {
    const prototype = Object.getPrototypeOf(query) as object | null;
    if (prototype === null) return "Object";
    const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value as { name?: unknown } | undefined;
    if (typeof constructor !== "function") return "an object";
    const name = constructor.name as unknown;
    return typeof name === "string" && name !== "" ? name : "an object";
  } catch {
    return "an object";
  }
}

function serializeQuery(query: UrlQuery): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null) continue;
      if (item instanceof Date) search.append(key, item.toISOString());
      else if (typeof item === "object" || typeof item === "function" || typeof item === "symbol") {
        fail(`buildUrl: query "${key}" must be a string, number, boolean, bigint or Date, or an array of them`);
      }
      else search.append(key, String(item));
    }
  }
  return search.toString();
}

/**
 * Builds a URL from a full route path: `buildUrl("/api/users/:user/posts", { params: { user: 1 }, query: { page: 2 } })`
 * → `"/api/users/1/posts?page=2"`. Pure and browser-safe; shared by `@laratype/client` and the server `route()` helper (H13).
 * - Param values are a `string` or a finite `number`, encoded with `encodeURIComponent`, so a `/` in a value is `%2F`. A
 *   missing required param throws; an absent optional one drops its segment. A value without `/` is sent encoded and is
 *   never examined per segment. When the pattern rejects the encoded value (it needs a literal `/`, as `:file{.+/.+}`
 *   does: `%2F` would 404), the value is split on `/`, each segment encoded, and the split is sent when the pattern
 *   accepts it; a split the pattern rejects keeps the encoded value, which 404s. Because a sent split turns the value into
 *   path segments, the RegExp form is compared with both trie forms on that split — the grouped one Hono 4.13.23 uses and
 *   the bare one an older server may still run — and `buildUrl` throws when either reads it differently (a top-level
 *   `|`, a lazy quantifier, an earlier alternative stopping at an inner `/next`; another route of the app decides which
 *   router serves it). The sent split's segments become path segments, so it refuses an empty, `.` or `..` segment. A
 *   pattern with a `}` before a `/` (`:f{a{2}/x}`) throws: Hono reads the pattern up to that `}` and splits the route
 *   there, so it cannot route the path. A `*` segment throws: there is no value to fill it with.
 * - A param value of exactly `.` or `..` throws: it would survive encoding and be resolved as a dot segment.
 * - A result that URL parsing reads as another host throws (`"//x"` from an absent optional first param in `"/:a?//x"`).
 * - Query: a plain object of keys (a `null` prototype or any realm's `Object.prototype`), not an array, a `Map`, a
 *   `Date` or a class instance. `undefined` and `null` are skipped, an array value repeats its key, a `Date` is sent as
 *   ISO 8601. A nested object, a function or a symbol value throws.
 */
export function buildUrl<P extends string, Q extends UrlQueryShape<Q> & object = UrlQuery>(
  path: P,
  ...[input]: NeedsInput<P> extends true ? [input: UrlInput<P, Q>] : [input?: UrlInput<P, Q>]
): string {
  if (typeof path !== "string") fail(`buildUrl: path must be a string, got ${typeof path}`);
  const params: unknown = input?.params;
  if (params != null && typeof params !== "object") fail(`buildUrl: params must be an object, got ${typeof params}`);
  const query: unknown = input?.query;
  if (query != null && (typeof query !== "object" || !isPlainObject(query))) {
    fail(`buildUrl: query must be a plain object of keys, got ${queryKind(query)}`);
  }
  const url = fillPath(path, (params ?? {}) as Readonly<Record<string, unknown>>);
  // the plain-object check above is the runtime half of `UrlQuery`: `serializeQuery` refuses a value that is not flat
  const search = query == null ? "" : serializeQuery(query as UrlQuery);
  return search ? `${url}?${search}` : url;
}

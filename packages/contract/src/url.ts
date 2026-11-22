import type { PathParams } from "./path";
import { fail } from "./internal";

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
  ? { readonly error: "buildUrl: query must be a plain object of keys, not an array or a function" }
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

/**
 * Counts `Char` in `Text`, as a string of dots: the brace balance of a pattern body Hono cuts at an inner `}`. A body
 * whose `{` and `}` counts differ ends at a `}` that is not its own closing brace (`[a-z]{2` from `[a-z]{2}/x`).
 */
type CountChar<Text extends string, Char extends string, Count extends string = ""> =
  Text extends `${infer Head}${infer Rest}`
    ? Head extends Char ? CountChar<Rest, Char, `${Count}.`> : CountChar<Rest, Char, Count>
    : Count;

/** Whether a pattern body is cut at an inner `}`: its `{` and `}` counts differ. */
type UnbalancedBody<Body extends string> = CountChar<Body, "{"> extends CountChar<Body, "}"> ? false : true;

/** A segment Hono closes at an inner `}`: it ends with `}`, but its body has an unmatched `{` (`:f{[a-z]{2}`). */
type CutPatternSegment<S extends string> = S extends `:${infer _Name}{${infer Body}}` ? UnbalancedBody<Body> : false;

/** Whether `P` holds `S` followed by a `/`: the slice Hono cuts the route at, which proves the pattern went on. */
type FollowedBySlash<P extends string, S extends string> = P extends `${string}${S}/${string}` ? true : false;

/** Whether a segment of the path is a param Hono cuts at an inner `}` and a later `/` (distributes over the segments). */
type AnyCutPattern<P extends string, S extends string = Segments<P>> = S extends unknown
  ? CutPatternSegment<S> extends true ? FollowedBySlash<P, S> : false
  : never;

/** Whether the path has a param pattern Hono cuts at an inner `}` before a `/`: no router can route it. */
type HasCutPattern<P extends string> = string extends P ? false : true extends AnyCutPattern<P> ? true : false;

/** The `params` of a path Hono cuts at an inner `}`: an error instead of keys, since `buildUrl` refuses the path. */
type CutPatternParams<P extends string> = {
  readonly error: `buildUrl: path "${P}" has a pattern with "}" before "/", which Hono cannot route`;
};

/** Whether `buildUrl` takes its input: a required param, or a `*` segment, needs it. */
type NeedsInput<P extends string> = HasWildcard<P> extends true ? true : {} extends PathParams<P> ? false : true;

/** Param values for a path: each key of `PathParams<P>` takes a string or a number (optional keys stay optional). */
export type UrlParams<P extends string> = string extends P
  ? Record<string, string | number>
  : HasWildcard<P> extends true
    ? WildcardParams<P>
    : HasCutPattern<P> extends true
      ? CutPatternParams<P>
      : { [K in keyof PathParams<P>]: string | number };

/** `params` is required when the path has a required param, a `*` segment, or a pattern error (whose `params` is the error type above). */
export type UrlInput<P extends string, Q extends UrlQueryShape<Q> & object = UrlQuery> = (NeedsInput<P> extends true
  ? { params: UrlParams<P> }
  : { params?: UrlParams<P> | undefined }) & {
  query?: (Q & UrlQueryCheck<Q>) | undefined;
};

/**
 * Whether URL parsing reads `path` as another host or scheme, without `URL` (string work only): it drops leading C0
 * controls and spaces and every tab, LF and CR, and reads `\` as `/`. Then `//x` is a host, and so is a leading
 * `scheme:` (`http:/x` is another host from an https page).
 */
const leavesOrigin = (path: string): boolean => {
  const parsed = path.replace(/^[\u0000-\u0020]+/, "").replace(/[\t\n\r]/g, "").replace(/\\/g, "/");
  return parsed.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(parsed);
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
 * A param pattern's answer for a value: `accepts` or `rejects` when Hono's two routers agree, `differs` when the value
 * would route differently under them (the app's router decides one app-wide, so no URL is right), and `unusable` when
 * `new RegExp` throws for both forms Hono compiles.
 */
type PatternAnswer = "accepts" | "rejects" | "unusable" | "differs";

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
 * into a `(?:...)` group. SmartRouter then serves the route set with its trie router.
 */
function regexpRouterCompiles(pattern: string): boolean {
  if (pattern === ".*") return false;
  return !/\((?!\?:)/.test(pattern.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:"));
}

/**
 * Matches a param's pattern against `value` the way Hono matches a param: anchored, with no flags, and with the static
 * path that follows the param as context. Hono's default SmartRouter picks one router for the whole app: it tries
 * `router/reg-exp-router` first and keeps it once every route compiles, and falls back to `router/trie-router` for the
 * whole app as soon as one route makes the RegExp router throw. So a pattern the RegExp router refuses is matched in
 * the trie router's form only, while for a pattern it compiles the two forms must agree: the RegExp form wraps the
 * source in a group over the whole route (`^(?:pattern)/next$` here) and scopes a top-level `|`, while the trie form
 * matches the pattern bare (`^pattern$`, or `^pattern(?=/next)`) and takes the matched text as the param. When the forms
 * accept different text, the URL would route differently depending on some other route of the app, and the answer is
 * `differs` rather than a guess. Both run on the raw path, where `%2F` is still an escape (Hono's `getPath` decodes with
 * `decodeURI`, which keeps it).
 */
function matchPattern(pattern: string, value: string, context: PatternContext): PatternAnswer {
  const { suffix, next } = context;
  // both routers match from the start of the rest of the path, which starts with the value followed by the static rest
  const input = value + suffix;
  // `^(?:pattern)$` is the RegExp router's form when the param ends the path; with a static rest, it appends it
  const regexpSource = `^(?:${pattern})${escapeRegExp(suffix)}$`;
  // a param the trie router sees without a static segment next to it is matched against the whole rest, anchored
  const trieSource = next === undefined ? `^${pattern}$` : `^${pattern}(?=/${escapeRegExp(next)})`;
  let trie: RegExpExecArray | null | undefined;
  try {
    trie = new RegExp(trieSource).exec(input);
  } catch {
    trie = undefined;
  }
  const trieAnswer: PatternAnswer = trie === undefined ? "unusable" : trie === null ? "rejects" : "accepts";
  // a pattern the RegExp router refuses makes SmartRouter serve the whole app with the trie router: only its form applies
  if (!regexpRouterCompiles(pattern)) return trieAnswer;
  let regexp: boolean | undefined;
  try {
    regexp = new RegExp(regexpSource).test(input);
  } catch {
    regexp = undefined;
  }
  // only one form compiles: that router's answer is the only possible one (the other could not register the route)
  if (regexp === undefined) return trieAnswer;
  if (trie === undefined) return regexp ? "accepts" : "rejects";
  if (regexp !== (trie !== null)) return "differs";
  if (!regexp) return "rejects";
  // both accept: the trie router reads the matched text as the param, so it must be the whole value, not a prefix or suffix
  return trie === null || trie[0] !== value ? "differs" : "accepts";
}

/** Throws when a value would route differently under Hono's two routers; names the param and the path, never the value. */
function failRouterDisagreement(name: string, path: string): never {
  return fail(
    `buildUrl: param "${name}" for "${path}" has a pattern Hono's two routers read differently for this value, so the URL depends on the app's router`,
  );
}

/**
 * Encodes one param value: the whole value by default, so a `/` is `%2F` and a value like `admin/all` cannot pick the
 * static `admin/all` sibling route. The pattern is always matched against the encoded value first, since a top-level `|`
 * can make the two routers read even a value without a `/` differently; such a value throws, because no URL is right
 * under both routers. Only a value with a `/` that its pattern rejects in that form is examined per segment: the
 * segments joined with `/`, as `:file{.+/.+}` (a literal `/`, where `%2F` would 404) needs a real split. The pattern is
 * matched with the static path that follows the param, as Hono compiles it. The split is used when the pattern accepts
 * it, and only then are its empty and `.`/`..` segments refused, since a split that is actually sent must not add a
 * segment or be resolved as a dot segment. A pattern that rejects the split too (the value cannot reach the route) and
 * an unusable pattern keep the encoded value, so it 404s as one segment instead of throwing in a server `route()` over a
 * request-derived value.
 */
function encodeParam(name: string, text: string, path: string, pattern: string | undefined, rest: string): string {
  const encoded = encodeValue(name, text, path);
  if (pattern === undefined) return encoded;
  const context = patternContext(rest);
  const encodedAnswer = matchPattern(pattern, encoded, context);
  if (encodedAnswer === "differs") failRouterDisagreement(name, path);
  // without a "/" the split is the same string: the encoded form is the one to send
  if (!text.includes("/")) return encoded;
  if (encodedAnswer !== "rejects") return encoded;
  const segments = text.split("/");
  const perSegment = segments.map((segment) => encodeValue(name, segment, path)).join("/");
  const splitAnswer = matchPattern(pattern, perSegment, context);
  if (splitAnswer === "differs") failRouterDisagreement(name, path);
  // A split the pattern rejects would never be sent, and refusing one of its segments would turn a URL that 404s into a
  // 500: the check runs only on a split that is used
  if (splitAnswer !== "accepts") return encoded;
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

/** Whether `query` is a plain object of keys: its prototype is `Object.prototype` or `null`, never an array's, a `Map`'s or a class's. */
function isPlainQuery(query: object): boolean {
  try {
    const prototype = Object.getPrototypeOf(query) as object | null;
    return prototype === null || prototype === Object.prototype;
  } catch {
    return false;
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
 *   missing required param throws; an absent optional one drops its segment. The pattern is matched against the encoded
 *   value first, in both forms Hono's routers compile: when Hono's RegExp router compiles the pattern, the forms must
 *   agree or `buildUrl` throws (a top-level `|` can route a value differently depending on the router the app's other
 *   routes select), and a pattern the RegExp router refuses is matched in the trie form only. When the pattern rejects
 *   the encoded value (it needs a literal `/`, as `:file{.+/.+}` does: `%2F` would 404), the value is split on `/` and
 *   each segment is encoded; the split is used when the pattern matches it. A pattern with a `}` before a `/`
 *   (`:f{a{2}/x}`) throws: Hono reads the pattern up to that `}` and splits the route there, so it cannot route the
 *   path. The split is used when the pattern matches it, so its segments then become path segments, and a split that is
 *   used refuses an empty, `.` or `..` segment. A pattern that rejects both forms keeps the encoded value (the URL then
 *   404s as one segment). A `*` segment throws: there is no value to fill it with.
 * - A param value of exactly `.` or `..` throws: it would survive encoding and be resolved as a dot segment.
 * - A result that URL parsing reads as another host throws (`"//x"` from an absent optional first param in `"/:a?//x"`).
 * - Query: a plain object of keys (prototype `Object.prototype` or `null`), not an array, a `Map`, a `Date` or a class
 *   instance. `undefined` and `null` are skipped, an array value repeats its key, a `Date` is sent as ISO 8601. A nested
 *   object, a function or a symbol value throws.
 */
export function buildUrl<P extends string, Q extends UrlQueryShape<Q> & object = UrlQuery>(
  path: P,
  ...[input]: NeedsInput<P> extends true ? [input: UrlInput<P, Q>] : [input?: UrlInput<P, Q>]
): string {
  if (typeof path !== "string") fail(`buildUrl: path must be a string, got ${typeof path}`);
  const params: unknown = input?.params;
  if (params != null && typeof params !== "object") fail(`buildUrl: params must be an object, got ${typeof params}`);
  const query: unknown = input?.query;
  if (query != null && (typeof query !== "object" || !isPlainQuery(query))) {
    fail(`buildUrl: query must be a plain object of keys, got ${queryKind(query)}`);
  }
  const url = fillPath(path, (params ?? {}) as Readonly<Record<string, unknown>>);
  // the plain-object check above is the runtime half of `UrlQuery`: `serializeQuery` refuses a value that is not flat
  const search = query == null ? "" : serializeQuery(query as UrlQuery);
  return search ? `${url}?${search}` : url;
}

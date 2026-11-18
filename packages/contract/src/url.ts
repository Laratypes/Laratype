import type { PathParams } from "./path";
import { fail } from "./internal";

/** A value a query string carries: a primitive, a `Date` (sent as ISO 8601), or no value (`null` and `undefined` are skipped). */
export type UrlQueryValue = string | number | bigint | boolean | Date | null | undefined;

/**
 * The query of a URL: flat values only, each key once or repeated (an array). A nested object has no defined
 * serialization (no `a[b]=1`), so it is a type error here and `buildUrl` rejects one at runtime.
 */
export type UrlQuery = { readonly [key: string]: UrlQueryValue | readonly UrlQueryValue[] };

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
export type UrlInput<P extends string> = (NeedsInput<P> extends true
  ? { params: UrlParams<P> }
  : { params?: UrlParams<P> | undefined }) & {
  query?: UrlQuery | undefined;
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

/** Whether a param pattern accepts a value; `unusable` when it is not a `RegExp` at all (Hono refuses such a route). */
type PatternAnswer = "accepts" | "rejects" | "unusable";

/**
 * Matches a param's pattern against `value` the way Hono matches a param: anchored and with no flags, the pattern in
 * a group. Hono's trie router builds `new RegExp("^" + pattern + "$")` (and `"^" + pattern + "(?=/next)"` when a
 * static segment follows); its RegExp router inlines the same source into one anchored `RegExp`. Both run on the raw
 * path, where `%2F` is still an escape (Hono's `getPath` decodes with `decodeURI`, which keeps it).
 */
function matchPattern(pattern: string, value: string): PatternAnswer {
  try {
    return new RegExp(`^(?:${pattern})$`).test(value) ? "accepts" : "rejects";
  } catch {
    return "unusable";
  }
}

/**
 * Encodes one param value: the whole value by default, so a `/` is `%2F` and a value like `admin/all` cannot pick the
 * static `admin/all` sibling route. Only a value with a `/` that its pattern rejects in that form is examined per
 * segment: its empty and `.`/`..` segments are refused, as `:file{.+/.+}` (a literal `/`, where `%2F` would 404)
 * needs a real split, and the split is used when the pattern matches it. A pattern that matches neither form (the
 * value cannot reach the route) and an unusable pattern keep the encoded value, so it 404s as one segment instead of
 * becoming another route's path.
 */
function encodeParam(name: string, text: string, path: string, pattern: string | undefined): string {
  const encoded = encodeValue(name, text, path);
  // without a "/" in the value both forms are the same string: only a "/" (sent as %2F) can change which route matches
  if (pattern === undefined || !text.includes("/") || matchPattern(pattern, encoded) !== "rejects") return encoded;
  const perSegment = encodePerSegment(name, text, path);
  return matchPattern(pattern, perSegment) === "accepts" ? perSegment : encoded;
}

/**
 * A value of a param whose pattern rejects its encoded form: each "/" stays a path separator, and every other
 * character is encoded per segment. An empty segment, or one that is exactly "." or "..", would add a segment or be
 * resolved as a dot segment, so it is refused; the diagnostic names the param, never the value.
 */
function encodePerSegment(name: string, text: string, path: string): string {
  let out = "";
  for (const [index, segment] of text.split("/").entries()) {
    if (segment === "") fail(`buildUrl: param "${name}" for "${path}" has an empty segment`);
    if (segment === "." || segment === "..") {
      fail(`buildUrl: param "${name}" for "${path}" has a "." or ".." segment (a dot segment)`);
    }
    if (index > 0) out += "/";
    out += encodeValue(name, segment, path);
  }
  return out;
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
      out += encodeParam(name, text, path, pattern);
    }
    i = j;
  }
  // an absent optional first segment ("/:a?//x") must not leave "//x", which URL parsing reads as another host
  if (leavesOrigin(out)) fail(`buildUrl: "${path}" builds "${out}", which a URL reads as another host`);
  return out || "/";
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
 *   missing required param throws; an absent optional one drops its segment. When the param's pattern rejects the
 *   encoded value (it needs a literal `/`, as `:file{.+/.+}` does: `%2F` would 404), the value is split on `/` and each
 *   segment is encoded, refusing an empty, `.` or `..` segment; the split is used when the pattern matches it, so its
 *   segments then become path segments. A `*` segment throws: there is no value to fill it with.
 * - A param value of exactly `.` or `..` throws: it would survive encoding and be resolved as a dot segment.
 * - A result that URL parsing reads as another host throws (`"//x"` from an absent optional first param in `"/:a?//x"`).
 * - Query: flat values only. `undefined` and `null` are skipped, an array repeats its key, a `Date` is sent as ISO 8601.
 *   A nested object, a function or a symbol throws.
 */
export function buildUrl<P extends string>(
  path: P,
  ...[input]: NeedsInput<P> extends true ? [input: UrlInput<P>] : [input?: UrlInput<P>]
): string {
  if (typeof path !== "string") fail(`buildUrl: path must be a string, got ${typeof path}`);
  const params: unknown = input?.params;
  if (params != null && typeof params !== "object") fail(`buildUrl: params must be an object, got ${typeof params}`);
  const query: unknown = input?.query;
  if (query != null && typeof query !== "object") fail(`buildUrl: query must be an object, got ${typeof query}`);
  const url = fillPath(path, (params ?? {}) as Readonly<Record<string, unknown>>);
  // the object check above is the runtime half of `UrlQuery`: `serializeQuery` refuses a value that is not flat
  const search = query == null ? "" : serializeQuery(query as UrlQuery);
  return search ? `${url}?${search}` : url;
}

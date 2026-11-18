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

/**
 * Whether one regex atom (a character class or a two-character escape) matches a "/". An atom that is not a standalone
 * regex, or that the `u` flag refuses (a hex or Unicode escape written as `\x2F`, a property escape, a backreference),
 * is treated as able to match "/" (the conservative answer: it only searches a value for a "/", the pattern is the
 * route's own).
 */
const atomMatchesSlash = (source: string): boolean => {
  try {
    return new RegExp(`^(?:${source})$`, "u").test("/");
  } catch {
    return true;
  }
};

/**
 * Whether a param's regex pattern can match a "/" (Hono matches it against the raw path, so `:file{.+/.+}` and
 * `:file{.+}` both read a value that holds "/"). The pattern is read atom by atom: a literal "/" and `.` (any
 * character) can, a character class or one-character escape is checked with `RegExp`, and an escape whose text is
 * longer than one character (hex, Unicode, property, backreference) is treated as able to. Atoms of a lookahead count
 * too, which can only over-approximate: whether the value reaches the route is Hono's match to make, not `buildUrl`'s.
 */
function patternCanMatchSlash(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "/" || char === ".") return true;
    if (char === "\\") {
      const next = pattern[i + 1];
      // an escape longer than two characters, or a backreference: never guess, take the conservative answer
      if (next === undefined || /[xupPk1-9]/.test(next)) return true;
      if (atomMatchesSlash(`\\${next}`)) return true;
      i++;
      continue;
    }
    if (char === "[") {
      let end = i + 1;
      // a "]" right after "[" or "[^" is a member of the class, not its end
      if (pattern[end] === "^") end++;
      if (pattern[end] === "]") end++;
      while (end < pattern.length) {
        if (pattern[end] === "\\") {
          end += 2;
          continue;
        }
        if (pattern[end] === "]") break;
        end++;
      }
      if (atomMatchesSlash(pattern.slice(i, end + 1))) return true;
      i = end;
    }
  }
  return false;
}

/** Encodes one param value; `encodeURIComponent` throws on an unpaired surrogate, which gets a diagnostic (never the value). */
function encodeParam(name: string, text: string, path: string): string {
  try {
    return encodeURIComponent(text);
  } catch {
    return fail(`buildUrl: param "${name}" for "${path}" has an unpaired surrogate`);
  }
}

/**
 * A value of a param whose pattern can match "/": each "/" stays a path separator, and every other character is
 * encoded per segment. An empty segment, or one that is exactly "." or "..", would add a segment or be resolved as a
 * dot segment, so it is refused; the diagnostic names the param, never the value.
 */
function encodePerSegment(name: string, text: string, path: string): string {
  let out = "";
  for (const [index, segment] of text.split("/").entries()) {
    if (segment === "") fail(`buildUrl: param "${name}" for "${path}" has an empty segment`);
    if (segment === "." || segment === "..") {
      fail(`buildUrl: param "${name}" for "${path}" has a "." or ".." segment (a dot segment)`);
    }
    if (index > 0) out += "/";
    out += encodeParam(name, segment, path);
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
      // a param whose pattern can match "/" keeps its "/" as separators, each segment encoded on its own
      out +=
        pattern !== undefined && text.includes("/") && patternCanMatchSlash(pattern)
          ? encodePerSegment(name, text, path)
          : encodeParam(name, text, path);
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
 * - Param values are a `string` or a finite `number`, encoded with `encodeURIComponent`. A missing required param throws; an
 *   absent optional one drops its segment. A param whose regex pattern can match `/` (`:file{.+/.+}`, `:file{.+}`) keeps
 *   its `/` as separators with each segment encoded on its own, and refuses an empty, `.` or `..` segment. A `*`
 *   segment throws: there is no value to fill it with.
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

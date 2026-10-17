import type { PathParams } from "./path";

/** Param values for a path: each key of `PathParams<P>` takes a string or a number (optional keys stay optional). */
export type UrlParams<P extends string> = string extends P
  ? Record<string, string | number>
  : { [K in keyof PathParams<P>]: string | number };

/** `params` is required when the path has a required param. */
export type UrlInput<P extends string> = ({} extends PathParams<P> ? { params?: UrlParams<P> | undefined } : { params: UrlParams<P> }) & {
  query?: object | undefined;
};

const fail = (message: string): never => {
  throw new TypeError(`[@laratype/contract] ${message}`);
};

/** Replaces each `:name`, `:name?` and `:name{regex}` segment (Hono syntax, see `PathParams`). */
function fillPath(path: string, params: Readonly<Record<string, unknown>>): string {
  let out = "";
  let i = 0;
  while (i < path.length) {
    if (path[i] !== ":" || (i > 0 && path[i - 1] !== "/")) {
      out += path[i++];
      continue;
    }
    let j = i + 1;
    while (j < path.length && !"/{?".includes(path[j]!)) j++;
    const name = path.slice(i + 1, j);
    if (name === "") {
      out += path[i++];
      continue;
    }
    // the regex pattern may hold "/" and nested braces ("{2,3}")
    if (path[j] === "{") {
      for (let depth = 0; j < path.length; j++) {
        if (path[j] === "{") depth++;
        else if (path[j] === "}" && --depth === 0) {
          j++;
          break;
        }
      }
    }
    const optional = path[j] === "?";
    if (optional) j++;
    const value = params[name];
    if (value === undefined || value === null || value === "") {
      if (!optional) fail(`buildUrl: missing param "${name}" for "${path}"`);
      // an absent optional param drops its whole segment
      if (out.endsWith("/")) out = out.slice(0, -1);
    } else {
      const text = String(value);
      // encodeURIComponent keeps dots, and URL parsing (fetch) resolves a dot segment: "/api/users/.." → "/api"
      if (text === "." || text === "..") fail(`buildUrl: param "${name}" for "${path}" cannot be "${text}" (a dot segment)`);
      out += encodeURIComponent(text);
    }
    i = j;
  }
  return out || "/";
}

function serializeQuery(query: object): string {
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
 * - Param values are encoded with `encodeURIComponent`. A missing required param throws; an absent optional one drops its segment.
 * - A param value of exactly `.` or `..` throws: it would survive encoding and be resolved as a dot segment.
 * - Query: `undefined` and `null` are skipped, an array repeats its key, a `Date` is sent as ISO 8601.
 */
export function buildUrl<P extends string>(
  path: P,
  ...[input]: {} extends PathParams<P> ? [input?: UrlInput<P>] : [input: UrlInput<P>]
): string {
  const url = fillPath(path, (input?.params ?? {}) as Readonly<Record<string, unknown>>);
  const search = input?.query ? serializeQuery(input.query) : "";
  return search ? `${url}?${search}` : url;
}

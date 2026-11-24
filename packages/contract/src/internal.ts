// Helpers shared by the contract modules. Three are re-exported from index.ts, all marked `@internal`, so they are not
// part of the documented public API: `isEndpointPath`, the endpoint path rule `@laratype/client` validates each manifest
// path with, and `leavesOrigin`/`isAbsoluteUrl`, the origin and baseUrl rules it follows (C11 #293).

export type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/** `"201"` → `201`: builds status unions from template strings. */
export type ToNumber<S> = S extends `${infer N extends number}` ? N : never;

/** An error status, 400 to 599: what `defineError`, `ContractError` and `throws` accept. */
export const isFailureStatus = (status: unknown): status is number =>
  Number.isInteger(status) && (status as number) >= 400 && (status as number) <= 599;

/** Throws the package's TypeError: `[@laratype/contract] <message>`. */
export const fail = (message: string): never => {
  throw new TypeError(`[@laratype/contract] ${message}`);
};

/** One leading "/" (not "//" or "/\") and no control character: the endpoint path rule. */
const PATH_START = /^\/(?![/\\])/;
/** The control characters a path must not contain (C0 controls and DEL). */
const PATH_CONTROLS = /[\u0000-\u001f\u007f]/;

/**
 * The endpoint path rule without a diagnostic: no leading "//" or "/\\", no control character.
 * @internal Shared with `@laratype/client`'s manifest validation; not part of the documented public API.
 */
export const isEndpointPath = (path: unknown): path is string =>
  typeof path === "string" && PATH_START.test(path) && !PATH_CONTROLS.test(path);

/**
 * Whether `value` is a plain object: a `null` prototype or any realm's `Object.prototype` (an iframe's or a vm's too),
 * so an array, a `Map`, a `Set`, a `Date` or a class instance is not one. A realm's `Object.prototype` is the root of its
 * chain and has its own `hasOwnProperty`; a bare null-prototype object used as a prototype is not it. A proxy whose
 * `getPrototypeOf` throws is not one either, so its error never replaces the caller's diagnostic.
 */
export const isPlainObject = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  try {
    const prototype: object | null = Object.getPrototypeOf(value as object);
    return prototype === null || (Object.getPrototypeOf(prototype) === null && Object.prototype.hasOwnProperty.call(prototype, "hasOwnProperty"));
  } catch {
    return false;
  }
};

/**
 * An endpoint path starts with one "/": the client appends it to `baseUrl`, so `":tenant/x"` could extend the host, and
 * under a same-origin `baseUrl` a `"//evil.com"` (or `"/\evil.com"`, `"/\t/evil.com"`, as URL parsing reads them) is another host.
 */
export const checkPath = (path: unknown, label: string): string => {
  if (typeof path !== "string" || !PATH_START.test(path)) {
    fail(`${label}: the path must start with one "/", got ${typeof path === "string" ? JSON.stringify(path) : typeof path}`);
  }
  // URL parsing drops tab, LF and CR: "/\t/evil.com" is "//evil.com"; the other control characters are refused with them
  if (PATH_CONTROLS.test(path as string)) fail(`${label}: the path must not contain control characters, got ${JSON.stringify(path)}`);
  return path as string;
};

/** `fetch` refuses a body on GET, so such an endpoint could never be called. */
export const NO_GET_BODY = "a GET endpoint cannot have a body";

/**
 * The control-character set of the origin rule: C0 controls and space, which URL parsing drops from the start of a
 * relative URL (`" http://x"` is `http://x`).
 */
const C0_AND_SPACE = "\\u0000-\\u0020";
/** Tab, LF and CR, the controls of that set URL parsing drops anywhere (`"/\t/evil.com"` is `"//evil.com"`). */
const DROPPED_CONTROLS = "\\t\\n\\r";
const LEADING_CONTROLS = new RegExp(`^[${C0_AND_SPACE}]+`);
const ANY_CONTROLS = new RegExp(`[${DROPPED_CONTROLS}]`, "g");

/** A scheme at the start of a URL, the one scheme regex of the origin rule and the client's absolute-baseUrl test. */
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

/**
 * Whether URL parsing reads `path` as another host or as another URL, without `URL` (string work only): it drops a
 * leading run of C0 controls and spaces and every tab, LF and CR, and reads `\` as `/`. Then `//x` is a host, and a
 * leading `scheme:` is another URL (`http:/x` is another host from an https page; `javascript:` is not a path at all).
 *
 * This is the one origin rule: `buildUrl` runs it on the pathname it builds, and `@laratype/client` on the joined
 * pathname and on a path `baseUrl` (C11 [#293](https://github.com/Laratypes/Laratype/issues/293)). It covers every
 * input the former URL-based client check refused: a relative path either stays below a leading `/` after that
 * normalization, or starts with `//` (an invalid host included) or a scheme.
 *
 * @internal
 */
export const leavesOrigin = (path: string): boolean => {
  const parsed = path.replace(LEADING_CONTROLS, "").replace(ANY_CONTROLS, "").replace(/\\/g, "/");
  return parsed.startsWith("//") || URL_SCHEME.test(parsed);
};

/**
 * Whether `value` is written as an absolute URL: a scheme and `//` (`https://…`), decided on the raw string. So
 * `localhost:3000/api` and `http:/evil.com` are not absolute, and `HTTPS://…` is. Shares the one scheme regex with
 * `leavesOrigin`.
 *
 * @internal
 */
export const isAbsoluteUrl = (value: string): boolean => {
  const scheme = URL_SCHEME.exec(value);
  return scheme !== null && value.startsWith("//", scheme[0].length);
};

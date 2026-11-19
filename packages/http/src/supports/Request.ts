import type { Context, Hono, MiddlewareHandler } from "hono";
import type { GetConnInfo } from "hono/conninfo";
import { HonoRequest } from "hono/request";
import type { InferOut, StandardSchemaV1 } from "@laratype/contract";
import type { RequestInterface } from "../contracts/Request";
import { isNil, omit, pick } from "es-toolkit"
import { has } from "es-toolkit/compat"
import { normalizeIp } from "./ip";

/**
 * `Authorization: Bearer <token>` (RFC 6750 §2.1): the scheme ignores case (RFC 9110 §11.1), the token is a b64token,
 * the same grammar as Hono's `bearerAuth`.
 */
const BEARER = /^Bearer +([A-Za-z0-9._~+/-]+=*) *$/i

/**
 * The key of the Hono context `RequestKernel.handle` attaches to the request after building it: `ip()` reads the
 * connection from it. A symbol, so a request class's own fields and constructor can't clash with it or drop it.
 */
export const HONO_CONTEXT = Symbol.for("laratype.http.honoContext")

/**
 * The context variable `mountConnInfo`'s middleware stores its capture under (what its `getConnInfo` answered when the
 * middleware ran), or, from an older copy of @laratype/http, the getter itself. A `Symbol.for` key, so the middleware
 * and `ip()` agree across two copies of the package (CJS and ESM), even when the adapter loaded one copy and the app
 * the other.
 */
const CONN_INFO: unique symbol = Symbol.for("laratype.http.connInfo")

/**
 * The middlewares `mountConnInfo` mounted on an app, so a second mount is still accepted while a mount after anything
 * else is refused (the capture has to run before a middleware can await). A `Symbol.for` key like `CONN_INFO`, for the
 * same two-copies reason.
 */
const CONN_INFO_MOUNTS: unique symbol = Symbol.for("laratype.http.connInfoMounts")

/**
 * The brand of the default `rules()`: the kernel skips validation for a request class that doesn't override it. A
 * `Symbol.for` key, so it holds across two copies of @laratype/http (CJS and ESM), where prototype identity fails.
 */
export const DEFAULT_RULES: unique symbol = Symbol.for("laratype.http.defaultRules");

/** The context methods `mountConnInfo` and `clientIp` use with the symbol key, which Hono's string-keyed types omit. */
type ConnInfoContext = { get(key: symbol): unknown, set(key: symbol, value: unknown): void }

/** What `mountConnInfo`'s middleware stores when it runs: `ConnInfoSource` for the request that ran it. */
type CapturedConnInfo = { readonly registered: true, readonly address: string | undefined }

/** What `mountConnInfo`'s `getConnInfo` answered, normalized: `remote.address` when it is a connection info object. */
const readAddress = (ctx: Context, getConnInfo: GetConnInfo): string | undefined => {
  try {
    const info: unknown = getConnInfo(ctx);
    const address = typeof info === "object" && info !== null
      ? (info as { remote?: { address?: unknown } }).remote?.address
      : undefined;
    return normalizeIp(address)
  }
  catch {
    return undefined
  }
}

/**
 * Mounts the serving adapter's `getConnInfo` (docs/v1/http.md › Request.ip()): `sauf`'s node entry and `sauf dev`
 * mount the node server's, a Bun entry `hono/bun`'s. The middleware runs before the routes and captures the address
 * once, synchronously, so a client that resets its connection during a later `await` still has its address counted by
 * the rate limit. Mount it before any route or middleware that can await; a late mount is refused, because the lazy
 * read after that await is exactly what loses the address of a reset connection.
 */
export const mountConnInfo = (app: Hono, getConnInfo: GetConnInfo): void => {
  if (typeof getConnInfo !== "function") {
    throw new TypeError(`[@laratype/http] mountConnInfo(): expected the runtime's getConnInfo(context) function, got ${typeof getConnInfo}`)
  }
  if (typeof (app as { use?: unknown } | undefined)?.use !== "function") {
    throw new TypeError(`[@laratype/http] mountConnInfo(): expected a Hono app, got ${app === null ? "null" : typeof app}`)
  }
  const mounted = app as Hono & { [CONN_INFO_MOUNTS]?: readonly MiddlewareHandler[] }
  const previous = mounted[CONN_INFO_MOUNTS] ?? []
  // Hono runs a middleware registered after a route only after that route, and after an earlier middleware: the capture
  // would run after its await. Our own earlier mounts are fine, so mounting twice stays harmless.
  const routes = Array.isArray(app.routes) ? app.routes : []
  const late = routes.filter((route) => !previous.includes(route.handler))
  if (late.length > 0) {
    throw new Error(`[@laratype/http] mountConnInfo(): call it before any route or middleware, so the address is captured before one can await; the app already has ${late.length} route${late.length === 1 ? "" : "s"} or middleware`)
  }
  const middleware: MiddlewareHandler = async (ctx, next) => {
    const captured: CapturedConnInfo = { registered: true, address: readAddress(ctx, getConnInfo) }
    ;(ctx as unknown as ConnInfoContext).set(CONN_INFO, captured)
    await next()
  }
  app.use("*", middleware)
  mounted[CONN_INFO_MOUNTS] = [...previous, middleware]
}

/**
 * What the serving adapter's `getConnInfo` answered (A5 #288, H30 #299): whether one is registered at all, and the
 * client address it found. `registered: false` is the app-wiring gap the rate limit warns about once per process; a
 * registered getter that finds no address (a unix socket, a gone connection) is a per-request fact.
 */
export type ConnInfoSource =
  | { readonly registered: false, readonly address: undefined }
  | { readonly registered: true, readonly address: string | undefined }

/** Whether `value` is the capture `mountConnInfo`'s middleware stores, rather than a getter an older copy stored. */
const isCaptured = (value: unknown): value is CapturedConnInfo =>
  typeof value === "object" && value !== null && (value as { registered?: unknown }).registered === true

/**
 * The client address `request.ip()` answers, read from what `mountConnInfo`'s middleware captured when it ran (A5
 * #288, H30 #299), or `undefined` when no middleware ran or the getter found no address. The getter is not called
 * again: after an `await` a reset connection has no address left to read. The one lazy path left is a getter an older
 * copy of the package stored itself, for a request whose app never ran this copy's middleware; a getter that throws or
 * answers no address is no address either, and never fails the request.
 */
export const connInfoSource = (ctx: Context | undefined): ConnInfoSource => {
  if (ctx === undefined) return { registered: false, address: undefined };
  const stored = (ctx as unknown as Partial<ConnInfoContext>).get?.(CONN_INFO)
  if (typeof stored === "function") return { registered: true, address: readAddress(ctx, stored as GetConnInfo) }
  if (isCaptured(stored)) return { registered: true, address: normalizeIp(stored.address) }
  return { registered: false, address: undefined };
}

/** The address `ip()` answers: `connInfoSource(ctx).address`, `undefined` for every reason it can be unknown. */
export const clientIp = (ctx: Context | undefined): string | undefined => connInfoSource(ctx).address

export default class Request implements RequestInterface {

  protected requestCtx: HonoRequest

  constructor(requestCtx: HonoRequest) {
    this.requestCtx = requestCtx
  }

  protocol() {
    return new URL(this.requestCtx.url).protocol
  }

  rules(): unknown {
    return {}
  }

  // TODO: Make it type safe
  param(key?: string) {
    if(isNil(key)) {
      return this.requestCtx.param() as any
    }
    return this.requestCtx.param(key as never)
  }
  
  // TODO: Make it type safe
  input(keys?: string[] | string) {
    const input = this.requestCtx.input;
    if(!isNil(keys)) {
      if(keys instanceof Array) {
        return pick(input, keys);
      }
      return input[keys as never]
    }
    return input
  }

  all(): Record<string, any> {
    return {
      ...this.query(),
      ...this.input(),
    }
  }

  /** The token of an `Authorization: Bearer` header, or `""` when there is none or it is malformed. */
  bearerToken(): string {
    return BEARER.exec(this.requestCtx.header("Authorization") ?? "")?.[1] ?? ""
  }

  except(keys: string[]): Record<string, any> {
    return omit(this.all(), keys);
  }

  has(keys: string | string[]): boolean {
    if(keys instanceof Array) {
      return keys.every(key => has(this.all(), key))
    }

    return has(this.all(), keys)
  }

  hasAny(keys: string[]): boolean {
    return keys.length ? keys.some(key => has(this.all(), key)) : true;
  }

  hasHeader(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.headers(), key.toLowerCase())
  }

  header(key: string, defaultVal?: string): string | undefined {
    return this.hasHeader(key) ? this.headers()[key.toLowerCase()] : defaultVal
  }

  headers() {
    return this.requestCtx.header()
  }

  /**
   * The client address of the socket `mountConnInfo`'s `getConnInfo` read when its middleware ran (docs/v1/http.md ›
   * Request.ip()), or `undefined` when no adapter mounted one (an in-process `app.request()`, another runtime) or the
   * socket is gone. It never reads `X-Forwarded-For` or `X-Real-IP`: behind a proxy, this is the proxy's address until
   * the trusted-proxy setting ([#320](https://github.com/Laratypes/Laratype/issues/320)) names the proxies.
   */
  ip(): string | undefined {
    return clientIp((this as { [HONO_CONTEXT]?: Context })[HONO_CONTEXT])
  }

  isMethod(method: string): boolean {
    return this.method() === method
  }

  only(keys: string[]): Record<string, any> {
    return pick(this.all(), keys)
  }

  path(): string {
    return this.requestCtx.path
  }

  query(key?: string, defaultVal?: any) {
    if(!isNil(key)) {
      return this.requestCtx.query(key) ?? defaultVal
    }
    return this.requestCtx.query()
  }

  url(): string {
    return this.requestCtx.url
  }

  method(): string {
    return this.requestCtx.method;
  }

  /** The output of the `rules()` schema, any Standard Schema (zod, valibot, ...): coerced and defaulted values. */
  validated(): ReturnType<this['rules']> extends StandardSchemaV1 ? InferOut<ReturnType<this['rules']>> : any {
    return {} as never
  }

}

Object.defineProperty(Request.prototype.rules, DEFAULT_RULES, { value: true });
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
 * The context variable the serving adapter's middleware stores its runtime's `getConnInfo` under. A `Symbol.for` key,
 * so the middleware and `ip()` agree across two copies of @laratype/http (CJS and ESM), even when the adapter loaded
 * one copy and the app the other.
 */
const CONN_INFO: unique symbol = Symbol.for("laratype.http.connInfo")

/**
 * The brand of the default `rules()`: the kernel skips validation for a request class that doesn't override it. A
 * `Symbol.for` key, so it holds across two copies of @laratype/http (CJS and ESM), where prototype identity fails.
 */
export const DEFAULT_RULES: unique symbol = Symbol.for("laratype.http.defaultRules");

/** The context methods `mountConnInfo` and `clientIp` use with the symbol key, which Hono's string-keyed types omit. */
type ConnInfoContext = { get(key: symbol): unknown, set(key: symbol, value: GetConnInfo): void }

/**
 * Mounts the serving adapter's `getConnInfo` (docs/v1/http.md › Request.ip()): `sauf`'s node entry and `sauf dev`
 * mount the node server's, a Bun entry `hono/bun`'s. The middleware runs before the routes, so `ip()` and the rate
 * limit find the getter on the context; without it `ip()` answers `undefined`, never a guess from the runtime's env.
 */
export const mountConnInfo = (app: Hono, getConnInfo: GetConnInfo): void => {
  if (typeof getConnInfo !== "function") {
    throw new TypeError(`[@laratype/http] mountConnInfo(): expected the runtime's getConnInfo(context) function, got ${typeof getConnInfo}`)
  }
  if (typeof (app as { use?: unknown } | undefined)?.use !== "function") {
    throw new TypeError(`[@laratype/http] mountConnInfo(): expected a Hono app, got ${app === null ? "null" : typeof app}`)
  }
  const middleware: MiddlewareHandler = async (ctx, next) => {
    (ctx as unknown as ConnInfoContext).set(CONN_INFO, getConnInfo)
    await next()
  }
  app.use("*", middleware)
}

/**
 * What the serving adapter's `getConnInfo` answered (A5 #288, H30 #299): whether one is registered at all, and the
 * client address it found. `registered: false` is the app-wiring gap the rate limit warns about once per process; a
 * registered getter that finds no address (a unix socket, a gone connection) is a per-request fact and logs nothing.
 */
export type ConnInfoSource =
  | { readonly registered: false, readonly address: undefined }
  | { readonly registered: true, readonly address: string | undefined }

/**
 * The client address `request.ip()` answers, read from the getConnInfo the serving adapter registered on the context
 * (A5 #288, H30 #299), or `undefined` when none is registered or it has no address. A getConnInfo that throws (a Bun
 * server's `requestIP()` answering null, a socket gone) is no address either: it never fails the request.
 */
export const connInfoSource = (ctx: Context | undefined): ConnInfoSource => {
  if (ctx === undefined) return { registered: false, address: undefined };
  const getConnInfo = (ctx as unknown as Partial<ConnInfoContext>).get?.(CONN_INFO)
  if (typeof getConnInfo !== "function") return { registered: false, address: undefined };
  try {
    const info: unknown = getConnInfo(ctx);
    const address = typeof info === "object" && info !== null
      ? (info as { remote?: { address?: unknown } }).remote?.address
      : undefined;
    return { registered: true, address: normalizeIp(address) }
  }
  catch {
    return { registered: true, address: undefined }
  }
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
   * The client address of the socket the serving adapter's `getConnInfo` reads (docs/v1/http.md › Request.ip()), or
   * `undefined` when no adapter registered one (an in-process `app.request()`, another runtime) or the socket is gone.
   * It never reads `X-Forwarded-For` or `X-Real-IP`: behind a proxy, this is the proxy's address until the trusted-proxy
   * setting ([#320](https://github.com/Laratypes/Laratype/issues/320)) names the proxies.
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
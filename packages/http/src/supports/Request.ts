import type { Context } from "hono";
import { HonoRequest } from "hono/request";
import { getConnInfo as getNodeConnInfo } from "@hono/node-server/conninfo";
import { z, ZodType } from "zod";
import type { RequestInterface } from "../contracts/Request";
import { isNil, omit, pick } from "es-toolkit"
import { has } from "es-toolkit/compat"

/**
 * `Authorization: Bearer <token>` (RFC 6750 §2.1): the scheme ignores case (RFC 9110 §11.1), the token is a b64token,
 * the same grammar as Hono's `bearerAuth`.
 */
const BEARER = /^Bearer +([A-Za-z0-9._~+/-]+=*) *$/i

/** What `ip()` reads of the adapter's env: Node's `incoming` request, or Bun's `Server.requestIP`. */
type AdapterEnv = { incoming?: { socket?: unknown }, requestIP?: (request: globalThis.Request) => { address: string } | null }

export default class Request implements RequestInterface {

  protected requestCtx: HonoRequest

  /** The Hono context of the request, when the kernel built this request: `ip()` reads the connection from it. */
  declare protected readonly honoCtx?: Context

  constructor(requestCtx: HonoRequest, honoCtx?: Context) {
    this.requestCtx = requestCtx
    // Non-enumerable, so logging or serializing the request doesn't walk Node's socket
    Object.defineProperty(this, "honoCtx", { value: honoCtx, writable: false, enumerable: false, configurable: false })
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
   * The client address of the connection on the Node and Bun adapters, or `""` when there is no socket to read (an
   * in-process `app.request()`, another runtime). It never reads `X-Forwarded-For`: behind a proxy, this is the proxy's
   * address.
   */
  ip(): string {
    const ctx = this.honoCtx
    if(!ctx?.env) {
      return ""
    }
    // The adapter's env, or `env.server` when it wraps it: the same pick as Hono's getConnInfo for Node and Bun
    const env = ctx.env as AdapterEnv & { server?: AdapterEnv }
    const bindings = env.server || env
    // Node passes `{ incoming, outgoing }`, its IncomingMessage carries the socket
    if(bindings.incoming?.socket) {
      return getNodeConnInfo(ctx).remote.address ?? ""
    }
    // Bun passes its server. `hono/bun`'s getConnInfo makes the same call, but `hono/bun` reads `Bun` on import
    if(typeof bindings.requestIP === "function") {
      return bindings.requestIP(ctx.req.raw)?.address ?? ""
    }
    return ""
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

  validated(): z.infer<ReturnType<typeof this['rules']> extends ZodType ? ReturnType<typeof this['rules']>: ZodType> {
    return {}
  }

}
import { HonoRequest } from "@laratype/support";
import { z, ZodType } from "zod";
import { RequestInterface } from "../contracts/Request";
import { isNil, omit, pick } from "es-toolkit"
import { has } from "es-toolkit/compat"

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

  bearerToken(): string {
    return ""
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

  ip(): string {
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
    return {} as any
  }

}
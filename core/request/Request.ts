import { Context, HonoRequest } from "hono";
import FormValidation from "../validation/form/FormValidation";
import RequestInterface from "../contracts/RequestInterface";

export default class Request implements RequestInterface {

  protected requestCtx: HonoRequest

  constructor(requestCtx: HonoRequest) {
    this.requestCtx = requestCtx
  }

  rules(): Record<string, any> {
    return {}
  }

  //TODO: Make it type safe
  params(): Record<string, string> {
    return this.requestCtx.param() as any
  }

  // TODO: Make it type safe
  param(key: string): string {
    return this.requestCtx.param(key as never)
  }

  all(): Record<string, any> {
    return {}
  }

  bearerToken(): string {
    return ""
  }

  except(key: string[]): Record<string, any> {
    return []
  }

  has(key: string, defaultVal: string): boolean;
  has(keys: string[]): boolean;
  has(key: unknown, defaultVal?: unknown): boolean {
    return true
  }

  hasAny(keys: string[]): boolean {
    return true
  }

  hasHeader(hasHeader: string): boolean {
    return true
  }

  header(key: string): string;
  header(key: string, defaultVal: string): string;
  header(key: unknown, defaultVal?: unknown): string {
    return ""
  }

  ip(): string {
    return ""
  }

  isMethod(method: string): boolean {
    return true
  }

  only(key: string[]): Record<string, any> {
    return []
  }

  path(): string {
    return ""
  }

  query(): Record<string, any>;
  query(key: string): Record<string, any>;
  query(key: string, defaultVal: string): Record<string, any>;
  query(key?: unknown, defaultVal?: unknown): Record<string, any> {
    return {}
  }

  url(): string {
    return ""
  }

  validate(): Record<string, any> {
    return {}
  }

}
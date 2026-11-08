import type { RedirectStatusCode, StatusCode } from "hono/utils/http-status";
import type ResponseInterface from "../contracts/Response"
import { GeneralTypesEnum } from "@laratype/support";
import JsonResource from "../resource/json/JsonResource";

/**
 * A value with a JSON shape: an array (a subclass too), or an object whose prototype is `Object.prototype` or `null`
 * (the groups a form body's dot keys build, `parseBody({ dot: true })`). Read with `Object.getPrototypeOf`, never
 * with `value.constructor`: an own `constructor` key of the value is data, not its type (H45 #342). es-toolkit's
 * `isPlainObject` is wider (it takes an object whose prototype has none), so the check is written here
 */
const isJsonShape = (value: unknown): boolean => {
  if (Array.isArray(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export default class Response implements ResponseInterface {
  
  protected httpStatusCode?: StatusCode;
  protected headers: Record<string, string>;
  protected content: any;
  protected redirectUrl?: string;
  protected redirectStatusCode: RedirectStatusCode = 302;

  constructor(content: any, httpStatusCode?: StatusCode, headers = {}) {
    this.httpStatusCode = httpStatusCode;
    this.headers = headers;
    this.content = content;
  }
  redirect(url: string, httpStatusCode: RedirectStatusCode = 302) {
    this.redirectUrl = url;
    this.redirectStatusCode = httpStatusCode
    return this
  }

  setContent(content: string) {
    this.content = content;
    return this
  }

  setContentType(contentType: string) {
    this.headers["Content-Type"] = contentType;
    return this;
  }

  setHttpStatus(httpStatusCode: StatusCode) {
    this.httpStatusCode = httpStatusCode;
    return this;
  }

  setHeader(key: string, value: string) {
    this.headers[key] = value;
    return this;
  }

  setHeaders(headers: Record<string, string>) {
    this.headers = headers;
    return this
  }

  getHttpStatus() {
    return this.httpStatusCode;
  }

  getHeaders(): Record<string, string> {
    return this.headers;
  }

  getContent(): any {
    return this.content;
  }

  getRedirectUrl(): string | undefined {
    return this.redirectUrl;
  }

  getContentType(): string {
    return this.headers["Content-Type"];
  }

  getStatusCode() {
    return this.httpStatusCode;
  }

  getRedirectStatusCode(): RedirectStatusCode {
    return this.redirectStatusCode;
  }

  /**
   * The class of the content when it is a 0.5 model (its `dataSource`), else `undefined`. No content (a middleware's
   * `new Response(null, 401)`) is not a model. The class is read from the prototype chain: an own `constructor` key of
   * the value is data, not the class it is an instance of (H45 #342)
   */
  isModel() {
    if (this.content === null || typeof this.content !== "object") return undefined;
    return Object.getPrototypeOf(this.content)?.constructor?.dataSource;
  }

  /**
   * Whether the 0.5 response sends the content as JSON. A string is the HTML body, and how a string return is sent is
   * #336; every other value is JSON: a model, a `JsonResource`, and the shapes detected by prototype — an array (a
   * subclass too), an object whose prototype is `Object.prototype` or `null`, a form body's groups — as well as a value
   * of another prototype (a Date, a class instance), whose JSON text must never go out as text/html. The value's
   * `constructor` property is never read: it is data (H45 #342). The non-string rule is the widest, so it is the one
   * that decides; the shape, model and `JsonResource` clauses before it are what make each kind a JSON body on its own
   */
  public shouldBeJson(): boolean {
    const jsonShape = this.isModel() || this.content instanceof JsonResource || isJsonShape(this.content);
    return Boolean(jsonShape || ResponseSerialization.isJsonBody(this.content));
  }
  
}

export class ResponseSerialization {

  public static jsonSerialize(data: any) {
    return JsonResource.toJson(data) as {};
  }

  /**
   * Whether the content is a JSON body: a 0.5 response sends a string as the HTML body (#336 decides string returns)
   * and every other value as JSON (H45 #342)
   */
  public static isJsonBody(data: unknown): boolean {
    return data !== undefined && data !== null && typeof data !== "string";
  }

  /**
   * The HTML body: the string itself, or an empty one. A value with JSON text is sent as `application/json` by
   * `resolveResponse`, so `JSON.stringify` output is never labelled `text/html` (H45 #342)
   */
  public static htmlSerialize(data?: unknown): string {
    if(typeof data === "string") return data
    return GeneralTypesEnum.NOTHING
  }
}
import { RedirectStatusCode, StatusCode } from "hono/utils/http-status";
import ResponseInterface from "../contracts/Response"
import { GeneralTypesEnum } from "@laratype/support";
import JsonResource from "../resource/json/JsonResource";

// export default class Response {

//   public response(ctx: Context, payload: unknown, httpStatusCode: StatusCode) {
//     if(payload === undefined || payload === null) return ctx.html(GeneralTypesEnum.NOTHING)
//     if(payload.constructor === Array || payload.constructor === Object) {
//       return ctx.json(payload)
//     }
//     if(payload.constructor === String) return ctx.html(payload, httpStatusCode)
//     return ctx.html(JSON.stringify(payload), httpStatusCode)
//   }

//   public responseSuccess(ctx: Context, payload: unknown, httpStatusCode: StatusCode = 200) {
//     return this.response(ctx, payload, httpStatusCode)
//   }

//   public responseError(ctx: Context, payload: unknown, httpStatusCode: StatusCode = 500) {
//     return this.response(ctx, payload, httpStatusCode);
//   }
  
// }


export default class Response implements ResponseInterface {
  
  protected httpStatusCode: StatusCode;
  protected headers: Record<string, string>;
  protected content: any;
  protected redirectUrl?: string;
  protected redirectStatusCode: RedirectStatusCode = 302;

  constructor(content: any, httpStatusCode: StatusCode = 200, headers = {}) {
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

  getHttpStatus(): StatusCode {
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

  getStatusCode(): number {
    return this.httpStatusCode;
  }

  getRedirectStatusCode(): RedirectStatusCode {
    return this.redirectStatusCode;
  }

  isModel() {
    return this.content.constructor && this.content.constructor.dataSource;
  }

  public shouldBeJson() {
    
    return this.isModel() || this.content instanceof JsonResource || this.content.constructor === Array || this.content.constructor === Object;
  }
  
}

export class ResponseSerialization {

  public static jsonSerialize(data: any) {
    return JsonResource.toJson(data) as {};
  }

  public static htmlSerialize(data?: any): string {
    if(data === undefined || data === null) return GeneralTypesEnum.NOTHING
    if(typeof data === "string") return data
    return JSON.stringify(data)
  }
}
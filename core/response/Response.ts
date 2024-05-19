import { Context } from "hono";
import { StatusCode } from "hono/utils/http-status";

export default class Response {

  public response(ctx: Context, payload: unknown, httpStatusCode: StatusCode) {
    if(typeof payload === "string") {
      return ctx.html(payload)
    }
    return ctx.json(payload, httpStatusCode)
  }

  public responseSuccess(ctx: Context, payload: unknown, httpStatusCode: StatusCode = 200) {
    return this.response(ctx, payload, httpStatusCode)
  }

  public responseError(ctx: Context, payload: unknown, httpStatusCode: StatusCode = 500) {
    return this.response(ctx, payload, httpStatusCode);
  }
  
}
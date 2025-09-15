import { Context } from "hono";
import ResponseSupport, { ResponseSerialization } from "../supports/Response";
import { Exception, GeneralTypesEnum, ContentTypeEnum, AppServiceProvider } from "@laratype/support";
import { ContentfulStatusCode } from "hono/utils/http-status";

export default class Response extends AppServiceProvider {


  public resolveResponse(response: Context) {
    // 
  }

  protected static setHeaders(ctx: Context) {
    return (name: string, value: string) => ctx.header(name, value)
  }

  public static resolveResponse(ctx: Context, response: any | undefined) {
    let responseObj
    if(response instanceof ResponseSupport) {
      responseObj = response;
    }
    else responseObj = new ResponseSupport(response ?? GeneralTypesEnum.NOTHING)

    const redirectUrl = responseObj.getRedirectUrl()
    if(redirectUrl) {
      return ctx.redirect(redirectUrl, responseObj.getRedirectStatusCode());
    }
    const headers = responseObj.getHeaders()
    const setHeader = this.setHeaders(ctx)
    
    for (const key in headers) {
      setHeader(key, headers[key])
    }

    const isJson = responseObj.shouldBeJson()
    if(isJson) {
      setHeader("Content-Type", ContentTypeEnum.JSON)
    }

    const contentType = responseObj.getContentType()
    if(contentType) {
      setHeader("Content-Type", contentType)
    }

    //TODO: Make guard check
    const contentFullStatusCode = responseObj.getHttpStatus() as ContentfulStatusCode;

    if(isJson) {
      return ctx.json(ResponseSerialization.jsonSerialize(responseObj.getContent()), contentFullStatusCode)
    }

    return ctx.html(ResponseSerialization.htmlSerialize(responseObj.getContent()), contentFullStatusCode)

  }

  public resolveException(err: Error | Exception, c: Context) {
    console.error(err);
    //@ts-ignore
    if(err.canResponsible?.()) {
      //TODO: Response exception with HTML
      //@ts-ignore
      if(err instanceof Exception) {
        const response = new ResponseSupport(err.toJson(), err.getHttpCode())
        return Response.resolveResponse(c, response)
      }
    }
    if(!(err instanceof Exception)) {
      new Exception({
        message: err.message,
        code: "UNKNOWN",
        httpCode: 500,
        responsible: false,
        reportable: true,
      })
    }
    return Response.resolveResponse(c, new ResponseSupport("Something went wrong!", 500))
  }

  public boot(): void {
    this.apps.use(async (ctx, next) => {
      this.resolveResponse(ctx);
      return next();
    });

    this.apps.onError(this.resolveException)
  }
}
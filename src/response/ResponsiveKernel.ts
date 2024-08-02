import { Context } from "hono";
import ServiceProvider from "../support/ServiceProvider";
import Exception from "../exception/Exception";
import Response from "./Response";
import ContentTypeEnum from "../enum/ContentTypeEnum";
import ResponseSerialization from "../support/ResponseSerialization";
import GeneralTypesEnum from "../enum/GeneralTypesEnum";
import Collection from "../resource/json/ResourceCollection";

export default class ResponseKernel extends ServiceProvider {
  public resolveResponse(response: Context) {
    // 
  }

  protected static setHeaders(ctx: Context) {
    return (name: string, value: string) => ctx.header(name, value)
  }

  public static resolveResponse(ctx: Context, response: any | undefined) {
    let responseObj
    if(response instanceof Response) {
      responseObj = response;
    }
    else responseObj = new Response(response ?? GeneralTypesEnum.NOTHING)

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

    if(isJson) {
      return ctx.json(ResponseSerialization.jsonSerialize(responseObj.getContent()), responseObj.getHttpStatus())
    }

    return ctx.html(ResponseSerialization.htmlSerialize(responseObj.getContent()), responseObj.getHttpStatus())

  }

  public resolveException(err: Error | Exception, c: Context) {
    console.error(err);
    //@ts-ignore
    if(err.canResponsible?.()) {
      //TODO: Response exception with HTML
      //@ts-ignore
      const response = new Response(err.toJson(), 500)
      return ResponseKernel.resolveResponse(c, response)
    }
    return ResponseKernel.resolveResponse(c, "Something went wrong!")
  }

  public boot(): void {
    this.apps.use(async (ctx, next) => {
      this.resolveResponse(ctx);
      return next();
    });

    this.apps.onError(this.resolveException)
  }
}
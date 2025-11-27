import { Context } from "hono";
import ResponseSupport, { ResponseSerialization } from "../supports/Response";
import { Exception, GeneralTypesEnum, ContentTypeEnum, AppServiceProvider, MetaDataKey } from "@laratype/support";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { RouteParams } from "../contracts";
import { ControllerMethodHttpStatusCode } from "../request/Request";

export default class Response extends AppServiceProvider {


  public resolveResponse(response: Context) {
    // 
  }

  protected static setHeaders(ctx: Context) {
    return (name: string, value: string) => ctx.header(name, value)
  }

  protected static guessHttpStatusCode(response: ResponseSupport, routeOption?: RouteParams): ContentfulStatusCode & 204 {
    let contentFullStatusCode = response.getHttpStatus();

    if(!contentFullStatusCode && routeOption?.controller) {
      const [controllerClass, controllerMethodName] = routeOption.controller;
      
      const statusCodeFromMetadata = Reflect.getMetadata(MetaDataKey.CONTROLLER_STATUS_CODE, controllerClass.prototype, controllerMethodName)
      
      if(statusCodeFromMetadata) {
        contentFullStatusCode = statusCodeFromMetadata;
      }
      else {
        // Guess status code from controller method
        contentFullStatusCode = ControllerMethodHttpStatusCode[controllerMethodName as keyof typeof ControllerMethodHttpStatusCode];
      }
    }

    // Default to 200
    contentFullStatusCode ??= 200;

    return contentFullStatusCode as ContentfulStatusCode & 204;
  }

  public static resolveResponse(ctx: Context, response?: any, routeOption?: RouteParams) {
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

    const contentFullStatusCode = this.guessHttpStatusCode(responseObj, routeOption);

    if(contentFullStatusCode === 204) {
      return ctx.body(null, 204);
    }

    if(isJson) {
      return ctx.json(ResponseSerialization.jsonSerialize(responseObj.getContent()), contentFullStatusCode)
    }

    return ctx.html(ResponseSerialization.htmlSerialize(responseObj.getContent()), contentFullStatusCode)

  }

  public resolveException(err: Error | Exception, c: Context) {
    // @ts-ignore
    if(err.reportable) {
      console.error(err);
    }
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
      const unknownException = new Exception({
        message: err.message,
        code: "UNKNOWN",
        httpCode: 500,
        responsible: false,
        reportable: true,
      });
      return Response.resolveResponse(c, unknownException.toJson())
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
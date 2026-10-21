import type { Context } from "hono";
import ResponseSupport, { ResponseSerialization } from "../supports/Response";
import { Exception, GeneralTypesEnum, ContentTypeEnum, AppServiceProvider, MetaDataKey } from "@laratype/support";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HTTPException } from "hono/http-exception";
import type { RouteParams } from "../contracts";
import { isBodylessStatus } from "@laratype/contract";
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

    // A contract route's status comes from its endpoint (`.response(schema, status)`), never from the method name
    if(!contentFullStatusCode && routeOption?.status) {
      contentFullStatusCode = routeOption.status as ContentfulStatusCode;
    }

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

    // 204 and 205 never carry a body (a contract endpoint may declare either with .status(n))
    if(isBodylessStatus(contentFullStatusCode)) {
      return ctx.body(null, contentFullStatusCode as 204);
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
    // Hono's own errors (basicAuth 401, bodyLimit 413, ...) carry their response
    if(err instanceof HTTPException) {
      return err.getResponse()
    }
    if(!(err instanceof Exception)) {
      // An unknown error (#267): logged on the server only
      console.error(err);
    }
    // An explicit 500 that no route or controller status overrides, with the generic body of
    // docs/v1/http.md › Exceptions: no code, message, name or stack (#267)
    return Response.resolveResponse(c, new ResponseSupport({ message: "Server Error" }, 500))
  }

  public boot(): void {
    this.apps.use(async (ctx, next) => {
      this.resolveResponse(ctx);
      return next();
    });

    this.apps.onError(this.resolveException)
  }
}
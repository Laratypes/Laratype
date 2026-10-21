import type { Context } from "hono";
import ResponseSupport, { ResponseSerialization } from "../supports/Response";
import { Exception, GeneralTypesEnum, ContentTypeEnum, AppServiceProvider, MetaDataKey } from "@laratype/support";
import type { ContentfulStatusCode, StatusCode } from "hono/utils/http-status";
import type { RouteParams } from "../contracts";
import { isBodylessStatus } from "@laratype/contract";
import { ControllerMethodHttpStatusCode } from "../request/Request";

const isErrorStatus = (status: unknown) => Number.isInteger(status) && (status as number) >= 400 && (status as number) <= 599;

/**
 * Hono's `HTTPException` (basicAuth 401, bodyLimit 413, ...), duck-typed as Hono's own error handler does: hono is a
 * peer dependency, so the app may hold another copy of the class. Only an error status (400-599) whose `getResponse()`
 * gives a fetch `Response` with an error status too counts: anything else (a NestJS-style object, a status 999, a 200
 * response) is an unknown error. The status is the response's, the one actually sent (#272)
 */
const asHttpError = (err: unknown): { status: StatusCode; response: globalThis.Response } | undefined => {
  const candidate = err as { status?: unknown; getResponse?: unknown } | null;
  const status = candidate?.status;
  if (typeof candidate?.getResponse !== "function" || !isErrorStatus(status)) {
    return undefined;
  }
  try {
    const response: unknown = candidate.getResponse();
    return response instanceof globalThis.Response && isErrorStatus(response.status)
      ? { status: response.status as StatusCode, response }
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Headers set before the throw that no error response carries (#272): a failed request sets no cookie, and no cache
 * keeps or revalidates an error. Cache-Control is replaced by `no-store`
 */
const DROPPED_ERROR_HEADERS = ["Set-Cookie", "ETag", "Last-Modified", "Expires"];

/** The headers of an HTTP error's own response that its generic 5xx keeps (#272); the rest, body included, is dropped */
const KEPT_5XX_HEADERS = ["Retry-After", "WWW-Authenticate"];

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
    const responsible = err instanceof Exception && err.canResponsible() ? err : undefined;
    const httpError = responsible ? undefined : asHttpError(err);
    // A responsible Exception and an HTTP error keep their status; anything else is an unknown error, a 500
    const status = responsible ? responsible.getHttpCode() : httpError ? httpError.status : 500;

    // On the context, not only on the response built below: Hono merges the context's headers into the error response
    // (#272). The other headers set before the throw (CORS, Vary) stay
    for (const name of DROPPED_ERROR_HEADERS) {
      c.header(name, undefined);
    }
    c.header("Cache-Control", "no-store");

    // resolveException logs each error once: a reportable one, or any error that ends as a 5xx (#267). The Exception
    // constructor's own log of reportable Exceptions is separate, tracked in #273
    if ((err as { reportable?: unknown }).reportable || status >= 500) {
      console.error(err);
    }
    // A 5xx never carries the error's own message, code or stack, whatever threw it (#267): an explicit status that
    // no route or controller status overrides, with the generic body of docs/v1/http.md › Exceptions
    if (status >= 500) {
      const kept: Record<string, string> = {};
      for (const name of KEPT_5XX_HEADERS) {
        const value = httpError?.response.headers.get(name);
        if (value != null) kept[name] = value;
      }
      return Response.resolveResponse(c, new ResponseSupport({ message: "Server Error" }, status as StatusCode, kept));
    }
    if (httpError) {
      // Through the context, as Hono's own error handler does, so headers set by middleware (CORS, Vary) stay. The
      // error's own headers are set on purpose and stay too, but an error is never cached
      return c.newResponse(httpError.response.body, httpError.response, { "Cache-Control": "no-store" });
    }
    //TODO: Response exception with HTML
    return Response.resolveResponse(c, new ResponseSupport(responsible!.toJson(), status));
  }

  public boot(): void {
    this.apps.use(async (ctx, next) => {
      this.resolveResponse(ctx);
      return next();
    });

    this.apps.onError(this.resolveException)
  }
}
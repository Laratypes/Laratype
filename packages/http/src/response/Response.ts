import type { Context } from "hono";
import ResponseSupport, { ResponseSerialization } from "../supports/Response";
import { GeneralTypesEnum, ContentTypeEnum, AppServiceProvider, MetaDataKey, isException } from "@laratype/support";
import type { Exception } from "@laratype/support";
import type { ContentfulStatusCode, StatusCode } from "hono/utils/http-status";
import type { RouteParams } from "../contracts";
import { isBodylessStatus, isContractError } from "@laratype/contract";
import { ControllerMethodHttpStatusCode } from "../request/Request";

/**
 * Hono's `HTTPException` (basicAuth 401, bodyLimit 413, ...), duck-typed as Hono's own error handler does: hono is a
 * peer dependency, so the app may hold another copy of the class. Only an error status (400-599) whose `getResponse()`
 * gives a fetch `Response` counts: anything else (a NestJS-style object, a status 999) is an unknown error.
 */
const asHttpError = (err: unknown): { status: StatusCode; response: globalThis.Response } | undefined => {
  const candidate = err as { status?: unknown; getResponse?: unknown } | null;
  const status = candidate?.status;
  if (typeof candidate?.getResponse !== "function" || !Number.isInteger(status) || (status as number) < 400 || (status as number) > 599) {
    return undefined;
  }
  try {
    const response: unknown = candidate.getResponse();
    return response instanceof globalThis.Response ? { status: status as StatusCode, response } : undefined;
  } catch {
    return undefined;
  }
};

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

  /**
   * The exception filter (docs/v1/http.md › Exceptions). A contract error (`defineError`, the `errors` catalog) and a
   * responsible `Exception` are told by their brand, not `instanceof`, so one from another copy of their package counts
   */
  public resolveException(err: Error | Exception, c: Context) {
    const declared = isContractError(err) ? err : undefined;
    const responsible = !declared && isException(err) && err.canResponsible() ? err : undefined;
    const httpError = declared || responsible ? undefined : asHttpError(err);
    // A contract error, a responsible Exception and an HTTP error keep their status; anything else is an unknown
    // error, a 500
    const status = declared ? declared.status as StatusCode : responsible ? responsible.getHttpCode() : httpError ? httpError.status : 500;

    // A contract error is a declared answer: its own status and `{ code, ...body }`, a 5xx too, whatever the route's or
    // controller's status. It is expected, so it is not logged (#108)
    if (declared) {
      return c.json({ code: declared.code, ...declared.body }, status as ContentfulStatusCode);
    }

    // resolveException logs each error once: a reportable one, or any error that ends as a 5xx (#267). The Exception
    // constructor's own log of reportable Exceptions is separate, tracked in #273
    if ((err as { reportable?: unknown }).reportable || status >= 500) {
      console.error(err);
    }
    // A 5xx never carries the error's own message, code or stack, whatever threw it (#267): an explicit status that
    // no route or controller status overrides, with the generic body of docs/v1/http.md › Exceptions
    if (status >= 500) {
      return Response.resolveResponse(c, new ResponseSupport({ message: "Server Error" }, status as StatusCode));
    }
    if (httpError) {
      // Through the context, as Hono's own error handler does, so headers set by middleware (CORS, Vary) stay
      return c.newResponse(httpError.response.body, httpError.response);
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

    // Hono's onError only sees an `Error`: a `throw "x"` or `throw {}` leaves `fetch`, and each adapter answers it its
    // own way (Node an empty 500, Bun's dev error page). The app's fetch answers anything that leaves it with the
    // generic 500 and logs it (#108). Wrapped here, not with a middleware: ResponseKernel boots after the routes, and
    // the adapters read `fetch` once the app is booted
    const fetch = this.apps.fetch;
    this.apps.fetch = async (...args) => {
      try {
        return await fetch(...args);
      }
      catch (err) {
        console.error(err);
        return new globalThis.Response(JSON.stringify({ message: "Server Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
    };
  }
}
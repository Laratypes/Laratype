import type { Context } from "hono";
import ResponseSupport, { ResponseSerialization } from "../supports/Response";
import { GeneralTypesEnum, ContentTypeEnum, AppServiceProvider, MetaDataKey, isException } from "@laratype/support";
import type { Exception } from "@laratype/support";
import type { ContentfulStatusCode, StatusCode } from "hono/utils/http-status";
import type { RouteParams } from "../contracts";
import { isBodylessStatus, isContractError } from "@laratype/contract";
import { ControllerMethodHttpStatusCode } from "../request/Request";
import { BODY_HEADERS } from "./bodyHeaders";

const isErrorStatus = (status: unknown): status is number => Number.isInteger(status) && (status as number) >= 400 && (status as number) <= 599;

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
 * Headers that no error response carries, whether set before the throw or on an HTTP error's own response (#272): a
 * failed request sets no cookie, and no cache (CDN-targeted ones included) keeps or revalidates an error.
 * Cache-Control is replaced by `no-store`
 */
const DROPPED_ERROR_HEADERS = [
  "Set-Cookie", "ETag", "Last-Modified", "Expires", "CDN-Cache-Control", "Cloudflare-CDN-Cache-Control", "Surrogate-Control",
];

/** Drops the headers no error response carries and sets `Cache-Control: no-store` (#272) */
const scrubErrorHeaders = (headers: Headers) => {
  for (const name of DROPPED_ERROR_HEADERS) {
    headers.delete(name);
  }
  headers.set("Cache-Control", "no-store");
};

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

    if(!contentFullStatusCode && routeOption?.controller) {
      const [controllerClass, controllerMethodName] = routeOption.controller;
      
      const statusCodeFromMetadata = Reflect.getMetadata(MetaDataKey.CONTROLLER_STATUS_CODE, controllerClass.prototype, controllerMethodName)
      
      if(statusCodeFromMetadata) {
        contentFullStatusCode = statusCodeFromMetadata;
      }
      else {
        // 0.5 routes only: a Route.api route's status is its endpoint's (contractResponse.ts, H4 #107)
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

    // 204, 205 and 304 never carry a body
    if(isBodylessStatus(contentFullStatusCode) || contentFullStatusCode === 304) {
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
    // On the context, not only on the response built below: Hono merges the context's headers into the error response
    // (#272). The other headers set before the throw (CORS, Vary) stay. A context finalized before the throw holds a
    // response whose body may be read already, and whose headers may be immutable: the error starts from a copy of
    // its headers only (Hono's `res` setter merges the old ones into it, mutable)
    if (c.finalized) {
      c.res = new globalThis.Response(null, { headers: c.res.headers });
    }
    // c.res.headers is the context's only header store from Hono 4.8 on, the peer floor: before 4.8, a second store
    // put back the headers deleted here (#281 security review)
    for (const name of BODY_HEADERS) {
      c.res.headers.delete(name);
    }
    scrubErrorHeaders(c.res.headers);

    // A contract error is a declared answer: its own status and `{ code, ...body }`, a 5xx too, whatever the route's or
    // controller's status. It is expected, so it is not logged (#108)
    if (isContractError(err)) {
      try {
        // A body's own `toJSON` would replace `{ code, ...body }` at serialization, and a declared `code` could go
        // with it, so the top level drops it. A nested one is the body's own JSON shape and stays. The copy is in
        // here too: a body getter can throw, and that is an unserializable body like a BigInt or a cycle
        const json: { code: string; toJSON?: unknown } = { code: err.code, ...err.body };
        if (typeof json.toJSON === "function") {
          delete json.toJSON;
        }
        return c.json(json, err.status as ContentfulStatusCode);
      }
      catch (failure) {
        // A body JSON can't hold (a BigInt, a cycle, a getter that throws): the generic 500, with the error logged
        console.error(err, failure);
        return c.json({ message: "Server Error" }, 500);
      }
    }

    const responsible = isException(err) && err.canResponsible() ? err : undefined;
    const httpError = responsible ? undefined : asHttpError(err);
    // A responsible Exception and an HTTP error keep their status; anything else is an unknown error, a 500
    const status = responsible ? responsible.getHttpCode() : httpError ? httpError.status : 500;

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
      // error's own headers are set on purpose and stay too, but they never set a cookie or cache the error either
      const headers = new Headers(httpError.response.headers);
      scrubErrorHeaders(headers);
      return c.newResponse(httpError.response.body, { status: httpError.status, headers });
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
    const serverError = (err: unknown) => {
      console.error(err);
      return new globalThis.Response(JSON.stringify({ message: "Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    };
    // Not async: a response Hono returns synchronously stays synchronous
    this.apps.fetch = (...args) => {
      try {
        const response = fetch(...args);
        return typeof (response as Partial<PromiseLike<unknown>>).then === "function" ? Promise.resolve(response).catch(serverError) : response;
      }
      catch (err) {
        return serverError(err);
      }
    };
  }
}
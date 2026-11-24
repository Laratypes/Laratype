import type { Context, Hono, MiddlewareHandler } from "hono";
import ResponseSupport, { ResponseSerialization } from "../supports/Response";
import { GeneralTypesEnum, ContentTypeEnum, AppServiceProvider, MetaDataKey, isException } from "@laratype/support";
import type { Exception } from "@laratype/support";
import type { ContentfulStatusCode, StatusCode } from "hono/utils/http-status";
import type { KernelRouteParams } from "../contracts";
import { isContractError, isFailureStatus } from "@laratype/contract";
import { ControllerMethodHttpStatusCode } from "../request/Request";
import { BODY_HEADERS, REDIRECT_HEADERS, isBodyHeader, isRedirectHeader } from "./bodyHeaders";
import { isBodylessResponse } from "./bodyless";
import { quietLog } from "./undeclaredError";

/** The type a returned string is sent as (H41 #336): HTML needs an explicit `Response` content type. */
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

/**
 * The `Content-Type` a `Response` sets, whatever the case of its name (headers are case-insensitive, RFC 9110 §5.1), or
 * `undefined`: an explicit one is kept for a string body, so a handler can opt into HTML (H41 #336). An own key only
 * (an inherited one must not opt a string into HTML), the last spelling wins as the header loop below sets it, and a
 * value that is not a string is no type at all: the loop below stringifies it, so reading it as one would throw
 */
const explicitContentType = (headers: Record<string, string>): string | undefined => {
  let contentType: string | undefined;
  for (const name in headers) {
    if (!Object.hasOwn(headers, name) || name.toLowerCase() !== "content-type") continue;
    const value: unknown = headers[name];
    contentType = typeof value === "string" ? value : undefined;
  }
  return contentType;
};

/**
 * Hono's `HTTPException` (basicAuth 401, bodyLimit 413, ...), duck-typed as Hono's own error handler does: hono is a
 * peer dependency, so the app may hold another copy of the class. Only an error status (400-599) whose `getResponse()`
 * gives a fetch `Response` with an error status too counts: anything else (a NestJS-style object, a status 999, a 200
 * response) is an unknown error. The status is the response's, the one actually sent (#272)
 */
const asHttpError = (err: unknown): { status: StatusCode; response: globalThis.Response } | undefined => {
  const candidate = err as { status?: unknown; getResponse?: unknown } | null;
  const status = candidate?.status;
  if (typeof candidate?.getResponse !== "function" || !isFailureStatus(status)) {
    return undefined;
  }
  try {
    const response: unknown = candidate.getResponse();
    return response instanceof globalThis.Response && isFailureStatus(response.status)
      ? { status: response.status as StatusCode, response }
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Headers that no error response carries, whether set before the throw or on an HTTP error's own response (#272): a
 * failed request sets no cookie, and no cache (CDN-targeted ones included) keeps or revalidates an error. The vendor
 * headers are what proxies and CDNs read before `Cache-Control` (H29 #295), and the offload ones make the server send a
 * file in place of the error body. The outermost scrub reads this list, so it drops one a middleware sets after
 * `await next()` too (H29 #388). Cache-Control is replaced by `no-store`; the `Set-Cookie` values that expire a cookie
 * are kept (H29 #295). Exported for the test that asserts every entry
 */
export const DROPPED_ERROR_HEADERS = [
  "Set-Cookie", "ETag", "Last-Modified", "Expires", "Age", "Surrogate-Key", "Cache-Tag", "CDN-Cache-Control",
  "Cloudflare-CDN-Cache-Control", "Surrogate-Control", "X-Accel-Expires", "Vercel-CDN-Cache-Control",
  "Netlify-CDN-Cache-Control", "Edge-Control", "X-Accel-Redirect", "X-Sendfile", "X-Sendfile-Temporary", "X-Sendfile2",
  "X-Reproxy-URL", "X-Lighttpd-Send-File", "X-LiteSpeed-Location",
];

/** The context's header store loses the body and redirect headers too: an error re-serializes its own body (#272) */
const CONTEXT_ERROR_HEADERS = [...BODY_HEADERS, ...REDIRECT_HEADERS, ...DROPPED_ERROR_HEADERS];

/** The month names of an IMF-fixdate, indexed as `Date` does */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** RFC 9110 §5.6.7 IMF-fixdate: the only `Expires` shape an error response keeps (H29 #295) */
const IMF_FIXDATE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;

/** A `Max-Age` value RFC 6265 §5.2 reads as an integer */
const MAX_AGE = /^-?\d+$/;

/**
 * The time an IMF-fixdate names, or `undefined` when the shape, the calendar date or the year is not one. The
 * components are checked on a `Date` rather than handed to `Date.parse`, which V8 lets through shapes RFC 6265 does
 * not, and rolls a day that does not exist (a 31 February) into the next month (H29 #295). RFC 6265 §5.1.1 makes a
 * cookie-date year 1601 or later, and a browser ignores an `Expires` before it (§5.2.1), so it is no expiry either
 */
const imfFixdate = (value: string) => {
  const match = IMF_FIXDATE.exec(value);
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = MONTHS.indexOf(match[2]);
  const year = Number(match[3]);
  if (year < 1601) return undefined;
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = Number(match[6]);
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hours, minutes, seconds, 0);
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day
    && date.getUTCHours() === hours && date.getUTCMinutes() === minutes && date.getUTCSeconds() === seconds;
  return valid ? date.getTime() : undefined;
};

/**
 * Whether a `Set-Cookie` expires its cookie, the only kind an error response keeps (H29 #295): `Max-Age` 0 or less
 * when there is one, or else every `Expires` a strict IMF-fixdate in the past (RFC 6265 §5.3: a `Max-Age` wins over
 * `Expires`). RFC 6265 ignores a `Max-Age` that is not an integer and reads `Expires` with the browser's cookie-date
 * parser, which disagrees with V8's `Date.parse`, so a malformed one drops the cookie instead. Attribute names are
 * case-insensitive, and when duplicates disagree, every one has to expire the cookie
 */
const isExpiringCookie = (cookie: string) => {
  const attributes = new Map<string, string[]>();
  // The first field is the cookie-pair itself: the scanner starts after it, so a cookie named `Max-Age` is data
  for (const field of cookie.split(";").slice(1)) {
    const separator = field.indexOf("=");
    const name = (separator === -1 ? field : field.slice(0, separator)).trim().toLowerCase();
    if (!name) continue;
    const value = separator === -1 ? "" : field.slice(separator + 1).trim();
    attributes.set(name, [...(attributes.get(name) ?? []), value]);
  }
  const maxAges = attributes.get("max-age");
  if (maxAges) {
    return maxAges.every((value) => MAX_AGE.test(value) && Number(value) <= 0);
  }
  const expires = attributes.get("expires");
  if (!expires) {
    return false;
  }
  const now = Date.now();
  return expires.every((value) => {
    const time = imfFixdate(value);
    return time !== undefined && time <= now;
  });
};

/**
 * Drops the headers no error response carries and sets `Cache-Control: no-store` (#272), keeping only the cookies
 * that expire one (H29 #295). `names` adds the body headers for the context's store, never for a response sent as it is
 */
const scrubErrorHeaders = (headers: Headers, names: readonly string[] = DROPPED_ERROR_HEADERS) => {
  const cookies = headers.getSetCookie().filter(isExpiringCookie);
  for (const name of names) {
    headers.delete(name);
  }
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  headers.set("Cache-Control", "no-store");
};

/** A status the platform can send: an integer from 200 to 599, the fetch `Response` range. Not a 1xx, a string, a bigint */
const isHttpStatus = (value: unknown): value is StatusCode =>
  typeof value === "number" && Number.isInteger(value) && value >= 200 && value <= 599;

/** The statuses a redirect sends (RFC 9110 §15.4) */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** A status value as a diagnostic names it, without calling app code (a `toString` can throw) */
const describeValue = (value: unknown): string =>
  typeof value === "string" ? JSON.stringify(value)
    : typeof value === "number" || typeof value === "bigint" ? String(value)
      : value === null ? "null" : typeof value;

/**
 * A status a 0.5 `Response` cannot send: a server bug, refused instead of answered as 200 with the handler's body
 * (H32 #312). The throw is the filter's unknown error: the generic 500, logged, with the handler's body, cookie and
 * cache headers dropped
 */
const refuseStatus = (value: unknown): never => {
  throw new TypeError(`[@laratype/http] the response status ${describeValue(value)} cannot be sent: use an integer from 200 to 599`);
};

/** A redirect status a 0.5 `Response` cannot send: `ctx.redirect()` would answer 200 on it (H32 #312) */
const refuseRedirectStatus = (value: unknown): never => {
  throw new TypeError(`[@laratype/http] the redirect status ${describeValue(value)} cannot be sent: use 301, 302, 303, 307 or 308`);
};

/**
 * The status a responsible `Exception` sends: its own when it is one the platform can send, else 500. A string, a
 * bigint, `NaN`, `Infinity`, a negative number, 99 or 600 used to answer 200 with the generic body (H32 #312)
 */
const exceptionStatus = (exception: Exception): StatusCode => {
  const status = exception.getHttpCode();
  return isHttpStatus(status) ? status : 500;
};

/** The headers of an HTTP error's own response that its generic 5xx keeps (#272); the rest, body included, is dropped */
const KEPT_5XX_HEADERS = new Set(["retry-after", "www-authenticate"]);

/** Cancels a body no response sends, so an upstream fetch releases its socket (H29 #295); a failed cancel is ignored */
const cancelBody = (body: ReadableStream | null | undefined) => {
  body?.cancel().catch(() => {});
};

/** The error's own answer, kept so the outermost scrub can put it back when a middleware replaces it (H29 #295) */
const errorResponses = new WeakMap<Context, globalThis.Response>();

const scrubInstalled = new WeakSet<Hono>();

/**
 * Registers the outermost scrub middleware (H29 #295): a middleware that writes headers after `await next()` (a session
 * commit, `etag()`) cannot put back what `resolveException` dropped,
 * and cannot turn the error's answer into a success (`etag()` answers a 304). It is registered in `register()` and
 * `boot()`: the app providers mount their routes in `boot()`, and Hono only runs a middleware added before the route it
 * wraps, so a boot after the routes would be too late
 */
const installErrorScrub = (app: Hono) => {
  if (scrubInstalled.has(app)) return;
  scrubInstalled.add(app);
  const scrub: MiddlewareHandler = async (c, next) => {
    // `finally`: a throw out of `next()` (a non-`Error`, whose generic 500 is the fetch wrapper's) must not skip the
    // stored clone's cleanup
    try {
      await next();
    }
    finally {
      const answer = errorResponses.get(c);
      // Taken once: the scrub is the only reader, and an entry no put back uses is cancelled below (H29 #388)
      errorResponses.delete(c);
      if (!c.error) {
        cancelBody(answer?.body);
      }
      else {
        // A middleware answered the error with a non-error response (etag()'s 304): the error's own answer is put back,
        // with every cookie it kept, and the dropped body is cancelled. Any other path cancels the stored clone: a
        // branch no response sends would otherwise queue every chunk the sent branch reads, and keep an upstream body
        // open until GC
        if (answer && !isFailureStatus(c.res.status)) {
          const replaced = c.res;
          const cookies = answer.headers.getSetCookie();
          c.res = answer;
          for (const cookie of cookies) {
            if (!c.res.headers.getSetCookie().includes(cookie)) c.res.headers.append("Set-Cookie", cookie);
          }
          cancelBody(replaced.body);
        }
        else {
          cancelBody(answer?.body);
        }
        scrubErrorHeaders(c.res.headers);
      }
    }
  };
  app.use(scrub);
};

export default class Response extends AppServiceProvider {


  public resolveResponse(response: Context) {
    // 
  }

  protected static setHeaders(ctx: Context) {
    return (name: string, value: string) => ctx.header(name, value)
  }

  protected static guessHttpStatusCode(response: ResponseSupport, routeOption?: KernelRouteParams): ContentfulStatusCode & 204 {
    let contentFullStatusCode = response.getHttpStatus();

    // A handler's explicit status is app data: 0, a string, a bigint, NaN, Infinity, a negative number or 1e9 must not
    // answer 200 with the handler's body (H32 #312). `null` means unset, like `undefined` (0.5 code passes it to set
    // headers only). The decorator and the method-name guess are refused the same way
    if(contentFullStatusCode != null && !isHttpStatus(contentFullStatusCode)) {
      refuseStatus(contentFullStatusCode);
    }

    if(contentFullStatusCode == null && routeOption?.controller) {
      const [controllerClass, controllerMethodName] = routeOption.controller;

      const statusCodeFromMetadata = Reflect.getMetadata(MetaDataKey.CONTROLLER_STATUS_CODE, controllerClass.prototype, controllerMethodName)

      // Present metadata is the decorator's value, even 0 or NaN (refused below): only absent metadata falls back to
      // the method-name guess (H32 #312)
      if(statusCodeFromMetadata != null) {
        contentFullStatusCode = statusCodeFromMetadata;
      }
      else {
        // 0.5 routes only: a Route.api route's status is its endpoint's (contractResponse.ts, H4 #107)
        contentFullStatusCode = ControllerMethodHttpStatusCode[controllerMethodName as keyof typeof ControllerMethodHttpStatusCode];
      }
    }

    // Default to 200
    contentFullStatusCode ??= 200;

    return (isHttpStatus(contentFullStatusCode) ? contentFullStatusCode : refuseStatus(contentFullStatusCode)) as ContentfulStatusCode & 204;
  }

  public static resolveResponse(ctx: Context, response?: any, routeOption?: KernelRouteParams) {
    let responseObj
    if(response instanceof ResponseSupport) {
      responseObj = response;
    }
    else responseObj = new ResponseSupport(response ?? GeneralTypesEnum.NOTHING)

    const redirectUrl = responseObj.getRedirectUrl()
    if(redirectUrl) {
      const redirectStatusCode = responseObj.getRedirectStatusCode();
      // A redirect status the platform cannot send answers 200: refuse it, never redirect on a broken status (H32 #312)
      if(!REDIRECT_STATUSES.has(redirectStatusCode)) {
        refuseRedirectStatus(redirectStatusCode);
      }
      const redirectHeaders = responseObj.getHeaders()
      const setRedirectHeader = this.setHeaders(ctx)

      for (const key in redirectHeaders) {
        // A redirect sends no body (RFC 9110 §15.4), so the body headers describe a body it does not have, and the
        // redirect sets its own Location. The handler's other headers (Set-Cookie, cache, custom) stay (H32 #312)
        if(!Object.hasOwn(redirectHeaders, key) || isBodyHeader(key) || isRedirectHeader(key)) continue;
        setRedirectHeader(key, redirectHeaders[key])
      }
      return ctx.redirect(redirectUrl, redirectStatusCode);
    }
    const headers = responseObj.getHeaders()
    const setHeader = this.setHeaders(ctx)

    for (const key in headers) {
      // Own keys only: a header object's prototype is not a set of headers
      if(!Object.hasOwn(headers, key)) continue;
      setHeader(key, headers[key])
    }

    const content = responseObj.getContent()
    // Every non-string content is JSON, whose text is never sent as text/html: the shapes `shouldBeJson()` detects by
    // prototype, and any other value (H45 #342). A string is text (H41 #336, below)
    const isJson = responseObj.shouldBeJson()
    if(isJson) {
      setHeader("Content-Type", ContentTypeEnum.JSON)
    }

    const contentFullStatusCode = this.guessHttpStatusCode(responseObj, routeOption);

    // A handler-returned 5xx is an error response: the same header scrub a thrown error gets (#272, H32 #312). The
    // context store is scrubbed before the body is built, since Hono merges it into the response this handler returns;
    // a cookie or cache header it kept (a Set-Cookie that expires) reaches the answer through that merge
    if(contentFullStatusCode >= 500) {
      scrubErrorHeaders(ctx.res.headers, CONTEXT_ERROR_HEADERS);
    }
    // The status and body are the handler's: the scrub is about headers only
    const respond = (answer: globalThis.Response) => {
      if(contentFullStatusCode >= 500) scrubErrorHeaders(answer.headers);
      return answer;
    };

    // 204, 205 and 304 never carry a body, so no Content-Type either (H32 #312)
    if(isBodylessResponse(contentFullStatusCode)) {
      const answer = ctx.body(null, contentFullStatusCode as 204);
      answer.headers.delete("Content-Type");
      return respond(answer);
    }

    if(isJson) {
      // JSON is not to be read as another type (H45 #342)
      setHeader("X-Content-Type-Options", "nosniff")
      return respond(ctx.json(ResponseSerialization.jsonSerialize(content), contentFullStatusCode))
    }

    // A returned string is text, never an HTML body (H41 #336): a reflected `<script>` must not run. HTML needs an
    // explicit `Content-Type` on the `Response`, and `nosniff` stops an old browser from sniffing the text as HTML even
    // then; a blank or non-string type is no type, so it takes the default, `nosniff` too
    if(typeof content === "string") {
      const type = explicitContentType(headers)?.trim()
      setHeader("X-Content-Type-Options", "nosniff")
      return respond(ctx.text(content, contentFullStatusCode, { "Content-Type": type || TEXT_CONTENT_TYPE }))
    }

    const answer = ctx.html(ResponseSerialization.htmlSerialize(content), contentFullStatusCode)
    return answer instanceof Promise ? answer.then(respond) : respond(answer)

  }

  /**
   * The exception filter (docs/v1/http.md › Exceptions). A contract error (`defineError`, the `errors` catalog) and a
   * responsible `Exception` are told by their brand, not `instanceof`, so one from another copy of their package counts
   */
  public resolveException(err: Error | Exception, c: Context) {
    /**
     * The answer the outermost scrub puts back if a middleware replaces it (H29 #295). The store keeps a clone: compose
     * wraps the returned response in a new one that shares its body stream, and a middleware's `res.clone()`
     * (`etag()`) tees that stream and locks it, which would make the stored response unusable (`Response body object
     * should not be disturbed or locked`). The clone tees it first, so the stored body is its own readable branch; the
     * scrub cancels that branch when it does not put it back, so nothing is ever queued on it (H29 #388). A second
     * answer for the same context cancels the clone it replaces: Hono calls onError again when a middleware throws
     * after `await next()`, and that clone's branch would otherwise stay open (H29 #388)
     */
    const answer = (response: globalThis.Response | Promise<globalThis.Response>) => {
      if (response instanceof globalThis.Response) {
        cancelBody(errorResponses.get(c)?.body);
        errorResponses.set(c, response.clone());
      }
      return response;
    };
    // On the context, not only on the response built below: Hono merges the context's headers into the error response
    // (#272). The other headers set before the throw (CORS, Vary) stay. A context finalized before the throw holds a
    // response whose body may be read already, and whose headers may be immutable: the error starts from a copy of
    // its headers only (Hono's `res` setter merges the old ones into it, mutable). Its body is no response's any more,
    // so it is cancelled, which releases an upstream fetch's socket (H29 #295)
    if (c.finalized) {
      const finalized = c.res;
      c.res = new globalThis.Response(null, { headers: finalized.headers });
      cancelBody(finalized.body);
    }
    // c.res.headers is the context's only header store from Hono 4.8 on, the peer floor: before 4.8, a second store
    // put back the headers deleted here (#281 security review). One pass: the body headers and the dropped ones
    scrubErrorHeaders(c.res.headers, CONTEXT_ERROR_HEADERS);

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
        return answer(c.json(json, err.status as ContentfulStatusCode));
      }
      catch (failure) {
        // A body JSON can't hold (a BigInt, a cycle, a getter that throws): the generic 500, with the error logged
        quietLog(err, failure);
        return answer(c.json({ message: "Server Error" }, 500));
      }
    }

    const responsible = isException(err) && err.canResponsible() ? err : undefined;
    const httpError = responsible ? undefined : asHttpError(err);
    // A responsible Exception and an HTTP error keep their status; anything else is an unknown error, a 500. An
    // Exception's status is app data: only an integer 200-599 is sent, else the generic 500 (H32 #312)
    const status = responsible ? exceptionStatus(responsible) : httpError ? httpError.status : 500;

    // resolveException logs each error once: a reportable one, or any error that ends as a 5xx (#267). The Exception
    // constructor logs nothing, so a thrown reportable Exception has this one report (#273)
    if ((err as { reportable?: unknown }).reportable || status >= 500) {
      quietLog(err);
    }
    // A 5xx never carries the error's own message, code or stack, whatever threw it (#267): an explicit status that
    // no route or controller status overrides, with the generic body of docs/v1/http.md › Exceptions
    if (status >= 500) {
      const kept: Array<[string, string]> = [];
      if (httpError) {
        // The kept headers are read one entry at a time: `headers.get` would join several `WWW-Authenticate` challenges
        // into one value, and the error's own ones win over a `c.header()` one set before the throw (H29 #295)
        for (const [name, value] of httpError.response.headers) {
          if (KEPT_5XX_HEADERS.has(name.toLowerCase())) kept.push([name, value]);
        }
        for (const [name] of kept) c.res.headers.delete(name);
        // The error's own body is not sent, so its stream is cancelled (H29 #295)
        cancelBody(httpError.response.body);
      }
      const response = Response.resolveResponse(c, new ResponseSupport({ message: "Server Error" }, status as StatusCode));
      // The generic body is JSON, so this is a Response; the type also covers `ctx.html`'s promise
      const withKept = (built: globalThis.Response) => {
        for (const [name, value] of kept) built.headers.append(name, value);
        return built;
      };
      return answer(response instanceof Promise ? response.then(withKept) : withKept(response));
    }
    if (httpError) {
      // Through the context, as Hono's own error handler does, so headers set by middleware (CORS, Vary) stay. The
      // error's own headers are set on purpose and stay too, but they never set a cookie or cache the error either
      const headers = new Headers(httpError.response.headers);
      scrubErrorHeaders(headers);
      // Hono's `res` setter merges the context's headers back over the response: the ones the error's own response sets
      // win here (a `WWW-Authenticate` or `Retry-After` set before the throw must not replace it, H29 #295), and both
      // sets of kept cookies survive the setter's set-cookie branch
      const cookies = [...new Set([...c.res.headers.getSetCookie(), ...headers.getSetCookie()])];
      for (const name of headers.keys()) {
        c.res.headers.delete(name);
      }
      c.res.headers.delete("Set-Cookie");
      for (const cookie of cookies) {
        c.res.headers.append("Set-Cookie", cookie);
      }
      return answer(c.newResponse(httpError.response.body, { status: httpError.status, headers }));
    }
    //TODO: Response exception with HTML
    // A responsible Exception's body is app code: a toJson() that throws, or a body JSON cannot hold, keeps the
    // exception's own status with the generic body instead of losing it to the filter's own failure (H32 #312). The
    // failure is logged with the error: that is a server bug, not a client one
    try {
      const body = responsible!.toJson();
      return answer(Response.resolveResponse(c, new ResponseSupport(body, status as StatusCode)));
    }
    catch (failure) {
      quietLog(err, failure);
      return answer(Response.resolveResponse(c, new ResponseSupport({ message: "Server Error" }, status as StatusCode)));
    }
  }

  /**
   * Installs the outermost error scrub before the app providers boot their routes (H29 #295): Hono only runs a
   * middleware added before the route it wraps, and this kernel boots after them
   */
  public register(): void {
    installErrorScrub(this.apps);
  }

  public boot(): void {
    // First: the outermost middleware scrubs what a later middleware writes after `await next()` (H29 #295). A direct
    // boot (tests, an app that never calls `register()`) installs it here, before its routes are mounted
    installErrorScrub(this.apps);

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
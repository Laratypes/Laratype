import type { RedirectStatusCode, StatusCode } from "hono/utils/http-status";
import Response from "./Response";
import type Controller from "../controller/Controller";
import type { safeMethods } from "../contracts";
import { buildRouteUrl } from "../routing/routeUrl";
import type { RouteArgs, RouteName, RouteUrlOptions } from "../routing/routeUrl";

export const response = (content: any, httpStatusCode?: StatusCode) => new Response(content, httpStatusCode)

/**
 * `redirect().route(name, params)` (H13 #162): the 0.5 response that redirects to the URL of a mounted route name.
 * Relative by default, like `route()`; `{ absolute: true }` prefixes `config('config.url')`.
 */
export interface RedirectRouteBuilder {
  route<const Name extends RouteName>(name: Name, ...args: RouteArgs<Name>): Response;
}

/** `redirect()` / `redirect(301)`: a builder whose `.route(name, params)` redirects to a mounted route (H13 #162). */
export function redirect(httpStatusCode?: RedirectStatusCode): RedirectRouteBuilder;
/** `redirect('/login', 301)`: the 0.5 response that answers with that URL and status. */
export function redirect(url: string, httpStatusCode?: RedirectStatusCode): Response;
export function redirect(urlOrStatus?: string | RedirectStatusCode, httpStatusCode?: RedirectStatusCode): Response | RedirectRouteBuilder {
  if (typeof urlOrStatus === "string") return new Response(undefined).redirect(urlOrStatus, httpStatusCode ?? 302);
  const status = urlOrStatus ?? 302;
  return {
    route(name: string, params?: object, options?: RouteUrlOptions<object>) {
      return new Response(undefined).redirect(buildRouteUrl(name, params, options), status);
    },
  } as RedirectRouteBuilder;
}

export function controller<T extends typeof Controller>(controllerClass: T, methodName: safeMethods<InstanceType<T>>): [T, typeof methodName] {
  return [controllerClass, methodName];
}

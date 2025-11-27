import { RedirectStatusCode, StatusCode } from "hono/utils/http-status";
import Response from "./Response";
import type Controller from "../controller/Controller";
import { safeMethods } from "../contracts";

export const response = (content: any, httpStatusCode?: StatusCode) => new Response(content, httpStatusCode)

export const redirect = (url: string, httpStatusCode: RedirectStatusCode = 302) => new Response(undefined).redirect(url, httpStatusCode)

export function controller<T extends typeof Controller>(controllerClass: T, methodName: safeMethods<InstanceType<T>>): [T, typeof methodName] {
  return [controllerClass, methodName];
}
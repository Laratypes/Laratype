import { RedirectStatusCode, StatusCode } from "hono/utils/http-status";
import Response from "./Response";

export const response = (content: any, httpStatusCode?: StatusCode) => new Response(content, httpStatusCode)

export const redirect = (url: string, httpStatusCode: RedirectStatusCode = 302) => new Response(undefined).redirect(url, httpStatusCode)
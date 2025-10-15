import type { RedirectStatusCode, StatusCode } from "@laratype/support";
import Response from "./Response";

export const response = (content: any, httpStatusCode?: StatusCode) => new Response(content, httpStatusCode)

export const redirect = (url: string, httpStatusCode: RedirectStatusCode = 302) => new Response(undefined).redirect(url, httpStatusCode)
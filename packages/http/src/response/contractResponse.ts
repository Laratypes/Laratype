import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { isBodylessStatus, validate } from "@laratype/contract";
import type { AnyEndpoint, StandardSchemaV1 } from "@laratype/contract";
import ResponseSupport from "../supports/Response";
import JsonResource from "../resource/json/JsonResource";

const fail = (route: string, message: string): never => {
  throw new Error(`[@laratype/http] ${route}: ${message}`);
};

/** Dev and test: the output check runs unless the app is a production build (`__PROD__`) or `NODE_ENV=production`. */
const isProduction = () => globalThis.__PROD__ ?? globalThis.process?.env?.NODE_ENV === "production";

/**
 * Dev-mode output validation: the handler's value against the endpoint's response schema. A mismatch is the server's
 * bug, not the client's, so it throws: the exception handler answers a generic 500 and logs the issues.
 */
const checkOutput = async (schema: StandardSchemaV1, value: unknown, route: string) => {
  const result = await validate(schema, value);
  if (!result.ok) {
    const issues = Object.entries(result.errors).map(([path, messages]) => `${path || "(root)"}: ${messages.join(", ")}`);
    fail(route, `the handler's value does not match the endpoint's response schema (${issues.join("; ")})`);
  }
};

/**
 * The success response of a `Route.api` route (H4 #107, docs/v1/http.md › Response from the contract). The status is
 * the endpoint's, never the method name's: `204` without a response schema, else `200` or the one of
 * `.response(schema, status)` / `.status(n)`. A body is the handler's value (a `JsonResource` is unwrapped) serialized
 * with `JSON.stringify`, so the frontend reads it as `Jsonify<output>`. A 204 / 205 or a schema-less endpoint sends no
 * body, whatever the handler returns.
 *
 * A handler may return the 0.5 `Response` for its headers and content. Its status, if set, must be the endpoint's,
 * and a redirect is sent as it is.
 */
export const resolveContractResponse = async (ctx: Context, result: unknown, endpoint: AnyEndpoint, route: string) => {
  const support = result instanceof ResponseSupport ? result : undefined;
  const redirect = support?.getRedirectUrl();
  if (redirect) {
    return ctx.redirect(redirect, support!.getRedirectStatusCode());
  }

  const { status, response: schema } = endpoint.def;
  const set = support?.getHttpStatus();
  if (set !== undefined && set !== status) {
    fail(route, `the handler answered status ${set}, but the endpoint declares ${status}: declare it on the endpoint (.response(schema, ${set}) or .status(${set}))`);
  }
  const headers = support?.getHeaders() ?? {};
  for (const name in headers) {
    ctx.header(name, headers[name]);
  }

  if (!schema || isBodylessStatus(status)) {
    return ctx.body(null, status as 204);
  }
  const value = JsonResource.toJson(support ? support.getContent() : result);
  if (!isProduction()) {
    await checkOutput(schema, value, route);
  }
  // JSON.stringify(undefined) is no JSON text at all: an empty answer is `null`
  return ctx.json((value === undefined ? null : value) as {}, status as ContentfulStatusCode);
};

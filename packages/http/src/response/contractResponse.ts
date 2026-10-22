import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { isEqual } from "es-toolkit";
import { isBodylessStatus, validate } from "@laratype/contract";
import type { AnyEndpoint, StandardSchemaV1 } from "@laratype/contract";
import ResponseSupport from "../supports/Response";
import JsonResource from "../resource/json/JsonResource";
import ResponseKernel from "./Response";

const fail = (route: string, message: string): never => {
  throw new Error(`[@laratype/http] ${route}: ${message}`);
};

/** Dev and test: the output check runs unless the app is a production build (`__PROD__`) or `NODE_ENV=production`. */
const isProduction = () => globalThis.__PROD__ ?? globalThis.process?.env?.NODE_ENV === "production";

/** What the client parses: the value after `JSON.stringify` + `JSON.parse`, `null` for no JSON text at all. */
const wire = (value: unknown): unknown => {
  const text = JSON.stringify(value);
  return text === undefined ? null : JSON.parse(text);
};

/**
 * Dev-mode output validation: the handler's value against the endpoint's response schema. The handler's value is what
 * is sent, so the schema must also output that same JSON: a transform, or a key it strips (an entity's password
 * hash), would send what the client's `Jsonify<output>` type doesn't say. A mismatch is the server's bug, not the
 * client's, so it throws: the exception handler answers a generic 500 and logs the issues.
 */
const checkOutput = async (schema: StandardSchemaV1, value: unknown, route: string) => {
  const result = await validate(schema, value);
  if (!result.ok) {
    const issues = Object.entries(result.errors).map(([path, messages]) => `${path || "(root)"}: ${messages.join(", ")}`);
    fail(route, `the handler's value does not match the endpoint's response schema (${issues.join("; ")})`);
  }
  if (!isEqual(wire(value), wire(result.value))) {
    fail(route, "the endpoint's response schema changes the handler's value (a transform, or a key it strips), so the client's type would not match what is sent: return the schema's output");
  }
};

const isSuccess = (status: number) => status >= 200 && status <= 299;

/**
 * The success response of a `Route.api` route (H4 #107, docs/v1/http.md › Response from the contract). The status is
 * the endpoint's, never the method name's: `204` without a response schema, else `200` or the one of
 * `.response(schema, status)` / `.status(n)`. A body is the handler's value (a `JsonResource` is unwrapped) serialized
 * with `JSON.stringify`, so the frontend reads it as `Jsonify<output>`. A 204 / 205 or a schema-less endpoint sends no
 * body, whatever the handler returns.
 *
 * The handler may return the 0.5 `Response` for its headers and content; a 2xx status set on it must be the
 * endpoint's. A redirect or a non-2xx one (a middleware answering 401 or 429 without calling next) is not the
 * endpoint's success and keeps the 0.5 response.
 */
export const resolveContractResponse = async (ctx: Context, result: unknown, endpoint: AnyEndpoint, route: string) => {
  const support = result instanceof ResponseSupport ? result : undefined;
  const set = support?.getHttpStatus();
  if (support && (support.getRedirectUrl() || (set !== undefined && !isSuccess(set)))) {
    return ResponseKernel.resolveResponse(ctx, support);
  }

  const { status, response: schema } = endpoint.def;
  if (set !== undefined && set !== status) {
    fail(route, `the handler answered status ${set}, but the endpoint declares ${status}: declare it on the endpoint (.response(schema, ${set}) or .status(${set}))`);
  }
  const bodyless = !schema || isBodylessStatus(status);
  const value = bodyless ? undefined : JsonResource.toJson(support ? support.getContent() : result);
  // Before any header is set: the 500 of a failed check must not carry the handler's cookies or cache headers
  if (!bodyless && !isProduction()) {
    await checkOutput(schema, value, route);
  }
  const headers = support?.getHeaders() ?? {};
  for (const name in headers) {
    // The body is JSON or nothing, whatever Content-Type the handler set
    if (name.toLowerCase() !== "content-type") ctx.header(name, headers[name]);
  }

  if (bodyless) {
    return ctx.body(null, status as 204);
  }
  // JSON.stringify(undefined) is no JSON text at all: an empty answer is `null`
  return ctx.json((value === undefined ? null : value) as {}, status as ContentfulStatusCode);
};

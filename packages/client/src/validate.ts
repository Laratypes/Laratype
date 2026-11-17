import { validate } from "@laratype/contract";
import type { ErrorBag, StandardIssue, StandardSchemaV1 } from "@laratype/contract";

/**
 * A dev-mode response mismatch (CL6 [#159](https://github.com/Laratypes/Laratype/issues/159); `client.md` ›
 * Dev-mode response validation): the success body does not match the endpoint's response schema. A call resolves it
 * as the unexpected result (`client.md` › Result union), since the server broke the contract, as an empty body
 * already does.
 *
 * `errors` is the schema's [error bag](../../contract/src/validate.ts) (dot path → messages, `""` for an issue without
 * one) and `issues` its Standard Schema issues. The message names the route and the issue paths and messages; it never
 * reads the body, but an issue's own message is passed through as the schema wrote it, and an issue can carry the
 * received value (a zod 3 enum's `received`), so the message, `errors` and `issues` may all hold response values: do
 * not send this error to an error tracker.
 */
export class ResponseValidationError extends Error {
  readonly errors: ErrorBag;
  readonly issues: ReadonlyArray<StandardIssue>;

  constructor(message: string, errors: ErrorBag, issues: ReadonlyArray<StandardIssue>) {
    super(message);
    this.name = "ResponseValidationError";
    this.errors = errors;
    this.issues = issues;
  }
}

/**
 * What a failed response check resolves the call with: the `error` of the unexpected result. A mismatch is a
 * `ResponseValidationError`; a schema whose `~standard.validate` throws or rejects (a broken schema, not a body) puts
 * that error here, so the call still resolves as a result.
 */
export interface ResponseCheckFailure {
  readonly error: unknown;
}

/**
 * Validates a success body with the endpoint's response schema (`validate()` of `@laratype/contract`, sync or async).
 * `undefined` on a match, so the caller keeps the parsed body it already has; otherwise the error the call resolves
 * as unexpected: a `ResponseValidationError` for a mismatch, whose message names the route and the issues as http's
 * dev-mode output validation does for the server, or the error a schema threw or rejected with (the check never
 * rejects: only the client's own programming errors do).
 */
export const checkResponseBody = async (
  schema: StandardSchemaV1,
  body: unknown,
  route: string,
): Promise<ResponseCheckFailure | undefined> => {
  let result: Awaited<ReturnType<typeof validate>>;
  try {
    result = await validate(schema, body);
  } catch (error) {
    // the schema broke, not the body: the call resolves it as unexpected instead of rejecting
    return { error };
  }
  if (result.ok) return undefined;
  const issues = Object.entries(result.errors).map(([path, messages]) => `${path || "(root)"}: ${messages.join(", ")}`);
  return {
    error: new ResponseValidationError(
      `[@laratype/client] ${route}: the response body does not match the endpoint's response schema (${issues.join("; ")})`,
      result.errors,
      result.issues,
    ),
  };
};

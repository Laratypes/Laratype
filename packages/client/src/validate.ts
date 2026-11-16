import { validate } from "@laratype/contract";
import type { ErrorBag, StandardIssue, StandardSchemaV1 } from "@laratype/contract";

/**
 * A dev-mode response mismatch (CL6 [#159](https://github.com/Laratypes/Laratype/issues/159); `client.md` ›
 * Dev-mode response validation): the success body does not match the endpoint's response schema. A call resolves it
 * as the unexpected result (`client.md` › Result union), since the server broke the contract, as an empty body
 * already does.
 *
 * `errors` is the schema's [error bag](../../contract/src/validate.ts) (dot path → messages, `""` for an issue without
 * one) and `issues` its Standard Schema issues. The message holds the route name and those paths and messages, never
 * the response body: an issue's own message is passed through as the schema wrote it, so a schema that quotes the
 * received value in its message (a zod enum, say) quotes it here too.
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
 * Validates a success body with the endpoint's response schema (`validate()` of `@laratype/contract`, sync or async).
 * A mismatch is a `ResponseValidationError` whose message names the route and the issues, as http's dev-mode output
 * validation does for the server; a match is `undefined` and the caller keeps the parsed body it already has.
 */
export const checkResponseBody = async (
  schema: StandardSchemaV1,
  body: unknown,
  route: string,
): Promise<ResponseValidationError | undefined> => {
  const result = await validate(schema, body);
  if (result.ok) return undefined;
  const issues = Object.entries(result.errors).map(([path, messages]) => `${path || "(root)"}: ${messages.join(", ")}`);
  return new ResponseValidationError(
    `[@laratype/client] ${route}: the response body does not match the endpoint's response schema (${issues.join("; ")})`,
    result.errors,
    result.issues,
  );
};

import type { InferOut, StandardIssue, StandardResult, StandardSchemaV1 } from "./standard-schema";

/**
 * dot path -> messages, e.g. { "items.0.name": ["Required"] }; issues without a path go under "".
 * Null prototype: there is no `hasOwnProperty`, use `Object.hasOwn(bag, key)` or `key in bag`.
 */
export type ErrorBag = Record<string, string[]>;

export type ValidationResult<O> =
  | { readonly ok: true; readonly value: O }
  | { readonly ok: false; readonly errors: ErrorBag; readonly issues: ReadonlyArray<StandardIssue> };

const dotPath = (path: StandardIssue["path"]): string =>
  (path ?? []).map((segment) => String(typeof segment === "object" ? segment.key : segment)).join(".");

export const toErrorBag = (issues: ReadonlyArray<StandardIssue>): ErrorBag => {
  // null prototype: keys come from user input, so "__proto__" must stay a plain key
  const bag: ErrorBag = Object.create(null);
  for (const issue of issues) (bag[dotPath(issue.path)] ??= []).push(issue.message);
  return bag;
};

const toResult = <O>(result: StandardResult<unknown>): ValidationResult<O> =>
  result.issues
    ? { ok: false, errors: toErrorBag(result.issues), issues: result.issues }
    : { ok: true, value: result.value as O };

/**
 * Validates `value` with any Standard Schema (zod 3.25+, valibot, arktype, ...), sync or async.
 * Invalid input resolves to `{ ok: false, errors }`; it never rejects for it.
 *
 * @example
 * // zod 4: `import * as z` tree-shakes (~16 KiB gzip vs ~47 KiB for `import { z }`, S2 #85); FE bundles can use "zod/v4-mini" (~8.3 KiB)
 * import * as z from "zod";
 * // zod 4: plain z.coerce.number() has input type `unknown`
 * const Query = z.object({ page: z.coerce.number<number>() });
 * const result = await validate(Query, { page: "2" }); // result.ok ? result.value.page : result.errors.page
 */
export const validate = async <S extends StandardSchemaV1>(schema: S, value: unknown): Promise<ValidationResult<InferOut<S>>> =>
  toResult(await schema["~standard"].validate(value));

/** Same as `validate` without the Promise; throws a TypeError when the schema is async. */
export const validateSync = <S extends StandardSchemaV1>(schema: S, value: unknown): ValidationResult<InferOut<S>> => {
  const result = schema["~standard"].validate(value);
  // any thenable, not just this realm's Promise
  if (typeof (result as PromiseLike<unknown>).then === "function") {
    throw new TypeError(`validateSync: the ${schema["~standard"].vendor} schema is async, use validate() instead`);
  }
  return toResult(result as StandardResult<unknown>);
};

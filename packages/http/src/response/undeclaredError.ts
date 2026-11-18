import { isContractError } from "@laratype/contract";
import type { AnyErrorDef } from "@laratype/contract";
import { isException } from "@laratype/support";
import { isProduction, isTest } from "../supports/runtime";

/**
 * The undeclared-error check (docs/v1/http.md › Undeclared-error check, X3 #157): in dev and test, a thrown error whose
 * code reaches the client must be declared on the running endpoint. `RequestKernel.handle` runs it in the catch of its
 * pipeline, the one place that knows both the thrown error and the route's resolved errors.
 */

/** What the check reads of the running route: its name for the line, and the errors its contract declares. */
export interface UndeclaredRoute {
  readonly name?: string;
  readonly path: string;
  /** The endpoint's resolved errors (`apiRoutes()`'s `errors`): `undefined` for a route not mounted by `Route.api`. */
  readonly errors?: readonly AnyErrorDef[];
}

/** The code and status the client receives: the two fields it narrows an error by (client.md › Result union). */
interface CodedError {
  readonly code: string;
  readonly status: number;
}

/**
 * A thrown error whose code reaches the client: a contract error, or a responsible 0.5 `Exception` with a code (a guard
 * or policy throwing `UnauthorizedException` is the derived 401). Anything else is not checked: a plain error's generic
 * 500 carries no code, a non-responsible `Exception` sends none either, and a responsible one with a 5xx status is a
 * server failure whose body is the generic `{ message: "Server Error" }`, without the code (docs/v1/http.md ›
 * Exceptions). A 5xx contract error keeps its code and body, and is checked.
 */
const codedError = (error: unknown): CodedError | undefined => {
  if (isContractError(error)) return error;
  if (!isException(error) || !error.canResponsible()) return undefined;
  const status = error.getHttpCode();
  // Every non-contract 5xx sends `{ message: "Server Error" }`, not `{ code, message }`: nothing for the client to narrow
  if (status >= 500) return undefined;
  const code = error.getErrorCode();
  if (code !== "") return { code, status };
  return undefined;
};

/** The declared `code status` pairs of one route's errors, built on the first violation: dev and test only. */
const DECLARED = new WeakMap<readonly AnyErrorDef[], ReadonlySet<string>>();

const declaredErrors = (errors: readonly AnyErrorDef[]): ReadonlySet<string> => {
  let declared = DECLARED.get(errors);
  if (declared === undefined) {
    DECLARED.set(errors, (declared = new Set(errors.map((error) => `${error.code} ${error.status}`))));
  }
  return declared;
};

/**
 * The diagnostic line for a thrown error the route does not declare, or `undefined` when there is nothing to report.
 * Reads the error's code through its public methods, so a broken one throws here, in the caller's guard.
 */
const undeclaredLine = (error: unknown, route: UndeclaredRoute): string | undefined => {
  const { errors } = route;
  // A route outside Route.api has no resolved set: its contract and scope throws are unknown, so it is not checked
  if (errors === undefined) return undefined;
  const thrown = codedError(error);
  if (thrown === undefined || declaredErrors(errors).has(`${thrown.code} ${thrown.status}`)) return undefined;
  return `[@laratype/http] ${route.name ?? route.path}: the route threw ${thrown.status} ${thrown.code}, which the endpoint does not declare: ` +
    `add it with .throws(...) on the endpoint, or throws: [...] on its contract or a scope`;
};

/**
 * Reports an error thrown by a route's handler or middleware that the running endpoint does not declare: `console.error`
 * with the thrown error (its stack) in dev, and in test a thrown `Error` whose cause is the original, so the exception
 * filter answers the generic 500 and the test fails. Production returns before anything is read, so the check costs
 * nothing there; the resolved errors are the route's, derived ones (422, 404, 401, 403, 429) included.
 */
export const checkUndeclaredError = (error: unknown, route: UndeclaredRoute): void => {
  // A constant branch in a production build (`__PROD__` is folded to true), before any read or allocation
  if (isProduction()) return;
  let line: string | undefined;
  try {
    line = undeclaredLine(error, route);
  }
  catch (failure) {
    // A check that cannot read the error must never replace it, dev or test: only the test-mode wrapper below may
    console.error("[@laratype/http] the undeclared-error check failed, the thrown error is unchanged:", failure);
    return;
  }
  if (line === undefined) return;
  // Test: the generic 500 of the exception filter (logged once there, with this line), so a test of the route fails.
  // Thrown outside the try, so it is the one failure that escapes: the filter's answer to an undeclared error
  if (isTest()) throw new Error(line, { cause: error });
  console.error(line, error);
};

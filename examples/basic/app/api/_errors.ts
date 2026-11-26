import { defineError } from "@laratype/contract";

/**
 * A failed password login. A public login endpoint has no derived 401 (only `auth` derives one), so the endpoint
 * declares this domain error with `.throws()`; the test-mode undeclared-error check would otherwise fail it.
 */
export const InvalidCredentials = defineError(
  401,
  "INVALID_CREDENTIALS",
  (message: string = "Invalid credentials") => ({ message }),
);

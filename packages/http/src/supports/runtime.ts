/**
 * Dev and test unless the app is a production build (`__PROD__`) or `NODE_ENV=production`: the output validation of
 * docs/v1/http.md › Response from the contract and the undeclared-error check both read it (H4 #107, X3 #157).
 */
export const isProduction = () => globalThis.__PROD__ ?? globalThis.process?.env?.NODE_ENV === "production";

/** Test runners set `NODE_ENV=test` (vitest does): the undeclared-error check fails the test there (X3 #157). */
export const isTest = () => !isProduction() && globalThis.process?.env?.NODE_ENV === "test";

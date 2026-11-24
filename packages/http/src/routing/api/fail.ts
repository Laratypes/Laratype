/** The runtime `Error` of `Route.api`: one prefix for every check (docs/v1/http.md › Diagnostics). */
export const fail = (message: string): never => {
  throw new Error(`[@laratype/http] Route.api: ${message}`);
};

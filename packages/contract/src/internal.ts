// Helpers shared by the contract modules. Not re-exported from index.ts.

export type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/** `"201"` → `201`: builds status unions from template strings. */
export type ToNumber<S> = S extends `${infer N extends number}` ? N : never;

/** An error status, 400 to 599: what `defineError`, `ContractError` and `throws` accept. */
export const isFailureStatus = (status: unknown): status is number =>
  Number.isInteger(status) && (status as number) >= 400 && (status as number) <= 599;

/** Throws the package's TypeError: `[@laratype/contract] <message>`. */
export const fail = (message: string): never => {
  throw new TypeError(`[@laratype/contract] ${message}`);
};

/** An endpoint path must start with "/": the client appends it to `baseUrl`, so `":tenant/x"` could extend the host. */
export const checkPath = (path: unknown, label: string): string => {
  if (typeof path !== "string" || !path.startsWith("/")) fail(`${label}: the path must start with "/", got ${JSON.stringify(path)}`);
  return path as string;
};

// Helpers shared by the contract modules. Not re-exported from index.ts.

export type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/** `"201"` → `201`: builds status unions from template strings. */
export type ToNumber<S> = S extends `${infer N extends number}` ? N : never;

/** Throws the package's TypeError: `[@laratype/contract] <message>`. */
export const fail = (message: string): never => {
  throw new TypeError(`[@laratype/contract] ${message}`);
};

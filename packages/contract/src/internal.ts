// Helpers shared by the contract modules. Not re-exported from index.ts.

/** Throws the package's TypeError: `[@laratype/contract] <message>`. */
export const fail = (message: string): never => {
  throw new TypeError(`[@laratype/contract] ${message}`);
};

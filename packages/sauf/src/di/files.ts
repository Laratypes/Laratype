/** The file rules shared by the Vite and Bun DI plugins. */

/** Forward slashes, so both plugins compare and filter paths the same way on Windows. */
export const normalize = (path: string) => path.replace(/\\/g, '/');

/** What the Bun `onLoad` filter and the Vite `isAppFile` check both match: `.ts`, `.tsx`, `.mts` and `.cts`. */
export const sourceRE = /\.(?:ts|tsx|mts|cts)$/;

const dtsRE = /\.d\.(?:ts|mts|cts)$/;

/** A `normalize`d source file outside `node_modules`, and not a declaration file. */
export const isTransformable = (file: string) =>
  sourceRE.test(file) && !dtsRE.test(file) && !file.includes('/node_modules/');

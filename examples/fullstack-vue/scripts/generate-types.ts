import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_BASE, DEFAULT_OUT, DEFAULT_ROOT } from "../../../packages/sauf/src/typegen/config";
import { emitTree } from "../../../packages/sauf/src/typegen/emit";
import { scanTree } from "../../../packages/sauf/src/typegen/scan";
import { writeGenerated } from "../../../packages/sauf/src/typegen/sync";

const exampleDir = fileURLToPath(new URL("../", import.meta.url));
const basicDir = fileURLToPath(new URL("../../basic/", import.meta.url));

const TYPES_PREFIX = `${DEFAULT_OUT}/types/`;
const OVERLAY = `${DEFAULT_OUT}/basic/types`;

/**
 * Writes the `$types.d.ts` overlay of examples/basic's contract tree into this example's `.laratype/basic/types`.
 * The scan uses sauf's defaults (`app/api`, `/api`), which is what examples/basic's config uses (docs/v1/contract.md ›
 * Contract folder tree › Root). The FE program must not load an examples/basic file outside `app/api` (E4 #136), so its
 * tsconfig `rootDirs` points at this copy instead of `examples/basic/.laratype/types`. Only the type overlay is needed:
 * `src/api.ts` builds `appApi` with `defineApi` from the contract file, so the generated `$api` module is not imported.
 * Returns the written paths relative to this example.
 */
export function generateTypeOverlay(): string[] {
  const tree = scanTree(`${basicDir}${DEFAULT_ROOT}`, DEFAULT_BASE);
  const types = emitTree(tree, { root: DEFAULT_ROOT, outDir: DEFAULT_OUT }).filter((file) =>
    file.path.startsWith(TYPES_PREFIX),
  );
  // A folder deleted from examples/basic must not leave its $types.d.ts behind
  rmSync(`${exampleDir}${OVERLAY}`, { recursive: true, force: true });
  return types.map((file) => {
    const path = `${OVERLAY}/${file.path.slice(TYPES_PREFIX.length)}`;
    writeGenerated(exampleDir, { path, content: file.content });
    return path;
  });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const written = generateTypeOverlay();
  console.log(`[fullstack-vue] wrote ${written.length} generated type file(s) to ${OVERLAY}`);
}

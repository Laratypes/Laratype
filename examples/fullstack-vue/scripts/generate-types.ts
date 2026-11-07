import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitTree } from "../../../packages/sauf/src/typegen/emit";
import { scanTree } from "../../../packages/sauf/src/typegen/scan";

const exampleDir = fileURLToPath(new URL("../", import.meta.url));
const basicDir = fileURLToPath(new URL("../../basic/", import.meta.url));

/** The contract tree root and URL base of examples/basic (`app/config/config.ts` defaults). */
const ROOT = "app/api";
const BASE = "/api";
const TYPES_PREFIX = ".laratype/types/";

/**
 * Writes the `$types.d.ts` overlay of examples/basic's contract tree into this example's `.laratype/basic/types`.
 * The FE program must not load an examples/basic file outside `app/api` (E4 #136), so its tsconfig `rootDirs` points
 * at this copy instead of `examples/basic/.laratype/types`. Only the type overlay is needed: `src/api.ts` builds
 * `appApi` with `defineApi` from the contract files, so the generated `$api` module is not imported.
 */
export function generateTypes(): string[] {
  const tree = scanTree(`${basicDir}${ROOT}`, BASE);
  const files = emitTree(tree, { root: ROOT, outDir: ".laratype" }).filter((file) => file.path.startsWith(TYPES_PREFIX));
  const outDir = `${exampleDir}.laratype/basic/types`;
  rmSync(outDir, { recursive: true, force: true });
  return files.map((file) => {
    const target = `${outDir}/${file.path.slice(TYPES_PREFIX.length)}`;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    return target;
  });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const written = generateTypes();
  console.log(`[fullstack-vue] wrote ${written.length} generated type file(s) to .laratype/basic/types`);
}

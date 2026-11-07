import { fileURLToPath } from "node:url";
import { syncContractTree } from "../../../../packages/sauf/src/typegen/sync";

/**
 * `$types.d.ts` and `$api` (`.laratype/api/index.gen.ts`) are generated, never committed (docs/v1/typegen.md):
 * the same scan `sauf dev` runs, without the `api.ts` type-check, before any test imports the app.
 */
export default function setup() {
  const projectDir = fileURLToPath(new URL("../..", import.meta.url));
  const result = syncContractTree({ projectDir });
  if (!result) throw new Error(`examples/basic: the contract tree root app/api does not exist in ${projectDir}`);
}

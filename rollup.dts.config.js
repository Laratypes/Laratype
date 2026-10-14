import { entries } from "./scripts/alias.js";
import path from "path";
import { existsSync } from "fs";
import { dts } from "rollup-plugin-dts";

const tasks = Object.entries(entries)
  .map(([pkgName]) => {
    return [pkgName, path.resolve(`./dist_tmp/packages/${pkgName.replace('@laratype', '')}/src/index.d.ts`)];
  })
  .filter(([pkgName, entryPoint]) => existsSync(entryPoint))
  .map(([pkgName, entryPoint]) => {
    const dir = path.resolve(`./packages/${pkgName.replace('@laratype', '')}/dist`)
    return {
      input: entryPoint,
      // index.d.cts types the `require` condition: in a "type": "module" package, index.d.ts
      // alone is read as ESM types for the CJS build (attw "Masquerading as ESM").
      output: [
        {
          file: `${dir}/index.d.ts`,
          format: 'es',
        },
        {
          file: `${dir}/index.d.cts`,
          format: 'es',
        },
      ],
      plugins: [
        dts()
      ],
    }
  })

export default tasks;

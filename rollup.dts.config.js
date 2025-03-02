import { entries } from "./scripts/alias.js";
import path from "path";
import { existsSync } from "fs";
import { dts } from "rollup-plugin-dts";

const tasks = Object.entries(entries)
  .map(([pkgName]) => {
    return [pkgName, path.resolve(`./dist/packages/${pkgName.replace('@laratype', '')}/src/index.d.ts`)];
  })
  .filter(([pkgName, entryPoint]) => existsSync(entryPoint))
  .map(([pkgName, entryPoint]) => {
    const dir = path.resolve(`./packages/${pkgName.replace('@laratype', '')}/dist`)
    return {
      input: entryPoint,
      output: [
        {
          file: `${dir}/index.d.ts`,
          format: 'es',
        },
      ],
      plugins: [
        dts()
      ],
    }
  })

export default tasks;
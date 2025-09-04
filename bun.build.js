import { existsSync, readFileSync } from "fs";
import path from "path";

import merge from "deepmerge"
import { entries } from "./scripts/alias.js";

(async () => {
 const tasks = Object.entries(entries)
  .filter(([pkgName, entryPoint]) => existsSync(entryPoint))
  .map(([pkgName, entryPoint]) => {
    const dir = path.resolve(`./packages/${pkgName.replace('@laratype', '')}/dist`);
    const buildFormat = JSON.parse(
      readFileSync(
        path.resolve(`./packages/${pkgName.replace('@laratype', '')}/package.json`), 'utf-8'
      )
    ).buildOptions ?? {};

    if(!buildFormat.external) {
      buildFormat.external = [];
    }

    buildFormat.external.push(/@laratype\/.*/);

    const baseConfig = {
      entrypoints: [
        entryPoint
      ],
      outdir: dir,
      target: "node",
      format: "esm",
      splitting: true,
      minify: true,
      naming: "[dir]/[name].esm.[ext]",
      define: {
        __PROD__: "true",
      }
    }

    const config = merge(baseConfig, buildFormat);

    return config;
  })

  for (const task of tasks) {
    const start = performance.now();
    console.log(`Building ${task.entrypoints}...`);
    await Bun.build(task)
    console.log(`Built ${task.entrypoints} in ${(performance.now() - start).toFixed(2)}ms`);
  }

})()

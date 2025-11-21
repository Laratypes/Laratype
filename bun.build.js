import { existsSync, readFileSync, rmSync } from "fs";
import path from "path";

import merge from "deepmerge"
import { entries } from "./scripts/alias.js";

(async () => {
 const tasks = Object.entries(entries)
  .filter(([pkgName, entryPoint]) => existsSync(entryPoint))
  .map(([pkgName, entryPoint]) => {
    const dir = path.resolve(`./packages/${pkgName.replace('@laratype', '')}/dist`);

    // Clean dist folder
    rmSync(dir, { recursive: true, force: true });

    const buildFormat = JSON.parse(
      readFileSync(
        path.resolve(`./packages/${pkgName.replace('@laratype', '')}/package.json`), 'utf-8'
      )
    ).buildOptions ?? {};

    if(!buildFormat.external) {
      buildFormat.external = [];
    }

    buildFormat.external.push(/@laratype\/.*/);

    const baseConfigEsm = {
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
        "globalThis.__PROD__": "true",
      }
    }

    const baseConfigCjs = {
       ...baseConfigEsm,
       splitting: undefined,
      format: "cjs",
      naming: "[dir]/[name].[ext]",
    }

    return [
      merge(baseConfigEsm, buildFormat),
      merge(baseConfigCjs, buildFormat),
    ]
  })
  .flat()

  for (const packageName in entries) {
    const entryPoint = `./packages/${packageName.replace('@laratype', '')}/build.config.js`;
    if(!existsSync(entryPoint)) {
      continue;
    }
    const configs = await import(entryPoint);
    tasks.push(...configs.default);    
  }

  for (const task of tasks) {
    const start = performance.now();
    console.log(`Building ${task.entrypoints}...`);
    await Bun.build(task)
    console.log(`Built ${task.entrypoints} in ${(performance.now() - start).toFixed(2)}ms`);
  }

})()

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import path from "path";

import merge from "deepmerge"
import { entries } from "./scripts/alias.js";

// Bun.build metafiles, read by scripts/check-dist.mjs to detect inlined workspace packages.
const META_DIR = path.resolve("./dist_tmp/bun-meta");

const readPackageJson = (dir) => JSON.parse(readFileSync(path.resolve(dir, "package.json"), "utf-8"));

// Every workspace package name ("@laratype/http", "laratype", "sauf", ...).
// Bun's `external` only takes strings/wildcards, a RegExp is silently ignored.
const workspaceExternals = [
  "@laratype/*",
  ...readdirSync("./packages")
    .filter(dir => existsSync(path.resolve("./packages", dir, "package.json")))
    .map(dir => readPackageJson(path.resolve("./packages", dir)).name),
];

const packageExternals = (pkg) => [
  ...workspaceExternals,
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];

const metaName = (task) => path.relative(process.cwd(), task.entrypoints[0])
  .replace(/[\\/]/g, "_")
  .replace(/\.[tj]s$/, "") + `.${task.format}.json`;

(async () => {
 const tasks = Object.entries(entries)
  .filter(([pkgName, entryPoint]) => existsSync(entryPoint))
  .map(([pkgName, entryPoint]) => {
    const pkgDir = path.resolve(`./packages/${pkgName.replace('@laratype', '')}`);
    const dir = path.resolve(pkgDir, "dist");

    // Clean dist folder
    rmSync(dir, { recursive: true, force: true });

    const pkg = readPackageJson(pkgDir);
    const buildFormat = pkg.buildOptions ?? {};

    buildFormat.external = [
      ...(buildFormat.external ?? []),
      ...packageExternals(pkg),
    ];

    // No `define` for globalThis.__PROD__ here: folding it into package dists disabled
    // the dev paths (sauf dev dist -> src rewrite, resolveModule). Production sets it at runtime.
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

  rmSync(META_DIR, { recursive: true, force: true });
  mkdirSync(META_DIR, { recursive: true });

  for (const task of tasks) {
    const start = performance.now();
    console.log(`Building ${task.entrypoints}...`);
    const result = await Bun.build({ ...task, metafile: true })
    writeFileSync(path.resolve(META_DIR, metaName(task)), JSON.stringify({
      entrypoint: task.entrypoints[0],
      outdir: task.outdir,
      format: task.format,
      inputs: Object.keys(result.metafile.inputs),
    }, null, 2));
    console.log(`Built ${task.entrypoints} in ${(performance.now() - start).toFixed(2)}ms`);
  }

})()

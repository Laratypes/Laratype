import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import merge from "deepmerge"
import { entries } from "./scripts/alias.js";
import { keepRuntimeModuleUrl } from "./scripts/module-paths.mjs";
import { DI_RUNTIME_ID, laratypeDiBun } from "./packages/sauf/src/di/index.ts";

// The repository root, and the build-machine path check:dist reports if a build still contains it.
// The root as given and as resolved: Bun writes the resolved path into a folded literal when the
// checkout is reached through a junction, symlink, subst drive or 8.3 name (B25 #329).
const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)));
const REAL_ROOT = realpathSync.native(ROOT);
const ROOTS = REAL_ROOT === ROOT ? [ROOT] : [ROOT, REAL_ROOT];
const COMPARE_CASE_INSENSITIVE = process.platform === "win32";

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

// The DI transform (T4 #116) imports its helper from @laratype/core, so it only runs on packages that depend on
// it. @laratype/core itself is skipped: it would import itself.
const usesDi = (pkg) => pkg.name !== DI_RUNTIME_ID && DI_RUNTIME_ID in (pkg.dependencies ?? {});

// Forward slashes, and lower case on Windows, where Bun's paths and the cwd can differ in casing.
const comparablePath = (file) => {
  const normalized = file.replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

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

    const srcDir = `${comparablePath(path.resolve(pkgDir, "src"))}/`;

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
      // Own sources only: other workspace packages are externals.
      plugins: usesDi(pkg) ? [laratypeDiBun({ include: (file) => comparablePath(file).startsWith(srcDir) })] : [],
    }

    const baseConfigCjs = {
       ...baseConfigEsm,
       splitting: undefined,
      format: "cjs",
      naming: "[dir]/[name].cjs",
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
    // CJS has no `import.meta`: Bun folds `import.meta.url` into a `file://<source file>` literal there.
    // Rewrite it to the bundle's own URL, or the dist resolves against the build machine's src (B25 #329).
    if (task.format === "cjs") {
      for (const output of result.outputs) {
        const code = await output.text();
        const { code: rewritten, rewritten: count } = keepRuntimeModuleUrl(code, ROOTS, {
          caseInsensitive: COMPARE_CASE_INSENSITIVE,
        });
        if (count) {
          writeFileSync(output.path, rewritten);
          console.log(`  kept ${count} module path(s) runtime in ${path.relative(ROOT, output.path)}`);
        }
      }
    }
    writeFileSync(path.resolve(META_DIR, metaName(task)), JSON.stringify({
      entrypoint: task.entrypoints[0],
      outdir: task.outdir,
      format: task.format,
      inputs: Object.keys(result.metafile.inputs),
    }, null, 2));
    console.log(`Built ${task.entrypoints} in ${(performance.now() - start).toFixed(2)}ms`);
  }

})()

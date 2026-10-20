import { getProjectPath, getRootPackageInfo, resolvePathSync, type ManifestKind } from "@laratype/support";
import { rollup } from "rollup";
import { Command, Console } from "@laratype/console";
import { green } from "kolorist";
import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { replaceTscAliasPaths } from 'tsc-alias';
import { getPlatformAdapter } from "../utils/build/platform";
import { cpSync, existsSync, rmSync, writeFileSync } from "fs";
import { dirname, join, posix, relative, resolve } from "path";
import type * as TS from "typescript";
import { emitManifest, MANIFEST_FILE, scanManifest, type ScannedEntry } from "../manifest";
import { slash } from "../typegen/sync";

/** Loads `typescript` for `sauf build` only (an optional peer of sauf): app boot and `sauf dev` never pull it in. */
export async function loadBuildTypeScript(load: () => Promise<unknown> = () => import("typescript")): Promise<typeof TS> {
  try {
    const mod = (await load()) as typeof TS & { default?: typeof TS };
    return mod.default ?? mod;
  } catch (error) {
    throw new Error("sauf build needs typescript (install it as a devDependency)", { cause: error });
  }
}

/**
 * Writes `<distDir>/app.manifest.js`: the app manifest of the sources, each pointing at the file tsc emitted for it, as
 * TypeScript computes it from `tsconfig` (`getOutputFileNames`: outDir and rootDir, whatever the layout). A source that
 * is not in the build program (excluded, such as test-only factories) is left out and returned in `omitted`; one in the
 * program whose output file is missing is an error. `appDir` records where `app/` was emitted, for `getAppPath()`.
 * Replaced by the bundle step of B4 (#128).
 */
export function writeDistManifest(ts: typeof TS, projectDir: string, tsconfig = "tsconfig.build.json", distDir = "dist") {
  const configFile = resolve(projectDir, tsconfig);
  const dist = resolve(projectDir, distDir);
  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(`sauf build: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
    },
  })!;
  const ignoreCase = !ts.sys.useCaseSensitiveFileNames;
  const key = (file: string) => (ignoreCase ? slash(resolve(file)).toLowerCase() : slash(resolve(file)));
  const program = new Set(parsed.fileNames.map(key));

  const scan = scanManifest(projectDir);
  const omitted: string[] = [];
  const missing: string[] = [];
  const outputs = new Map<string, string>();
  let appDir: string | undefined;
  for (const entry of [...(scan.providers ? [scan.providers] : []), ...Object.values(scan.kinds).flat()]) {
    const source = resolve(projectDir, entry.path);
    if (!program.has(key(source))) {
      omitted.push(entry.path);
      continue;
    }
    const js = ts.getOutputFileNames(parsed, source, ignoreCase).find((file) => /\.m?js$/.test(file));
    if (!js || !existsSync(js)) {
      missing.push(`${entry.path} (${js ? slash(relative(projectDir, js)) : "no JavaScript output"})`);
      continue;
    }
    outputs.set(entry.path, js);
    // app/<rest>.ts → <emitted app folder>/<rest>.js
    const rest = entry.path.startsWith("app/") ? entry.path.slice("app/".length).replace(/\.m?ts$/, "") : undefined;
    const emitted = slash(js).replace(/\.m?js$/, "");
    if (appDir === undefined && rest !== undefined && emitted.endsWith(`/${rest}`)) {
      appDir = posix.relative(slash(dist), emitted.slice(0, -rest.length - 1));
    }
  }
  if (missing.length) {
    throw new Error(`sauf build: tsc emitted no file for ${missing.join(", ")}: run tsc -b ${tsconfig} first`);
  }
  const kinds = {} as Record<ManifestKind, readonly ScannedEntry[]>;
  for (const kind of Object.keys(scan.kinds) as ManifestKind[]) kinds[kind] = scan.kinds[kind].filter((e) => outputs.has(e.path));
  const shipped = { providers: scan.providers && outputs.has(scan.providers.path) ? scan.providers : undefined, kinds };
  const code = emitManifest(shipped, (path) => {
    const rel = posix.relative(slash(dist), slash(outputs.get(path)!));
    return rel.startsWith("../") ? rel : `./${rel}`;
  }, appDir);
  const file = join(dist, MANIFEST_FILE);
  writeFileSync(file, code);
  return { file, omitted };
}

export default class LaratypeBuildCommand extends Command {

  static signature = 'build'

  static description = 'Build the Laratype application'

  static options = [
    ['-p, --platform <platform>', 'Platform to build for', 'node'],
  ]

  // Disable all providers by default
  public async providers() {
    return [];
  }

  public async handle() {
    Console.start("Building Laratype Application...");
    const opts = this.opts();
    const startTime = globalThis.__sauf_start_time || performance.now();

    // Guard check platform adapter
    getPlatformAdapter(opts.platform);

    const rootInfo = await getRootPackageInfo();

    // The manifest first, and an old one removed before: a failed step never leaves new bundles next to an old manifest
    const manifestFile = getProjectPath(`dist/${MANIFEST_FILE}`, false);
    rmSync(manifestFile, { force: true });
    const ts = await loadBuildTypeScript();
    const { file, omitted } = writeDistManifest(ts, getProjectPath('', false));
    if (omitted.length) {
      Console.warn(`Not in the program of tsconfig.build.json, so left out of dist/${MANIFEST_FILE}: ${omitted.join(', ')} (add their folder to "include" to ship them)`);
    }
    Console.info(`Generated ${file}`);

    const targets = {
      [resolvePathSync('sauf/resources/app/cli.js')]: getProjectPath('dist/cli.js', false),
      [resolvePathSync('sauf/resources/app/adapters/node/index.js')]: getProjectPath('dist/index.js', false),
    }

    for (const sourceFile in targets) {
      const targetFile = targets[sourceFile];
      cpSync(
        sourceFile,
        targetFile,
      );

      Console.info(`Generated ${targetFile}`);
    }

    await replaceTscAliasPaths({
      configFile: getProjectPath('tsconfig.build.json', false),
      resolveFullPaths: true,
      resolveFullExtension: '.js',
    })

    const endTime = performance.now();

    Console.success(green(`Build completed in ${(endTime - startTime).toFixed(2)}ms`));

    return 0;

  }
}

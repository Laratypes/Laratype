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
import { loadTypeScript } from "../typegen";

/** `typescript` for `sauf build` only (an optional peer of sauf): app boot and `sauf dev` never pull it in. */
export const loadBuildTypeScript = (load?: () => Promise<unknown>): Promise<typeof TS> =>
  loadTypeScript(load, (cause) => new Error("sauf build needs typescript (install it as a devDependency)", { cause }));

const isJs = (file: string) => /\.m?js$/.test(file);
const isDeclaration = (file: string) => /\.d\.[cm]?ts$/.test(file);

/** The `include` of the config, for errors: `["app/**\/*"]`. */
const includeOf = (parsed: TS.ParsedCommandLine) => {
  const include = (parsed.raw as { include?: unknown } | undefined)?.include;
  return include === undefined ? "none (every file of its folder)" : JSON.stringify(include);
};

/**
 * The folder tsc mirrors under `outDir`, as `getOutputFileNames` takes it from `rootDir`: `rootDir`, else the config's
 * folder for a composite project, else the common folder of the program's sources. That program also holds the files
 * the sources import from outside `include` (`$api` from `.laratype/`), which the config does not list, so the root
 * comes from the outputs tsc wrote: the common folder of the listed sources is tried first, then each folder above it,
 * and the one under which most sources have their output wins. `undefined` without `outDir` (outputs next to sources).
 */
function emitRoot(ts: typeof TS, parsed: TS.ParsedCommandLine, configFile: string, sources: readonly string[], ignoreCase: boolean): string | undefined {
  const { outDir, rootDir, composite } = parsed.options;
  if (!outDir) return undefined;
  if (rootDir !== undefined) return resolve(rootDir);
  if (composite) return dirname(configFile);
  const same = (a: string, b: string) => (ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b);
  const dirs = sources.map((file) => slash(dirname(resolve(file))).split("/"));
  const common = resolve(dirs.reduce((acc, parts) => {
    let i = 0;
    while (i < acc.length && i < parts.length && same(acc[i]!, parts[i]!)) i++;
    return acc.slice(0, i);
  }).join("/") || "/");
  let root = common;
  let most = 0;
  for (let dir = common; ; dir = dirname(dir)) {
    const options = { ...parsed, options: { ...parsed.options, rootDir: dir } };
    const found = sources.filter((file) => ts.getOutputFileNames(options, file, ignoreCase).some((out) => isJs(out) && existsSync(out))).length;
    if (found > most) {
      root = dir;
      most = found;
    }
    if (dirname(dir) === dir) break;
  }
  return root;
}

/**
 * Writes `<distDir>/app.manifest.js`: the app manifest of the sources, each pointing at the file tsc emitted for it, as
 * TypeScript computes it from `tsconfig` (`getOutputFileNames`: outDir and rootDir, whatever the layout) and the root
 * tsc actually used (`emitRoot`). A config with errors, or without any source (an `include` that matches nothing), is
 * an error: the manifest would be empty. A source that is not in the build program (excluded, such as test-only
 * factories) is left out and returned in `omitted`; one in the program whose output file is missing is an error.
 * `appDir` records where `app/` is emitted, for `getAppPath()`.
 * Replaced by the bundle step of B4 (#128).
 */
export function writeDistManifest(ts: typeof TS, projectDir: string, tsconfig = "tsconfig.build.json", distDir = "dist") {
  const configFile = resolve(projectDir, tsconfig);
  const dist = resolve(projectDir, distDir);
  const message = (diagnostic: TS.Diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(`sauf build: ${message(diagnostic)}`);
    },
  })!;
  // "No inputs were found" included: an empty program would ship an empty manifest
  if (parsed.errors.length) {
    throw new Error(`sauf build: ${tsconfig}: ${parsed.errors.map(message).join("; ")}`);
  }
  const sources = parsed.fileNames.filter((file) => !isDeclaration(file));
  if (!sources.length) {
    throw new Error(`sauf build: ${tsconfig} has no source file to build (its "include": ${includeOf(parsed)})`);
  }
  const ignoreCase = !ts.sys.useCaseSensitiveFileNames;
  const key = (file: string) => (ignoreCase ? slash(resolve(file)).toLowerCase() : slash(resolve(file)));
  const program = new Set(parsed.fileNames.map(key));

  const root = emitRoot(ts, parsed, configFile, sources, ignoreCase);
  const emit = root === undefined ? parsed : { ...parsed, options: { ...parsed.options, rootDir: root } };
  const app = resolve(projectDir, "app");
  const appDir = posix.relative(slash(dist), slash(root === undefined ? app : resolve(parsed.options.outDir!, relative(root, app))));

  const scan = scanManifest(projectDir);
  const omitted: string[] = [];
  const missing: string[] = [];
  const outputs = new Map<string, string>();
  for (const entry of [...(scan.providers ? [scan.providers] : []), ...Object.values(scan.kinds).flat()]) {
    const source = resolve(projectDir, entry.path);
    if (!program.has(key(source))) {
      omitted.push(entry.path);
      continue;
    }
    const js = ts.getOutputFileNames(emit, source, ignoreCase).find(isJs);
    if (!js || !existsSync(js)) {
      missing.push(`${entry.path} (${js ? slash(relative(projectDir, js)) : "no JavaScript output"})`);
      continue;
    }
    outputs.set(entry.path, js);
  }
  if (missing.length) {
    throw new Error(`sauf build: tsc emitted no file for ${missing.join(", ")}: run tsc -b ${tsconfig} first (its "include": ${includeOf(parsed)})`);
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
  return { file, omitted, appDir };
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

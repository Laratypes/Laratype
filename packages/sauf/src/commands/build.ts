import { getProjectPath, getRootPackageInfo, resolvePathSync, type ManifestKind } from "@laratype/support";
import { rollup } from "rollup";
import { Command, Console } from "@laratype/console";
import { green } from "kolorist";
import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { replaceTscAliasPaths } from 'tsc-alias';
import { getPlatformAdapter } from "../utils/build/platform";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
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

/**
 * The option diagnostics of a tsconfig a newer tsc wrote, which the loaded `typescript` does not know: `tsc -b` emitted
 * the tree already, so the manifest can still be written. TS5023 / TS5025 is an unknown option, TS6046 an unknown value
 * for an option the loaded tsc knows (a target, module or lib added later), TS5103 an `ignoreDeprecations` value it does
 * not know. Every other error diagnostic, TS18003 included, fails the build; a non-error diagnostic is a warning.
 */
const UNKNOWN_CONFIG_OPTION: ReadonlySet<number> = new Set([
  5023, // Unknown compiler option '{0}'.
  5025, // Unknown compiler option '{0}'. Did you mean '{1}'?
  5103, // Invalid value for '--ignoreDeprecations'.
  6046, // Argument for '--{0}' option must be: {1}.
]);

/**
 * The TS5103 diagnostic of a config whose `ignoreDeprecations` value the loaded `typescript` does not know: unlike the
 * other version-skew codes, it comes from a program's `getOptionsDiagnostics()`, not from the config parse. A program
 * with no root file and no lib checks the options only and costs nothing.
 */
function ignoreDeprecationsDiagnostics(ts: typeof TS, parsed: TS.ParsedCommandLine): TS.Diagnostic[] {
  if (parsed.options.ignoreDeprecations === undefined) return [];
  const options = { ...parsed.options, noLib: true, types: [] };
  return ts.createProgram({ rootNames: [], options }).getOptionsDiagnostics().filter((diagnostic) => diagnostic.code === 5103);
}

/** The `include` of the config (its own or the one it extends), for errors: `["app/**\/*"]`. */
const includeOf = (parsed: TS.ParsedCommandLine) => {
  const { include, files } = (parsed.raw ?? {}) as { include?: unknown; files?: unknown };
  if (include !== undefined) return JSON.stringify(include);
  return files !== undefined ? `none, "files": ${JSON.stringify(files)}` : "none (every file of its folder)";
};

/**
 * The folder tsc mirrors under `outDir`, as `getOutputFileNames` takes it from `rootDir`: `rootDir`, else the config's
 * folder for a composite project or from TypeScript 6 (its default, with TS5011 when the sources are all in a
 * subfolder), else the common folder of the files tsc emits. Those are the files of the program,
 * not of the config: they include what the sources import from outside `include` (`$api` from `.laratype/`), so the
 * program is built (parsed, not type-checked) to list them.
 */
function emitRoot(ts: typeof TS, parsed: TS.ParsedCommandLine, configFile: string, ignoreCase: boolean): string {
  const { rootDir, composite } = parsed.options;
  if (rootDir !== undefined) return resolve(rootDir);
  if (composite || Number(ts.versionMajorMinor.split(".")[0]) >= 6) return dirname(configFile);
  // Without the default lib and @types: declaration files never count, and parsing them is most of the cost
  const options = { ...parsed.options, noLib: true, types: [] };
  const program = ts.createProgram({ rootNames: parsed.fileNames, options, projectReferences: parsed.projectReferences });
  const emitted = program.getSourceFiles().filter((file) =>
    !file.isDeclarationFile && !program.isSourceFileFromExternalLibrary(file) && !program.isSourceFileDefaultLibrary(file));
  const same = (a: string, b: string) => (ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b);
  const dirs = emitted.map((file) => slash(dirname(resolve(file.fileName))).split("/"));
  if (!dirs.length) return dirname(configFile);
  const common = dirs.reduce((acc, parts) => {
    let i = 0;
    while (i < acc.length && i < parts.length && same(acc[i]!, parts[i]!)) i++;
    return acc.slice(0, i);
  });
  // The root itself (`/`, `C:/`): `resolve("C:")` would be the current folder of the drive
  return resolve(common.length > 1 ? common.join("/") : `${common[0] ?? ""}/`);
}

/**
 * Writes `<distDir>/app.manifest.js`: the app manifest of the sources, each pointing at the file tsc emitted for it, as
 * TypeScript computes it from `tsconfig` (`getOutputFileNames`: outDir and rootDir, whatever the layout) and the root
 * tsc mirrors (`emitRoot`). The build needs an `outDir`: the manifest points into the emitted tree and `tsc-alias` runs
 * after it, so a config without one fails before anything is written. A config error fails, except an option or value
 * the loaded `typescript` does not know (`UNKNOWN_CONFIG_OPTION`, a warning); a warning diagnostic is a warning too.
 * An empty program (an `include` that matches nothing) is an error: the manifest would be empty. A source that is not
 * in the build program (excluded, such as test-only factories) is left out and returned in `omitted`; one in the
 * program whose output file is missing is an error. `appDir` records where `app/` is emitted, for `getAppPath()`.
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
  // A config error fails, except one about an option or value this `typescript` does not know (a newer tsc wrote it).
  // TS18003 ("No inputs were found") is an error, not a warning: an empty program would ship an empty manifest.
  const failed = (diagnostic: TS.Diagnostic) =>
    diagnostic.category === ts.DiagnosticCategory.Error && !UNKNOWN_CONFIG_OPTION.has(diagnostic.code);
  const diagnostics = [...parsed.errors, ...ignoreDeprecationsDiagnostics(ts, parsed)];
  const errors = diagnostics.filter(failed);
  const warnings = diagnostics.filter((diagnostic) => !failed(diagnostic));
  if (warnings.length) Console.warn(`sauf build: ${tsconfig}: ${warnings.map(message).join("; ")}`);
  if (errors.length) {
    throw new Error(`sauf build: ${tsconfig}: ${errors.map(message).join("; ")}`);
  }
  // Before the manifest or any entry file is written: tsc-alias runs after them and needs the emitted tree
  if (!parsed.options.outDir) {
    throw new Error(`sauf build: ${tsconfig}: outDir is required (the tsc-alias step after the manifest needs the emitted tree)`);
  }
  const sources = parsed.fileNames.filter((file) => !isDeclaration(file));
  if (!sources.length) {
    throw new Error(`sauf build: ${tsconfig} has no source file to build (its "include": ${includeOf(parsed)})`);
  }
  const ignoreCase = !ts.sys.useCaseSensitiveFileNames;
  const key = (file: string) => (ignoreCase ? slash(resolve(file)).toLowerCase() : slash(resolve(file)));
  const program = new Set(parsed.fileNames.map(key));

  const root = emitRoot(ts, parsed, configFile, ignoreCase);
  const emit = { ...parsed, options: { ...parsed.options, rootDir: root } };
  const app = resolve(projectDir, "app");
  const appDir = posix.relative(slash(dist), slash(resolve(parsed.options.outDir!, relative(root, app))));

  // tsc emits next to the sources when outDir is the root it mirrors (`"outDir": "."` with `"rootDir": "."`), not
  // only when there is no outDir: the scan must skip those `.js` files, not report them as duplicates
  const scan = scanManifest(projectDir, { emittedNextTo: key(parsed.options.outDir!) === key(root) });
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
  // The manifest always goes to dist/, even when tsc's outDir points elsewhere
  mkdirSync(dist, { recursive: true });
  writeFileSync(file, code);
  return { file, omitted, appDir };
}

/**
 * Warns about the manifest entries `writeDistManifest()` left out of the build program. A lang file gets its own line:
 * production then ships no translations and `trans()` returns the raw keys, and the fix is always `lang/**\/*` in the
 * build tsconfig (I1 #167).
 */
export function warnOmitted(omitted: readonly string[]): void {
  const lang = omitted.filter((path) => path.startsWith("lang/"));
  if (lang.length) {
    Console.warn(
      `Lang files are not in the program of tsconfig.build.json, so dist/app.manifest.js leaves them out and production has no translations for them: ${lang.join(', ')} (add "lang/**/*" to the build tsconfig's "include")`,
    );
  }
  const others = omitted.filter((path) => !path.startsWith("lang/"));
  if (others.length) {
    Console.warn(`Not in the program of tsconfig.build.json, so left out of dist/${MANIFEST_FILE}: ${others.join(', ')} (add their folder to "include" to ship them)`);
  }
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
    warnOmitted(omitted);
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

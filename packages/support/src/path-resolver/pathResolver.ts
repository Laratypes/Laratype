import path from "path";
import { cwd } from "process";
import { pathToFileURL } from 'node:url';
import { resolveSync } from 'mlly'
import { existsSync } from "node:fs";

export const getProjectPath = (pathFile: string, withURI = true) => {
  const fileUri = path.resolve(`${cwd()}${pathFile[0] == '/' ? pathFile : '/' + pathFile}`);
  if(withURI) {
    return pathToFileURL(fileUri).href;
  }
  return fileUri;
}

/**
 * Where tsc puts the build of a project source (`app/config/config.ts`), relative to the dist folder, in the order to
 * try: `app/config/config.js` when tsconfig.build.json keeps the project tree (`"rootDir": "."`, which an app importing
 * `$api` needs), then `config/config.js` for the 0.5 build (`include: ["app/**\/*"]`, so tsc's root is `app/`). The
 * first that exists is the build. Shared by `sauf build`'s app manifest and `getAppPath()`.
 */
export const emittedPaths = (sourcePath: string): string[] => {
  const js = sourcePath.replace(/\\/g, '/').replace(/^\//, '').replace(/\.mts$/, '.mjs').replace(/\.ts$/, '.js');
  return js.startsWith('app/') ? [js, js.slice('app/'.length)] : [js];
}

/**
 * The build of a project source under `distDir` (absolute), by the `emittedPaths()` rule, or `undefined` when tsc
 * emitted none. Both layouts' files at once is a stale dist (`tsc -b` doesn't clean after a layout switch): an error,
 * not a silent pick.
 */
export const findEmitted = (distDir: string, sourcePath: string): string | undefined => {
  const found = emittedPaths(sourcePath).filter((file) => existsSync(path.resolve(distDir, file)));
  if (found.length > 1) {
    const dist = path.basename(distDir);
    throw new Error(`stale dist: both ${found.map((file) => `${dist}/${file}`).join(' and ')} exist, clean ${dist}/ and build again`);
  }
  return found[0];
}

/**
 * @deprecated The framework loads app modules from the app manifest (`appManifest()`, the `virtual:laratype/app`
 * module of `sauf`), not by path. Kept for 0.5 user code; removed with the 0.5 layout (#135).
 */
export const getAppPath = (pathFile: string, withURI = true) => {
  let fileUri = path.resolve(`${cwd()}/app${pathFile[0] == '/' ? pathFile : '/' + pathFile}`);
  if(globalThis.__APP_PROD__) {
    const _pathFile = pathFile.replace(/\.[.ts]+$/, '.js');
    // Either build layout (`findEmitted`); the 0.5 one when neither file exists, as before
    const source = `app${_pathFile[0] == '/' ? _pathFile : '/' + _pathFile}`;
    const dist = path.resolve(cwd(), 'dist');
    fileUri = path.resolve(dist, findEmitted(dist, source) ?? emittedPaths(source).at(-1)!);
  }
  if(withURI) {
    return pathToFileURL(fileUri).href;
  }
  return fileUri;
}

export const getDefaultExports = (module: any) => {
  return module.default;
}

export const resolveModule = (moduleName: string, options: { url?: string, internal?: boolean } = {}) => {
  let id;
  if(Boolean(globalThis.__PROD__)) {
    id = resolveSync(moduleName, {
      url: options.url
    })
  }
  else {
    if(existsSync(path.resolve(moduleName))) {
      const fileUri = pathToFileURL(moduleName).href;
      id = fileUri;
    }
    else {
      id = moduleName;
      if(options.internal) {
        id = resolveSync(moduleName, {
          url: options.url
        });
        id = id.replace('dist/index.esm.js', 'src/index.ts');
      }
    }
  }

  return id;
}

export const importModule = async (moduleName: string, options: { url?: string, internal?: boolean } = {}) => {
  const id = resolveModule(moduleName, options);

  try {
    if(globalThis.__sauf_transpiler_instance) {
      return await globalThis.__sauf_transpiler_instance(id);
    }
    if(typeof module !== 'undefined') {
      return require(id);
    }
    return await import( /* @vite-ignore */ id);
  }
  catch(e) {
    console.error(`Failed to import module: ${moduleName}`, e, id);
  }
}

export { resolveSync, resolvePathSync } from 'mlly';
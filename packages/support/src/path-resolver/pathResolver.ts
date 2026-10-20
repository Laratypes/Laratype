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
 * @deprecated The framework loads app modules from the app manifest (`appManifest()`, the `virtual:laratype/app`
 * module of `sauf`), not by path. Kept for 0.5 user code; removed with the 0.5 layout (#135).
 */
export const getAppPath = (pathFile: string, withURI = true) => {
  let fileUri = path.resolve(`${cwd()}/app${pathFile[0] == '/' ? pathFile : '/' + pathFile}`);
  if(globalThis.__APP_PROD__) {
    const _pathFile = pathFile.replace(/\.[.ts]+$/, '.js');
    // Either build layout (`emittedPaths`); the 0.5 one when neither file exists, as before
    const candidates = emittedPaths(`app${_pathFile[0] == '/' ? _pathFile : '/' + _pathFile}`).map((file) => path.resolve(cwd(), 'dist', file));
    fileUri = candidates.find((file) => existsSync(file)) ?? candidates[candidates.length - 1]!;
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
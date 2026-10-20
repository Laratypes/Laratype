import path from "path";
import { cwd } from "process";
import { pathToFileURL } from 'node:url';
import { resolveSync } from 'mlly'
import { existsSync } from "node:fs";
import { peekAppManifest } from "../manifest/AppManifest";

export const getProjectPath = (pathFile: string, withURI = true) => {
  const fileUri = path.resolve(`${cwd()}${pathFile[0] == '/' ? pathFile : '/' + pathFile}`);
  if(withURI) {
    return pathToFileURL(fileUri).href;
  }
  return fileUri;
}

/**
 * @deprecated The framework loads app modules from the app manifest (`appManifest()`, the `virtual:laratype/app`
 * module of `sauf`), not by path. Kept for 0.5 user code; removed with the 0.5 layout (#135).
 */
export const getAppPath = (pathFile: string, withURI = true) => {
  let fileUri = path.resolve(`${cwd()}/app${pathFile[0] == '/' ? pathFile : '/' + pathFile}`);
  if(globalThis.__APP_PROD__) {
    const _pathFile = pathFile.replace(/\.[.ts]+$/, '.js');
    // Where `sauf build` recorded tsc emitted app/ (dist/app.manifest.js, AppManifest.appDir); without it dist/<path>, as in 0.5
    const appDir = peekAppManifest()?.appDir ?? '';
    fileUri = path.resolve(cwd(), 'dist', appDir, _pathFile.replace(/^\//, ''));
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
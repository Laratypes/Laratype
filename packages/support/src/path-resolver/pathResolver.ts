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

export const getAppPath = (pathFile: string, withURI = true) => {
  let fileUri = path.resolve(`${cwd()}/app${pathFile[0] == '/' ? pathFile : '/' + pathFile}`);
  if(globalThis.__APP_PROD__) {
    const _pathFile = pathFile.replace(/\.[.ts]+$/, '.js');
    fileUri = path.resolve(`${cwd()}/dist${_pathFile[0] == '/' ? _pathFile : '/' + _pathFile}`);
  }
  if(withURI) {
    return pathToFileURL(fileUri).href;
  }
  return fileUri;
}

export const getDefaultExports = (module: any) => {
  return module.default;
}

export const importModule = async (moduleName: string, options: { url?: string, internal?: boolean } = {}) => {
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
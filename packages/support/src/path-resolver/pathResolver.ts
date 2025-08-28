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

export const getDefaultExports = (module: any) => {
  return module.default;
}

export const importModule = async (moduleName: string, options: { url?: string } = {}) => {
  let id;
  if(__PROD__) {
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
      id = moduleName
    }
  }

  try {
    return await import( /* @vite-ignore */ id);
  }
  catch(e) {
    console.error(`Failed to import module: ${moduleName}`, e, id);
  }
}

export { resolveSync, resolvePathSync } from 'mlly';
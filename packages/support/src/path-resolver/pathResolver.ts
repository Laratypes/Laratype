import path from "path";
import { cwd } from "process";
import { pathToFileURL } from 'node:url';

export const getProjectPath = (pathFile: string, withURI = true) => {
  const fileUri = path.resolve(`${cwd()}${pathFile}`);
  if(withURI) {
    return pathToFileURL(fileUri).href;
  }
  return fileUri;
}

export const getDefaultExports = (module: any) => {
  return module.default;
}
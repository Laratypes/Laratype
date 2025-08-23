import { ServiceProvider } from "../ServiceProvider";
import { getProjectPath } from "../path-resolver/pathResolver";
import { globSync } from "glob";
import dotenv from "dotenv";
import { existsSync } from "fs";

export default class EnvLoadServiceProvider extends ServiceProvider {

  public async boot() {

    const priorities = [
      '.env',
      '.env.local',
    ].map((file) => getProjectPath(file, false)).filter((file) => existsSync(file));

    const envFiles = globSync(getProjectPath('.env.*', false), {
      windowsPathsNoEscape: true,
    });

    envFiles.forEach((file) => {
      if(!priorities.includes(file)) {
        priorities.push(file);
      };
    });

    const path = priorities[0];

    dotenv.config({
      path,
    });

    (globalThis as any).__laratype_env_file = path;

  }

}